import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { runQaDirect } from '@renatus/agents';
import {
  JobRepository,
  McpSessionRepository,
  SnapshotRepository,
} from '@renatus/db';

/**
 * Input schema for the Tier-1 `query_codebase` MCP tool. Q&A jobs are
 * read-only — clone → index → ask. There is no `fromVersion`/`toVersion`/
 * `ruleSource`/`ecosystem` because Q&A doesn't synthesize rules or patch
 * files. A single natural-language `question` is the only domain payload.
 *
 * Two source paths are supported (W5-code-4):
 *   - `repoUrl` (+ optional `ref`): clone + index a fresh snapshot.
 *   - `snapshotId`: reuse an existing `repo_snapshots` row from a prior job
 *     and skip clone+index entirely. Faster + cheaper when chaining Q&A on
 *     top of an already-cloned repo (e.g. after a migrate or refactor run).
 *
 * Exactly one of the two MUST be supplied; the `.refine()` enforces the
 * mutually-exclusive contract at the schema boundary.
 */
export const QueryCodebaseInputSchema = z
  .object({
    sessionId: z
      .string()
      .uuid()
      .optional()
      .describe('MCP session id; auto-created if not provided'),
    bobTaskId: z
      .string()
      .optional()
      .describe('Bob task id to stamp on the session'),
    repoUrl: z
      .string()
      .min(1)
      .optional()
      .describe(
        'https://, git@, or file:// URL of the source repository. Required unless `snapshotId` is provided.',
      ),
    ref: z
      .string()
      .optional()
      .describe(
        "Branch, tag, or commit SHA. Defaults to 'main'. Ignored when `snapshotId` is provided.",
      ),
    snapshotId: z
      .string()
      .uuid()
      .optional()
      .describe(
        'Reuse a snapshot from a prior job (skip clone+index for fast answers). Mutually exclusive with `repoUrl`.',
      ),
    question: z
      .string()
      .min(1)
      .describe(
        "Natural-language question about the codebase. Example: 'Where is the auth middleware composed?'",
      ),
  })
  .refine((input) => !!input.repoUrl || !!input.snapshotId, {
    message: 'Either repoUrl OR snapshotId is required',
  });

export type QueryCodebaseInput = z.infer<typeof QueryCodebaseInputSchema>;

export const QueryCodebaseOutputSchema = z.object({
  jobId: z.string().uuid(),
  eventId: z.string(),
  sseUrl: z.string(),
  status: z.literal('done'),
  webUrl: z.string(),
});

export type QueryCodebaseOutput = z.infer<typeof QueryCodebaseOutputSchema>;

/**
 * Tier-1 MCP tool: connective tissue between Bob and the Inngest Q&A
 * workflow.
 *
 * Flow:
 *   1. Ensure an `mcp_sessions` row exists for this Bob task (the audit
 *      wrapper does this too, but we want a session id we can attach the
 *      `jobs` row to without coupling to audit internals).
 *   2. Create a `jobs` row — the orchestrator anchors every downstream
 *      artefact (snapshot, transcript) to this id. The jobs table requires
 *      non-null `source_version`/`target_version`, which don't apply to Q&A
 *      agents — we store the sentinel string 'qa' in both for readability
 *      when scanning the table.
 *   3. Fire `renatus/qa.requested` via Inngest. The workflow runs
 *      asynchronously; the tool returns immediately with the queued status.
 *   4. Return the job id + Inngest event id + placeholder SSE URL. Wave 4
 *      wires the actual SSE route at `/api/jobs/:jobId/stream`.
 */
export async function queryCodebaseTool(
  input: QueryCodebaseInput,
  databaseUrl: string,
): Promise<QueryCodebaseOutput> {
  const sessionRepo = new McpSessionRepository(databaseUrl);
  const jobRepo = new JobRepository(databaseUrl);

  // Generate a stable bobTaskId if the caller didn't pass one — keeps the
  // session row's `bob_task_id` unique-per-invocation rather than colliding
  // with whatever was last sent through the audit pipeline.
  const bobTaskId = input.bobTaskId ?? `mcp-${randomUUID()}`;
  const session = await sessionRepo.upsertSession(bobTaskId, 'stdio');
  if (!session) {
    throw new Error('Failed to ensure MCP session');
  }

  // Resolve the jobs-row repoUrl + ref. On the cached path we look up the
  // source snapshot so the `jobs` table still has a human-readable URL —
  // the audit page and SSE feed display these. The refine() above guarantees
  // exactly one of repoUrl/snapshotId is set, so no further validation here.
  let jobRepoUrl: string;
  let jobRef: string | null;
  if (input.snapshotId) {
    const snapshotRepo = new SnapshotRepository(databaseUrl);
    const snapshot = await snapshotRepo.getById(input.snapshotId);
    if (!snapshot) {
      throw new Error(
        `Snapshot ${input.snapshotId} not found — pass a snapshotId from a completed job, or omit it to clone fresh.`,
      );
    }
    jobRepoUrl = snapshot.repoUrl;
    jobRef = snapshot.ref;
  } else {
    // refine() guarantees repoUrl is present on this branch.
    jobRepoUrl = input.repoUrl as string;
    jobRef = input.ref ?? null;
  }

  const job = await jobRepo.create({
    sessionId: session.id,
    repoUrl: jobRepoUrl,
    sourceVersion: 'qa',
    targetVersion: 'qa',
    ecosystem: 'npm',
    agentKind: 'qa',
    metadata: {
      ref: jobRef,
      question: input.question,
      sourceKind: input.snapshotId ? 'cached' : 'fresh',
      sourceSnapshotId: input.snapshotId ?? null,
    },
  });

  // Map to the discriminated source union for the direct runner.
  const source = input.snapshotId
    ? ({ kind: 'cached' as const, snapshotId: input.snapshotId } as const)
    : ({
        kind: 'fresh' as const,
        repoUrl: input.repoUrl as string,
        ref: input.ref,
      } as const);

  await runQaDirect({
    jobId: job.id,
    question: input.question,
    source,
  }, databaseUrl);

  return {
    jobId: job.id,
    eventId: job.id,
    sseUrl: `/api/jobs/${job.id}/stream`,
    status: 'done',
    webUrl: `https://renatus-iota.vercel.app/audit/${job.id}`,
  };
}
