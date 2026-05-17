import { createHash } from "node:crypto";
import fs, { Dirent } from "node:fs";
import { cp, mkdir, readdir, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import git from "isomorphic-git";
import http from "isomorphic-git/http/node";
import type { AuditEventRepository, SnapshotRepository } from "@renatus/db";
import { emitAuditEvent } from "../audit-events/emit.js";

/**
 * Directory entries that must never be copied into a snapshot workspace —
 * they're either VCS metadata, transient build output, or recursive
 * workspace state.
 */
const EXCLUDED_DIRS: ReadonlySet<string> = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".next",
  ".turbo",
  ".renatus-workspace",
]);

/**
 * Default workspace root, when not overridden by env or input.
 *
 * Resolution order:
 *   1. `RENATUS_WORKSPACE_ROOT` — explicit override for legacy callers.
 *   2. `RENATUS_CLONE_ROOT`     — preferred override for serverless deploys
 *      (Vercel Functions only let us write under `/tmp`).
 *   3. `os.tmpdir()/renatus-workspace/snapshots` — safe default that works on
 *      both local dev and Vercel Functions (where `process.cwd()` is read-only).
 */
function defaultWorkspaceRoot(): string {
  if (process.env.RENATUS_WORKSPACE_ROOT) {
    return process.env.RENATUS_WORKSPACE_ROOT;
  }
  const root = process.env.RENATUS_CLONE_ROOT ?? os.tmpdir();
  return path.join(root, "renatus-workspace", "snapshots");
}

/**
 * Input shape for {@link GitHubAdapter.clone}.
 */
export interface CloneInput {
  /** UUID of the job — also used as the snapshot directory name. */
  jobId: string;
  /** `https://`, `git@`, or `file://` URL of the source repo. */
  repoUrl: string;
  /** Branch, tag, or commit SHA. Defaults to `main`. */
  ref?: string;
  /** Override for the snapshot workspace root directory. */
  workspaceRoot?: string;
}

/**
 * Result shape for {@link GitHubAdapter.clone}.
 */
export interface CloneResult {
  /** Persisted `repo_snapshots.id`. */
  snapshotId: string;
  /** Resolved commit SHA — either git HEAD or a deterministic content hash. */
  commitSha: string;
  /** Absolute path to the cloned working tree. */
  localPath: string;
  /** Count of files (excluding {@link EXCLUDED_DIRS}). */
  filesCount: number;
}

/**
 * GitHubAdapter — clones a repository (or copies a local fixture) into a
 * per-job workspace and persists a `repo_snapshots` row.
 *
 * Two source types are supported:
 *   1. `file://` URLs — copied with `fs.cp` so end-to-end tests don't
 *      require network access or GitHub credentials.
 *   2. `https://` URLs — cloned with `isomorphic-git` (pure-JS, no git
 *      binary required) using a shallow `depth=1`, `singleBranch=true`
 *      checkout of the specified ref. SSH (`git@`) URLs are NOT supported
 *      by isomorphic-git; callers must rewrite to HTTPS.
 *
 * Why pure JS: the production runtime (Vercel Functions) has no `git`
 * binary, so any `simple-git`-style clone would shell out to a missing
 * executable. `isomorphic-git` ships its own packfile parser and HTTP
 * transport so it works in any Node 20+ environment.
 */
export class GitHubAdapter {
  constructor(
    private readonly snapshotRepo: SnapshotRepository,
    private readonly auditRepo: AuditEventRepository | null = null,
  ) {}

  /**
   * Clone or copy a repository into the per-job workspace, then persist
   * a `repo_snapshots` row referencing it.
   */
  async clone(input: CloneInput): Promise<CloneResult> {
    // When the caller didn't pass a ref, we let git resolve the remote's
    // default branch (could be `main`, `master`, `trunk`, anything). Forcing
    // `--branch main` here would 404 against repos like react-use that still
    // use master. We track the effective ref AFTER clone via `resolvedRef`.
    const requestedRef = input.ref ?? null;
    const workspaceRoot = input.workspaceRoot ?? defaultWorkspaceRoot();
    const localPath = path.resolve(workspaceRoot, input.jobId);

    await emitAuditEvent(this.auditRepo, {
      jobId: input.jobId,
      agentKind: "orchestrator",
      eventType: "clone_started",
      payload: { repoUrl: input.repoUrl, ref: requestedRef ?? "<default>" },
    });

    // Ensure parent exists; clean any prior partial state for this job.
    await mkdir(workspaceRoot, { recursive: true });
    await rm(localPath, { recursive: true, force: true });

    let commitSha: string;
    let resolvedRef: string;
    try {
      if (input.repoUrl.startsWith("file://")) {
        commitSha = await this.copyFromFileUrl(input.repoUrl, localPath);
        resolvedRef = requestedRef ?? "HEAD";
      } else if (input.repoUrl.startsWith("https://")) {
        const result = await this.cloneFromGit(
          input.repoUrl,
          requestedRef,
          localPath,
        );
        commitSha = result.sha;
        resolvedRef = result.ref;
      } else if (input.repoUrl.startsWith("git@")) {
        // isomorphic-git is HTTP-only — no SSH transport. Fail fast with a
        // clear message so the caller can rewrite the URL.
        throw new Error(
          `SSH URLs (git@…) are not supported in this build — use the https:// form of ${input.repoUrl}`,
        );
      } else {
        throw new Error(
          `Unsupported repoUrl scheme — expected https:// or file:// — got: ${input.repoUrl}`,
        );
      }
    } catch (error) {
      // Don't leave a half-cloned directory on disk.
      await rm(localPath, { recursive: true, force: true });
      const message = error instanceof Error ? error.message : String(error);
      // Friendly error rewriting for the most common failures. Pass the
      // raw error object so the mapper can inspect isomorphic-git's
      // `.code` / `.data` fields when present.
      const friendly = friendlyCloneError(input.repoUrl, requestedRef, error);
      await emitAuditEvent(this.auditRepo, {
        jobId: input.jobId,
        agentKind: "orchestrator",
        eventType: "clone_failed",
        payload: { error: friendly, rawError: message },
      });
      throw new Error(friendly);
    }

    const filesCount = await countFiles(localPath);

    const snapshot = await this.snapshotRepo.create({
      jobId: input.jobId,
      repoUrl: input.repoUrl,
      ref: resolvedRef,
      commitSha,
      localPath,
    });

    await emitAuditEvent(this.auditRepo, {
      jobId: input.jobId,
      agentKind: "orchestrator",
      eventType: "clone_completed",
      payload: {
        snapshotId: snapshot.id,
        commitSha,
        filesCount,
      },
      entityId: snapshot.id,
      entityType: "snapshot",
    });

    return {
      snapshotId: snapshot.id,
      commitSha,
      localPath,
      filesCount,
    };
  }

  /**
   * Copy a local directory referenced by `file://` URL into the workspace.
   *
   * Excludes {@link EXCLUDED_DIRS}. Resolves a commitSha by reading
   * `.git/HEAD` if the source is a git repo; otherwise produces a
   * deterministic `local-<sha256>` hash of the manifest.
   */
  private async copyFromFileUrl(
    repoUrl: string,
    localPath: string,
  ): Promise<string> {
    const sourcePath = fileURLToPath(repoUrl);
    const sourceStat = await stat(sourcePath).catch(() => null);
    if (!sourceStat || !sourceStat.isDirectory()) {
      throw new Error(`file:// source is not a directory: ${sourcePath}`);
    }

    await cp(sourcePath, localPath, {
      recursive: true,
      filter: (src) => {
        const rel = path.relative(sourcePath, src);
        if (rel === "") return true;
        const head = rel.split(path.sep)[0];
        return head === undefined || !EXCLUDED_DIRS.has(head);
      },
    });

    const gitSha = await tryReadGitHeadSha(sourcePath);
    if (gitSha !== null) return gitSha;

    return `local-${await hashDirectoryManifest(localPath)}`;
  }

  /**
   * Shallow-clone a remote repo into the workspace and return the
   * resolved HEAD SHA + the branch/ref actually checked out.
   *
   * Strategy when `requestedRef` is null:
   *   1. Clone with `ref` omitted — isomorphic-git follows the remote's
   *      symbolic HEAD and checks out the default branch (could be `main`,
   *      `master`, `trunk`, anything).
   *
   * Strategy when `requestedRef` is provided:
   *   1. Try `{ ref: requestedRef, singleBranch: true }`.
   *   2. On NotFoundError (ref doesn't exist on the remote), retry without
   *      `ref` so we fall back to the remote's default branch. Preserves
   *      the demo-critical master/main fallback behavior.
   *
   * Resilience notes:
   *   - `depth: 1` is a shallow clone (only the tip commit + tree).
   *   - `singleBranch: true` avoids fetching every refspec — matches the
   *     prior simple-git `--depth=1` behavior.
   *   - We don't pass `onAuth`. Private repos will surface as HTTP 404 or
   *     401, which `friendlyCloneError` maps to "is the repo public?".
   */
  private async cloneFromGit(
    repoUrl: string,
    requestedRef: string | null,
    localPath: string,
  ): Promise<{ sha: string; ref: string }> {
    let usedRef: string | null = requestedRef;
    try {
      await git.clone({
        fs,
        http,
        dir: localPath,
        url: repoUrl,
        ...(requestedRef ? { ref: requestedRef } : {}),
        singleBranch: true,
        depth: 1,
      });
    } catch (err) {
      // Specific case: user asked for `main` but the remote uses `master`
      // (or similar). Retry without `ref` to use the remote default.
      if (!requestedRef || !isRefNotFoundError(err)) {
        throw err;
      }
      // Clean up any partial state from the failed attempt.
      await rm(localPath, { recursive: true, force: true });
      await git.clone({
        fs,
        http,
        dir: localPath,
        url: repoUrl,
        singleBranch: true,
        depth: 1,
      });
      usedRef = null;
    }

    const sha = (
      await git.resolveRef({ fs, dir: localPath, ref: "HEAD" })
    ).trim();
    if (!sha) {
      throw new Error(
        `git clone succeeded but HEAD SHA was empty for ${repoUrl}`,
      );
    }

    // Resolve the actual ref we ended up on.
    //   - When we passed a `ref` to clone, that's what we checked out.
    //   - When we omitted `ref`, isomorphic-git writes the remote's default
    //     branch into `HEAD` as a symbolic ref (`ref: refs/heads/<branch>`).
    //     We read .git/HEAD directly to extract the branch name.
    let resolvedRef = usedRef ?? "HEAD";
    if (usedRef === null) {
      const branch = await readSymbolicHeadBranch(localPath);
      if (branch !== null) {
        resolvedRef = branch;
      }
    }

    return { sha, ref: resolvedRef };
  }
}

/**
 * Inspect an isomorphic-git error and decide whether it indicates the
 * requested ref doesn't exist on the remote (so we should retry with the
 * default branch).
 *
 * Recognizes two shapes:
 *   - `NotFoundError` thrown when the remote has no such ref.
 *   - `HttpError` with statusCode 404 (rare — usually it's NotFoundError).
 */
function isRefNotFoundError(err: unknown): boolean {
  if (err === null || typeof err !== "object") return false;
  // rationale: isomorphic-git's BaseError exposes code/name/data but the
  // public types are only available via the class. Treating as a structural
  // shape keeps us decoupled from the implementation detail.
  const e = err as {
    code?: string;
    name?: string;
    data?: { statusCode?: number };
    message?: string;
  };
  if (e.code === "NotFoundError" || e.name === "NotFoundError") return true;
  if (e.code === "ResolveRefError") return true;
  if (e.data?.statusCode === 404) return true;
  return false;
}

/**
 * Read `.git/HEAD` and return the branch name if HEAD is a symbolic ref
 * (e.g. `ref: refs/heads/master` → `master`). Returns null if HEAD is
 * detached or unreadable.
 */
async function readSymbolicHeadBranch(dir: string): Promise<string | null> {
  const headContent = await readFile(
    path.join(dir, ".git", "HEAD"),
    "utf8",
  ).catch(() => null);
  if (headContent === null) return null;
  const trimmed = headContent.trim();
  if (!trimmed.startsWith("ref:")) return null;
  const refPath = trimmed.slice("ref:".length).trim();
  const prefix = "refs/heads/";
  if (refPath.startsWith(prefix)) {
    const branch = refPath.slice(prefix.length);
    return branch.length > 0 ? branch : null;
  }
  return refPath.length > 0 ? refPath : null;
}

/**
 * Rewrite the most common git clone failures into actionable messages the
 * UI can show without dumping a stack trace at the user.
 *
 * Handles two error universes:
 *   1. isomorphic-git's structured errors — `NotFoundError`, `HttpError`
 *      (with `data.statusCode`), `SmartHttpError`, etc.
 *   2. Plain Node errors — DNS failures (`ENOTFOUND`), TLS errors, and
 *      anything else surfacing as a stringly-typed message.
 */
function friendlyCloneError(
  repoUrl: string,
  requestedRef: string | null,
  error: unknown,
): string {
  const rawMessage =
    error instanceof Error ? error.message : String(error ?? "");
  // rationale: structural typing against the isomorphic-git/Node error
  // surface — `code`/`data`/`name` aren't on the base Error type but
  // are stable contract across both libraries.
  const e =
    error !== null && typeof error === "object"
      ? (error as {
          code?: string;
          name?: string;
          data?: { statusCode?: number };
        })
      : {};

  // 1. Ref-not-found (most common during the demo — user types `main`,
  //    repo uses `master`). isomorphic-git throws NotFoundError. We also
  //    keep the legacy regex check so any error that survives the retry
  //    path still maps cleanly.
  if (
    e.code === "NotFoundError" ||
    e.name === "NotFoundError" ||
    e.code === "ResolveRefError" ||
    /Remote branch .+ not found in upstream origin/i.test(rawMessage) ||
    /Could not find remote branch/i.test(rawMessage) ||
    /Could not find ref/i.test(rawMessage)
  ) {
    return `Branch "${requestedRef}" doesn't exist in ${repoUrl}. Leave the Ref field empty to use the repo's default branch.`;
  }

  // 2. Repo not found / not public. isomorphic-git surfaces HTTP 404
  //    via HttpError with data.statusCode. Private repos with no auth
  //    typically return 401 or 404.
  const statusCode = e.data?.statusCode;
  if (
    statusCode === 404 ||
    statusCode === 401 ||
    statusCode === 403 ||
    e.code === "HttpError" ||
    e.code === "SmartHttpError" ||
    /Repository not found|not found.+fatal|access denied/i.test(rawMessage) ||
    /HTTP Error: 4\d\d/i.test(rawMessage)
  ) {
    return `Couldn't access ${repoUrl}. Is the repo public? (Renatus can't auth to private repos in this build.)`;
  }

  // 3. Network unreachable. isomorphic-git delegates HTTP to Node's
  //    fetch/http, so DNS failures bubble up as standard errors.
  if (
    e.code === "ENOTFOUND" ||
    e.code === "ECONNREFUSED" ||
    e.code === "ETIMEDOUT" ||
    e.code === "EAI_AGAIN" ||
    /could not resolve host/i.test(rawMessage) ||
    /getaddrinfo/i.test(rawMessage) ||
    /fetch failed/i.test(rawMessage)
  ) {
    return `Network error reaching ${repoUrl} — check your connection.`;
  }

  // 4. TLS.
  if (
    /SSL|certificate|CERT_/i.test(rawMessage) ||
    e.code === "CERT_HAS_EXPIRED" ||
    e.code === "DEPTH_ZERO_SELF_SIGNED_CERT"
  ) {
    return `TLS error reaching ${repoUrl}: ${rawMessage.split("\n")[0]}`;
  }

  return `Clone failed: ${rawMessage.split("\n")[0]}`;
}

/**
 * Recursive file count under `root`, skipping {@link EXCLUDED_DIRS}.
 *
 * Uses `fs.readdir({ recursive: true, withFileTypes: true })` (stable since
 * Node 20.1). We post-filter excluded paths because `readdir` doesn't
 * support a prune predicate.
 */
async function countFiles(root: string): Promise<number> {
  const entries = (await readdir(root, {
    recursive: true,
    withFileTypes: true,
  })) as Dirent[];

  let count = 0;
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const parent = entry.parentPath ?? root;
    const rel = path.relative(root, path.join(parent, entry.name));
    if (relIsExcluded(rel)) continue;
    count += 1;
  }
  return count;
}

/**
 * True if any path segment of `rel` is in {@link EXCLUDED_DIRS}.
 */
function relIsExcluded(rel: string): boolean {
  if (rel === "" || rel === ".") return false;
  for (const segment of rel.split(path.sep)) {
    if (EXCLUDED_DIRS.has(segment)) return true;
  }
  return false;
}

/**
 * Read a git repository's HEAD SHA without invoking `git`. Returns null
 * if `dir` is not a git repository, or the HEAD format is unrecognised.
 */
async function tryReadGitHeadSha(dir: string): Promise<string | null> {
  const headPath = path.join(dir, ".git", "HEAD");
  const headContent = await readFile(headPath, "utf8").catch(() => null);
  if (headContent === null) return null;

  const trimmed = headContent.trim();
  if (trimmed.startsWith("ref:")) {
    const refPath = trimmed.slice("ref:".length).trim();
    const refSha = await readFile(
      path.join(dir, ".git", refPath),
      "utf8",
    ).catch(() => null);
    if (refSha === null) return null;
    const sha = refSha.trim();
    return sha.length > 0 ? sha : null;
  }

  // Detached HEAD — `trimmed` is the SHA itself.
  return /^[0-9a-f]{40}$/i.test(trimmed) ? trimmed : null;
}

/**
 * Produce a deterministic content hash of a directory by sorting every
 * file path and incorporating each file's sha256 into a top-level digest.
 *
 * Used as a stand-in commitSha when the source is a non-git local fixture.
 */
async function hashDirectoryManifest(root: string): Promise<string> {
  const entries = (await readdir(root, {
    recursive: true,
    withFileTypes: true,
  })) as Dirent[];

  const files: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const parent = entry.parentPath ?? root;
    const rel = path.relative(root, path.join(parent, entry.name));
    if (relIsExcluded(rel)) continue;
    files.push(rel);
  }
  files.sort();

  const top = createHash("sha256");
  for (const rel of files) {
    const buf = await readFile(path.join(root, rel));
    const fileHash = createHash("sha256").update(buf).digest("hex");
    top.update(rel);
    top.update("\0");
    top.update(fileHash);
    top.update("\n");
  }
  return top.digest("hex");
}

// Made with Bob
