import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { runRefactorDirect } from '@renatus/agents';
import { JobRepository, McpSessionRepository } from '@renatus/db';
import { EcosystemSchema } from '@renatus/shared';

/**
 * Input schema for the Tier-1 `refactor_repository` MCP tool. Unlike the
 * migrate tool, refactor jobs are always source-driven — the Cartographer
 * runs Path B with sourceKind='refactor-intent' using the user's
 * natural-language intent string as the LLM input. There is no
 * `fromVersion`/`toVersion`/`ruleSource` because refactor is not a
 * version-bumping operation.
 */
export const RefactorRepositoryInputSchema = z.object({
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
    .describe('https://, git@, or file:// URL of the source repository'),
  ref: z
    .string()
    .optional()
    .describe("Branch, tag, or commit SHA. Defaults to 'main'."),
  intent: z
    .string()
    .min(1)
    .describe(
      "Natural-language refactor intent. Example: 'Rename getUser to loadUser across the entire codebase'.",
    ),
  ecosystem: EcosystemSchema.default('npm'),
});

export type RefactorRepositoryInput = z.infer<
  typeof RefactorRepositoryInputSchema
>;

export const RefactorRepositoryOutputSchema = z.object({
  jobId: z.string().uuid(),
  eventId: z.string(),
  sseUrl: z.string(),
  status: z.literal('done'),
  webUrl: z.string(),
});

export type RefactorRepositoryOutput = z.infer<
  typeof RefactorRepositoryOutputSchema
>;

/**
 * Tier-1 MCP tool: connective tissue between Bob and the Inngest refactor
 * workflow.
 *
 * Flow:
 *   1. Ensure an `mcp_sessions` row exists for this Bob task (the audit
 *      wrapper does this too, but we want a session id we can attach the
 *      `jobs` row to without coupling to audit internals).
 *   2. Create a `jobs` row — the orchestrator anchors every downstream
 *      artefact (snapshot, plan, batches, patches) to this id. The jobs
 *      table requires non-null `source_version`/`target_version`, which
 *      don't apply to refactor agents — we store the sentinel string
 *      'refactor' in both for readability when scanning the table.
 *   3. Fire `renatus/refactor.requested` via Inngest. The workflow runs
 *      asynchronously; the tool returns immediately with the queued status.
 *   4. Return the job id + Inngest event id + placeholder SSE URL. Wave 4
 *      wires the actual SSE route at `/api/jobs/:jobId/stream`.
 */
export async function refactorRepositoryTool(
  input: RefactorRepositoryInput,
  databaseUrl: string,
): Promise<RefactorRepositoryOutput> {
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

  const job = await jobRepo.create({
    sessionId: session.id,
    repoUrl: input.repoUrl,
    sourceVersion: 'refactor',
    targetVersion: 'refactor',
    ecosystem: input.ecosystem,
    agentKind: 'refactor',
    metadata: { ref: input.ref ?? null, intent: input.intent },
  });

  await runRefactorDirect({
    jobId: job.id,
    repoUrl: input.repoUrl,
    ref: input.ref,
    ecosystem: input.ecosystem,
    intent: input.intent,
  }, databaseUrl);

  return {
    jobId: job.id,
    eventId: job.id,
    sseUrl: `/api/jobs/${job.id}/stream`,
    status: 'done',
    webUrl: `https://renatus-iota.vercel.app/audit/${job.id}`,
  };
}

// Made with Bob
