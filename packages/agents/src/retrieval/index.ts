import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import type {
  AuditEventRepository,
  FileRepository,
  KnowledgeGraphRepository,
} from "@renatus/db";
import type { FileLanguage, Rule } from "@renatus/shared";
import { emitAuditEvent } from "../audit-events/emit.js";

/**
 * Retrieval input — a snapshot, its on-disk root, and the rule set produced
 * by the Cartographer. `maxBatchSize` defaults to 6 files per batch, which
 * comfortably fits Groq's 32k context window alongside the system prompt and
 * the rule payload.
 */
export interface RetrieveInput {
  snapshotId: string;
  /** Absolute path to the cloned working tree. */
  localPath: string;
  rules: Rule[];
  /** Maximum files per batch (default: 6). */
  maxBatchSize?: number;
  /**
   * Optional owning job — when present, the service emits a single
   * `retrieve_completed` audit event with batch / file telemetry at the
   * end of the run. When absent (tool harnesses, dry runs), retrieval is
   * silent.
   */
  jobId?: string;
}

/**
 * A single coherent batch of files dispatched to the Surgeon. The Surgeon
 * reads contents from disk via `absPath` rather than carrying them through
 * the database.
 */
export interface FileBatch {
  /** Stable UUID for the batch — generated server-side. */
  id: string;
  /** Snapshot the batch belongs to. */
  snapshotId: string;
  /** File rows in this batch — Surgeon reads contents from disk via filePath. */
  files: Array<{
    fileId: string;
    /** Repo-relative path (forward slashes). */
    filePath: string;
    /** localPath + filePath. */
    absPath: string;
    language: FileLanguage;
    sha: string;
  }>;
  /** Rules that triggered (or share a cluster with) this batch. */
  ruleIds: string[];
}

export interface RetrieveResult {
  batches: FileBatch[];
  /** Files that matched no rule — surfaced for telemetry. */
  unmatchedFileCount: number;
  /** Rules that matched no file — surfaced for telemetry. */
  unmatchedRuleIds: string[];
}

/**
 * Languages whose source can be patched by the Surgeon. JSON / `other` are
 * excluded — codemods only apply to TS/JS modules in Wave 2.
 */
const PARSEABLE_LANGUAGES: ReadonlySet<FileLanguage> = new Set<FileLanguage>([
  "typescript",
  "tsx",
  "javascript",
  "jsx",
]);

/**
 * Cap on the number of ancestor file ids retained per seed. The recursive
 * CTE in {@link KnowledgeGraphRepository.findFilesTransitivelyImporting} may
 * return the full transitive closure; we slice to keep batches small and
 * deterministic. See Task 6 spec: "radius 2" — implemented pragmatically as
 * "first N distinct CTE rows per seed".
 */
const MAX_ANCESTORS_PER_SEED = 5;

/**
 * Disjoint-set / union-find on integer indices. Path compression in `find`
 * and rank-less union (`parent[ra] = rb`) — sufficient for the small N we
 * operate on (≤ a few hundred indices per retrieval).
 */
class UnionFind {
  private readonly parent: number[];

  constructor(n: number) {
    this.parent = new Array<number>(n);
    for (let i = 0; i < n; i += 1) {
      this.parent[i] = i;
    }
  }

  find(x: number): number {
    let root = x;
    while (this.parent[root] !== root) {
      root = this.parent[root] as number;
    }
    // Path compression.
    let cur = x;
    while (this.parent[cur] !== root) {
      const next = this.parent[cur] as number;
      this.parent[cur] = root;
      cur = next;
    }
    return root;
  }

  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[ra] = rb;
  }
}

/**
 * Safe regex compilation. LLM-generated rule detectors are not always valid
 * JS regexes; on `SyntaxError` we log and skip the rule rather than crash
 * the entire retrieval. Flags: multiline + global, since detectors are
 * expected to match line-oriented patterns repeatedly across a file.
 */
function safeRegex(expr: string): RegExp | null {
  try {
    return new RegExp(expr, "gm");
  } catch (error) {
    console.error(
      `[RetrievalService] Bad detector regex ${JSON.stringify(expr)}: ${
        (error as Error).message
      }`,
    );
    return null;
  }
}

/**
 * Read + cache file contents. `cache` is keyed by absolute path. Read errors
 * (missing file, permission denied) are logged and treated as empty content
 * — the file simply matches no rule.
 */
async function readContentsCached(
  absPath: string,
  cache: Map<string, string>,
): Promise<string> {
  const hit = cache.get(absPath);
  if (hit !== undefined) return hit;

  try {
    const contents = await readFile(absPath, "utf8");
    cache.set(absPath, contents);
    return contents;
  } catch (error) {
    console.error(
      `[RetrievalService] Failed to read ${absPath}: ${(error as Error).message}`,
    );
    cache.set(absPath, "");
    return "";
  }
}

/**
 * RetrievalService — turns a Rule[] into coherent, import-connected FileBatches.
 *
 * Algorithm (see Task 6 spec):
 *   1. Load all files for the snapshot.
 *   2. Filter to parseable languages (TS/TSX/JS/JSX).
 *   3. For each rule, run its detector regex against every file's contents.
 *      Files that match become "seeds".
 *   4. Expand each seed via the import-graph CTE, capped to
 *      {@link MAX_ANCESTORS_PER_SEED} parents.
 *   5. Group impacted files into connected components via union-find over
 *      the seed→ancestor adjacency.
 *   6. Split oversize components into sub-batches of ≤ maxBatchSize.
 *   7. Sort deterministically (files by path within a batch; batches by
 *      their lowest-path file).
 */
export class RetrievalService {
  constructor(
    private readonly fileRepo: FileRepository,
    private readonly kgRepo: KnowledgeGraphRepository,
    private readonly auditRepo: AuditEventRepository | null = null,
  ) {}

  async retrieve(input: RetrieveInput): Promise<RetrieveResult> {
    const { snapshotId, localPath, rules, jobId } = input;
    const maxBatchSize = input.maxBatchSize ?? 6;

    if (maxBatchSize <= 0) {
      throw new Error("maxBatchSize must be positive");
    }

    // 1. Load all files for this snapshot.
    const allFiles = await this.fileRepo.getBySnapshot(snapshotId);

    // 2. Restrict to parseable source files. JSON / other are not patchable
    //    in Wave 2 — skipping them avoids polluting batches with content we
    //    cannot codemod.
    const parseableFiles = allFiles.filter((f) =>
      PARSEABLE_LANGUAGES.has(f.language),
    );

    if (parseableFiles.length === 0) {
      const result: RetrieveResult = {
        batches: [],
        unmatchedFileCount: 0,
        unmatchedRuleIds: rules.map((r) => r.id),
      };
      await this.emitCompleted(jobId, snapshotId, result);
      return result;
    }

    // Build helper structures keyed by both file id and array index. The
    // union-find operates on indices; downstream mapping uses ids.
    const indexById = new Map<string, number>();
    for (let i = 0; i < parseableFiles.length; i += 1) {
      const row = parseableFiles[i];
      if (row === undefined) continue;
      indexById.set(row.id, i);
    }

    // 3. Pattern detection. For each rule, find seed files whose contents
    //    match the detector regex. Both `pattern` and `ast` are treated as
    //    regex in Wave 2 (real AST detection lands in Wave 3).
    const ruleSeedIds = new Map<string, Set<string>>(); // ruleId → seed fileIds
    const ruleIdsByFileId = new Map<string, Set<string>>(); // fileId → ruleIds
    const matchedRuleIds = new Set<string>();

    const contentCache = new Map<string, string>();

    // Compile detectors up front; skip rules whose regex is invalid.
    const compiledRules: Array<{ rule: Rule; regex: RegExp }> = [];
    for (const rule of rules) {
      const regex = safeRegex(rule.detect.expr);
      if (regex === null) continue;
      compiledRules.push({ rule, regex });
      ruleSeedIds.set(rule.id, new Set<string>());
    }

    // Parallelize disk reads — the hot path is I/O bound.
    await Promise.all(
      parseableFiles.map(async (row) => {
        const absPath = path.join(localPath, row.path);
        const contents = await readContentsCached(absPath, contentCache);
        if (contents === "") return;

        for (const { rule, regex } of compiledRules) {
          // Reset lastIndex — regex is `g` flagged and reused across files.
          regex.lastIndex = 0;
          if (regex.test(contents)) {
            ruleSeedIds.get(rule.id)?.add(row.id);
            matchedRuleIds.add(rule.id);
            let bucket = ruleIdsByFileId.get(row.id);
            if (bucket === undefined) {
              bucket = new Set<string>();
              ruleIdsByFileId.set(row.id, bucket);
            }
            bucket.add(rule.id);
          }
        }
      }),
    );

    // 4. Expand each seed via the transitive-import CTE. The result is the
    //    set of files that import the seed (directly or via re-exports). We
    //    keep only the first MAX_ANCESTORS_PER_SEED parents to bound batch
    //    size on large repos.
    //
    //    We also collect adjacency edges (seed ↔ ancestor) for union-find.
    const impactedIndices = new Set<number>();
    const adjacency: Array<[number, number]> = [];

    const allSeedIds = new Set<string>();
    for (const set of ruleSeedIds.values()) {
      for (const id of set) allSeedIds.add(id);
    }

    for (const id of allSeedIds) {
      const seedIdx = indexById.get(id);
      if (seedIdx === undefined) continue;
      impactedIndices.add(seedIdx);
    }

    // CTE calls — parallelize across seeds. Each call returns a DISTINCT
    // set of fromFileIds.
    const ancestorLookups = await Promise.all(
      Array.from(allSeedIds).map(async (seedId) => {
        const ancestors = await this.kgRepo.findFilesTransitivelyImporting(
          seedId,
        );
        return { seedId, ancestors: ancestors.slice(0, MAX_ANCESTORS_PER_SEED) };
      }),
    );

    // Propagate the seed's rule attribution to its ancestors, since those
    // ancestors are now considered "impacted" by the same rule.
    for (const { seedId, ancestors } of ancestorLookups) {
      const seedIdx = indexById.get(seedId);
      if (seedIdx === undefined) continue;

      const seedRules = ruleIdsByFileId.get(seedId);

      for (const ancestorId of ancestors) {
        const ancestorIdx = indexById.get(ancestorId);
        // Ancestors that aren't in our parseable subset (e.g. JSON re-exports)
        // are silently dropped — the Surgeon can't patch them anyway.
        if (ancestorIdx === undefined) continue;
        impactedIndices.add(ancestorIdx);
        adjacency.push([seedIdx, ancestorIdx]);

        if (seedRules !== undefined) {
          let bucket = ruleIdsByFileId.get(ancestorId);
          if (bucket === undefined) {
            bucket = new Set<string>();
            ruleIdsByFileId.set(ancestorId, bucket);
          }
          for (const rid of seedRules) bucket.add(rid);
        }
      }
    }

    if (impactedIndices.size === 0) {
      const result: RetrieveResult = {
        batches: [],
        unmatchedFileCount: parseableFiles.length,
        unmatchedRuleIds: rules
          .map((r) => r.id)
          .filter((id) => !matchedRuleIds.has(id)),
      };
      await this.emitCompleted(jobId, snapshotId, result);
      return result;
    }

    // 5. Union-find on impacted files. Each merge represents "files share
    //    an import edge in either direction" — i.e. they belong in the same
    //    coherent batch.
    const uf = new UnionFind(parseableFiles.length);
    for (const [a, b] of adjacency) uf.union(a, b);

    // Group impacted indices by their union-find root.
    const componentByRoot = new Map<number, number[]>();
    for (const idx of impactedIndices) {
      const root = uf.find(idx);
      let bucket = componentByRoot.get(root);
      if (bucket === undefined) {
        bucket = [];
        componentByRoot.set(root, bucket);
      }
      bucket.push(idx);
    }

    // 6 + 7. Materialize batches. For each component:
    //   - Sort member indices by repo path (deterministic).
    //   - Split into chunks of ≤ maxBatchSize.
    //   - Collect ruleIds = union over all member files' rule attributions.
    const batches: FileBatch[] = [];

    // Pre-sort component lists so the outermost ordering (across batches) is
    // also deterministic — root order in a Map is insertion order, which
    // depends on union-find arithmetic; we re-sort the outputs at the end.
    for (const memberIndices of componentByRoot.values()) {
      memberIndices.sort((a, b) => {
        const pa = parseableFiles[a]?.path ?? "";
        const pb = parseableFiles[b]?.path ?? "";
        return pa.localeCompare(pb);
      });

      for (let start = 0; start < memberIndices.length; start += maxBatchSize) {
        const chunk = memberIndices.slice(start, start + maxBatchSize);
        const ruleIdSet = new Set<string>();
        const files: FileBatch["files"] = [];

        for (const idx of chunk) {
          const row = parseableFiles[idx];
          if (row === undefined) continue;
          const rules = ruleIdsByFileId.get(row.id);
          if (rules !== undefined) {
            for (const rid of rules) ruleIdSet.add(rid);
          }
          files.push({
            fileId: row.id,
            filePath: row.path,
            absPath: path.join(localPath, row.path),
            language: row.language,
            sha: row.sha,
          });
        }

        if (files.length === 0) continue;

        batches.push({
          id: randomUUID(),
          snapshotId,
          files,
          ruleIds: Array.from(ruleIdSet).sort(),
        });
      }
    }

    // Final deterministic ordering: batches sorted by the lowest-path file
    // inside each batch. Two batches will never share the same lowest path
    // because every file belongs to exactly one batch.
    batches.sort((a, b) => {
      const ap = a.files[0]?.filePath ?? "";
      const bp = b.files[0]?.filePath ?? "";
      return ap.localeCompare(bp);
    });

    // Telemetry: rules with no seed, and files outside any batch.
    const unmatchedRuleIds = rules
      .map((r) => r.id)
      .filter((id) => !matchedRuleIds.has(id));

    const unmatchedFileCount = parseableFiles.length - impactedIndices.size;

    const result: RetrieveResult = {
      batches,
      unmatchedFileCount,
      unmatchedRuleIds,
    };
    await this.emitCompleted(jobId, snapshotId, result);
    return result;
  }

  /**
   * Emit a single `retrieve_completed` audit event with batch + telemetry.
   * No-op when {@link RetrieveInput.jobId} is absent.
   */
  private async emitCompleted(
    jobId: string | undefined,
    snapshotId: string,
    result: RetrieveResult,
  ): Promise<void> {
    if (jobId === undefined) return;
    const totalFiles = result.batches.reduce(
      (sum, b) => sum + b.files.length,
      0,
    );
    await emitAuditEvent(this.auditRepo, {
      jobId,
      agentKind: "retrieval",
      eventType: "retrieve_completed",
      payload: {
        batchCount: result.batches.length,
        totalFiles,
        unmatchedFileCount: result.unmatchedFileCount,
        unmatchedRuleIds: result.unmatchedRuleIds,
      },
      entityId: snapshotId,
      entityType: "snapshot",
    });
  }
}

// Made with Bob
