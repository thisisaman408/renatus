import { z } from "zod";
import { AuditorService } from "@renatus/agents";
import { AuditEventRepository, SigningKeyRepository } from "@renatus/db";

/**
 * `audit_repository` MCP tool — Auditor entry point.
 *
 * Given a `jobId` + `snapshotId`, loads the per-job audit_events log,
 * resolves (or creates) the job's ed25519 keypair, and returns a
 * canonical-JSON, SHA-256-hashed, ed25519-signed `AuditReport`.
 *
 * Sandbox-replay of the migrated repo is a Wave 4 concern; this tool
 * signs the event log only.
 */
export const AuditRepositoryInputSchema = z.object({
  jobId: z.string().uuid(),
  snapshotId: z.string().uuid(),
});

export type AuditRepositoryInput = z.infer<typeof AuditRepositoryInputSchema>;

export const AuditRepositoryOutputSchema = z.object({
  jobId: z.string().uuid(),
  snapshotId: z.string().uuid(),
  signature: z.object({
    algorithm: z.literal("ed25519"),
    value: z.string(),
    publicKey: z.string(),
    messageHash: z.string(),
    signedAt: z.string().datetime(),
  }),
  // Truncated rollup; the full summary lives in the audit_events
  // log and on the Auditor's return value.
  summary: z.object({
    totalEvents: z.number().int().nonnegative(),
    patchesProposed: z.number().int().nonnegative(),
    testsGenerated: z.number().int().nonnegative(),
  }),
  auditUrl: z.string().url().nullable(),
  eventCount: z.number().int().nonnegative(),
});

export type AuditRepositoryOutput = z.infer<typeof AuditRepositoryOutputSchema>;

export async function auditRepositoryTool(
  input: AuditRepositoryInput,
  databaseUrl: string,
): Promise<AuditRepositoryOutput> {
  const auditEventRepo = new AuditEventRepository(databaseUrl);
  const signingKeyRepo = new SigningKeyRepository(databaseUrl);
  const auditor = new AuditorService(auditEventRepo, signingKeyRepo);

  const result = await auditor.audit({
    jobId: input.jobId,
    snapshotId: input.snapshotId,
  });

  return {
    jobId: result.jobId,
    snapshotId: result.auditReport.snapshotId,
    signature: result.signature,
    summary: {
      totalEvents: result.auditReport.summary.totalEvents,
      patchesProposed: result.auditReport.summary.patchesProposed,
      testsGenerated: result.auditReport.summary.testsGenerated,
    },
    auditUrl: result.auditUrl,
    eventCount: result.auditReport.events.length,
  };
}
