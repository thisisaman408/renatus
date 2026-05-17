import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { inngest } from '@renatus/agents';
import { JobRepository, McpSessionRepository } from '@renatus/db';
import { EcosystemSchema } from '@renatus/shared';

/**
 * Input schema for the Tier-1 `security_audit_repository` MCP tool. Security
 * audit jobs accept either a CVE id (fetched from NVD) or raw advisory text.
 * The Cartographer runs Path B with sourceKind='cve-advisory' using the
 * advisory content as the LLM input. There is no `fromVersion`/`toVersion`
 * because security audits are not version-bumping operations.
 */
export const SecurityAuditRepositoryInputSchema = z.object({
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
  cveSource: z
    .discriminatedUnion('kind', [
      z.object({
        kind: z.literal('cve-id'),
        cveId: z
          .string()
          .regex(/^CVE-\d{4}-\d+$/i)
          .describe('CVE identifier (e.g., CVE-2024-12345)'),
      }),
      z.object({
        kind: z.literal('advisory-text'),
        advisoryText: z
          .string()
          .min(1)
          .describe('Raw advisory text (CVE description, security bulletin, etc.)'),
      }),
    ])
    .describe(
      'Either a CVE id (fetched from NVD) or raw advisory text. NOT both.',
    ),
  ecosystem: EcosystemSchema.default('npm'),
});

export type SecurityAuditRepositoryInput = z.infer<
  typeof SecurityAuditRepositoryInputSchema
>;

export const SecurityAuditRepositoryOutputSchema = z.object({
  jobId: z.string().uuid(),
  eventId: z.string(),
  sseUrl: z.string(),
  status: z.literal('queued'),
});

export type SecurityAuditRepositoryOutput = z.infer<
  typeof SecurityAuditRepositoryOutputSchema
>;

/**
 * Tier-1 MCP tool: connective tissue between Bob and the Inngest security
 * audit workflow.
 *
 * Flow:
 *   1. Ensure an `mcp_sessions` row exists for this Bob task (the audit
 *      wrapper does this too, but we want a session id we can attach the
 *      `jobs` row to without coupling to audit internals).
 *   2. Create a `jobs` row — the orchestrator anchors every downstream
 *      artefact (snapshot, plan, batches, patches) to this id. The jobs
 *      table requires non-null `source_version`/`target_version`, which
 *      don't apply to security audit agents — we store the sentinel string
 *      'security' in both for readability when scanning the table.
 *   3. Fire `renatus/security-audit.requested` via Inngest. The workflow runs
 *      asynchronously; the tool returns immediately with the queued status.
 *   4. Return the job id + Inngest event id + placeholder SSE URL. Wave 4
 *      wires the actual SSE route at `/api/jobs/:jobId/stream`.
 */
export async function securityAuditRepositoryTool(
  input: SecurityAuditRepositoryInput,
  databaseUrl: string,
): Promise<SecurityAuditRepositoryOutput> {
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
    sourceVersion: 'security',
    targetVersion: 'security',
    ecosystem: input.ecosystem,
    agentKind: 'security_audit',
    metadata: { ref: input.ref ?? null, cveSource: input.cveSource },
  });

  // Inngest's `send` returns { ids: string[] } where each id corresponds to
  // an event in order. We sent one event, so `ids[0]` is the one we care
  // about. Falling back to 'unknown' keeps the contract typed even on the
  // (impossible) empty-array case.
  const sendResult = await inngest.send({
    name: 'renatus/security-audit.requested',
    data: {
      jobId: job.id,
      repoUrl: input.repoUrl,
      ref: input.ref,
      ecosystem: input.ecosystem,
      cveSource: input.cveSource,
    },
  });

  const eventId = sendResult.ids[0] ?? 'unknown';

  return {
    jobId: job.id,
    eventId,
    sseUrl: `/api/jobs/${job.id}/stream`,
    status: 'queued',
  };
}

// Made with Bob