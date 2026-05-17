import { promises as fs } from 'node:fs';
import path from 'node:path';
import { NextResponse, type NextRequest } from 'next/server';
import {
  JobRepository,
  PatchRepository,
  SnapshotRepository,
  TestRepository,
  type GeneratedTestRow,
} from '@renatus/db';
import { requireDatabaseUrl } from '../../../../../lib/database-url';

/**
 * `/api/jobs/[jobId]/replay-tree` — serialized workspace tree for the
 * WebContainers replay route to mount.
 *
 * Returns:
 *   {
 *     fixtureFiles: Record<repoRelativePath, fileContents>,
 *     patches:      Array<{ filePath, after }>,
 *     framework:    'vitest' | 'jest' | 'mocha' | 'playwright' | 'unknown',
 *   }
 *
 * The client boots WebContainers, mounts `fixtureFiles`, overwrites each
 * `patches[i].filePath` with `patches[i].after`, then runs `pnpm install` +
 * `pnpm test`.
 *
 * Hard cap: 1MB per file. Anything larger is skipped (binary blobs would
 * defeat the WebContainers in-memory FS anyway; the React fixture is ~8 small
 * files). Total response is capped at 8MB; we stop walking once that's hit so
 * a misconfigured fixture can't blow up the SSR memory budget.
 *
 * Symbolic links and `node_modules/` are excluded — WebContainers reinstalls
 * deps from package.json inside the in-memory FS.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ jobId: string }>;
}

interface ReplayTreeBody {
  fixtureFiles: Record<string, string>;
  patches: Array<{ filePath: string; after: string }>;
  framework: GeneratedTestRow['framework'];
  snapshotCommitSha: string;
  totalBytes: number;
}

interface ErrorBody {
  error: string;
}

const MAX_FILE_BYTES = 1024 * 1024; // 1MB per file
const MAX_TOTAL_BYTES = 8 * 1024 * 1024; // 8MB per tree
const SKIP_DIRS = new Set([
  'node_modules',
  '.git',
  '.next',
  'dist',
  'build',
  '.turbo',
  '.pnpm-store',
  'coverage',
]);

/**
 * Heuristic for skipping non-text files. WebContainers can accept binary
 * Uint8Array contents, but the JSON wire format requires text. We accept
 * common source / config extensions and skip anything else.
 */
const TEXT_EXTENSIONS = new Set([
  '.ts',
  '.tsx',
  '.js',
  '.jsx',
  '.mjs',
  '.cjs',
  '.json',
  '.md',
  '.html',
  '.css',
  '.scss',
  '.svg',
  '.txt',
  '.yml',
  '.yaml',
  '.toml',
  '.env',
  '.gitignore',
  '.npmrc',
  '.nvmrc',
  '',
]);

function isTextish(file: string): boolean {
  const ext = path.extname(file).toLowerCase();
  return TEXT_EXTENSIONS.has(ext);
}

async function walkText(
  rootDir: string,
  acc: { files: Record<string, string>; bytes: number },
): Promise<void> {
  const stack: string[] = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop();
    if (current === undefined) break;
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const abs = path.join(current, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        stack.push(abs);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!isTextish(entry.name) && entry.name !== 'package.json') continue;
      let stat;
      try {
        stat = await fs.stat(abs);
      } catch {
        continue;
      }
      if (stat.size > MAX_FILE_BYTES) continue;
      if (acc.bytes + stat.size > MAX_TOTAL_BYTES) {
        // Don't fail the route — we've gathered enough; subsequent
        // files just won't be in the tree. The client will surface this
        // via the totalBytes telemetry.
        return;
      }
      let contents;
      try {
        contents = await fs.readFile(abs, 'utf-8');
      } catch {
        continue;
      }
      const rel = path.relative(rootDir, abs);
      // Normalize for cross-platform — WebContainers expects forward slashes.
      const normalized = rel.split(path.sep).join('/');
      acc.files[normalized] = contents;
      acc.bytes += stat.size;
    }
  }
}

export async function GET(
  _req: NextRequest,
  context: RouteContext,
): Promise<NextResponse<ReplayTreeBody | ErrorBody>> {
  const { jobId } = await context.params;

  let databaseUrl: string;
  try {
    databaseUrl = requireDatabaseUrl();
  } catch (err) {
    return NextResponse.json<ErrorBody>(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }

  const jobRepo = new JobRepository(databaseUrl);
  const snapshotRepo = new SnapshotRepository(databaseUrl);
  const patchRepo = new PatchRepository(databaseUrl);
  const testRepo = new TestRepository(databaseUrl);

  const job = await jobRepo.getById(jobId);
  if (!job) {
    return NextResponse.json<ErrorBody>(
      { error: 'Job not found' },
      { status: 404 },
    );
  }

  const snapshot = await snapshotRepo.getByJobId(jobId);
  if (!snapshot) {
    return NextResponse.json<ErrorBody>(
      { error: 'Snapshot not yet created for this job' },
      { status: 409 },
    );
  }

  // Filter to patches that should be applied. `proposed` is what the Surgeon
  // emits; `applied` is what the apply_patch tool writes to disk. We include
  // both — the replay applies the `after` text in WebContainers regardless of
  // whether the actual on-disk apply happened. `unresolved` and `rejected`
  // are intentionally excluded.
  const allPatches = await patchRepo.getByJob(jobId);
  const patches = allPatches
    .filter((p) => p.status === 'proposed' || p.status === 'applied')
    .map((p) => ({ filePath: p.filePath, after: p.after }));

  // Best-effort framework hint from generated_tests. If the Examiner emitted
  // multiple frameworks (e.g. vitest + playwright), use the most common.
  let framework: GeneratedTestRow['framework'] = 'unknown';
  try {
    const tests = await testRepo.getByJob(jobId);
    if (tests.length > 0) {
      const counts = new Map<GeneratedTestRow['framework'], number>();
      for (const t of tests) {
        counts.set(t.framework, (counts.get(t.framework) ?? 0) + 1);
      }
      let best: GeneratedTestRow['framework'] = 'unknown';
      let bestCount = 0;
      for (const [fw, count] of counts) {
        if (count > bestCount) {
          best = fw;
          bestCount = count;
        }
      }
      framework = best;
    }
  } catch {
    // Test repo failures are non-fatal — framework just stays 'unknown'.
  }

  const acc = { files: {} as Record<string, string>, bytes: 0 };
  try {
    await walkText(snapshot.localPath, acc);
  } catch (err) {
    return NextResponse.json<ErrorBody>(
      {
        error: `Could not read snapshot tree at ${snapshot.localPath}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      },
      { status: 500 },
    );
  }

  return NextResponse.json<ReplayTreeBody>({
    fixtureFiles: acc.files,
    patches,
    framework,
    snapshotCommitSha: snapshot.commitSha,
    totalBytes: acc.bytes,
  });
}
