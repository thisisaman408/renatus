import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { runMigrateDirect } from '@renatus/agents';
import { JobRepository, McpSessionRepository } from '@renatus/db';
import { AgentKindSchema, EcosystemSchema } from '@renatus/shared';

/**
 * Input schema for the Tier-1 `migrate_repository` MCP tool. The
 * `ruleSource` discriminated union is forwarded verbatim to the Inngest
 * event payload, so Bob can choose between bundled rule packs and free-form
 * upstream sources (changelog text, diff, guide URL, refactor intent, CVE)
 * via a single argument.
 */
export const MigrateRepositoryInputSchema = z.object({
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
  ecosystem: EcosystemSchema,
  fromVersion: z.string(),
  toVersion: z.string(),
  agentKind: AgentKindSchema.default('migrate'),
  ruleSource: z
    .discriminatedUnion('kind', [
      z.object({ kind: z.literal('pack') }),
      z.object({ kind: z.literal('changelog'), sourceText: z.string() }),
      z.object({ kind: z.literal('diff'), sourceText: z.string() }),
      z.object({ kind: z.literal('guide-url'), sourceText: z.string() }),
      z.object({ kind: z.literal('refactor-intent'), sourceText: z.string() }),
      z.object({ kind: z.literal('cve-advisory'), sourceText: z.string() }),
    ])
    .default({ kind: 'pack' }),
});

export type MigrateRepositoryInput = z.infer<typeof MigrateRepositoryInputSchema>;

export const MigrateRepositoryOutputSchema = z.object({
  jobId: z.string().uuid(),
  eventId: z.string(),
  sseUrl: z.string(),
  status: z.literal('done'),
  webUrl: z.string(),
});

export type MigrateRepositoryOutput = z.infer<
  typeof MigrateRepositoryOutputSchema
>;

/**
 * Tier-1 MCP tool: connective tissue between Bob and the Inngest workflow.
 *
 * Flow:
 *   1. Ensure an `mcp_sessions` row exists for this Bob task (the audit
 *      wrapper does this too, but we want a session id we can attach the
 *      `jobs` row to without coupling to audit internals).
 *   2. Create a `jobs` row — the orchestrator anchors every downstream
 *      artefact (snapshot, plan, batches, patches) to this id.
 *   3. Fire `renatus/migrate.requested` via Inngest. The workflow runs
 *      asynchronously; the tool returns immediately with the queued status.
 *   4. Return the job id + Inngest event id + placeholder SSE URL. Wave 4
 *      wires the actual SSE route at `/api/jobs/:jobId/stream`.
 */
export async function migrateRepositoryTool(
  input: MigrateRepositoryInput,
  databaseUrl: string,
): Promise<MigrateRepositoryOutput> {
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
    sourceVersion: input.fromVersion,
    targetVersion: input.toVersion,
    ecosystem: input.ecosystem,
    agentKind: input.agentKind,
    metadata: { ref: input.ref ?? null, ruleSource: input.ruleSource },
  });

  await runMigrateDirect({
    jobId: job.id,
    repoUrl: input.repoUrl,
    ref: input.ref,
    ecosystem: input.ecosystem,
    fromVersion: input.fromVersion,
    toVersion: input.toVersion,
    agentKind: input.agentKind,
    ruleSource: input.ruleSource,
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
