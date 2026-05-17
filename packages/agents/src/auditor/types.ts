import { z } from "zod";

/**
 * Input to the Auditor agent.
 *
 * The Auditor produces signed audit reports over the audit_events
 * append-only log. Sandbox execution against the migrated repo is a
 * Wave 4 deliverable — `runInSandbox`/`sandboxAdapter` are intentionally
 * absent here.
 */
export const AuditorInputSchema = z.object({
  jobId: z.string().uuid(),
  snapshotId: z.string().uuid(),
});

export type AuditorInput = z.infer<typeof AuditorInputSchema>;

/**
 * Single audit-event row as returned by `AuditEventRepository.findByJobId`.
 *
 * Mirrors the Drizzle `auditEvents.$inferSelect` shape. We re-declare it as
 * a Zod schema here to avoid a runtime dep on `@renatus/db` for consumers
 * who only want to verify reports (e.g. a CLI verifier).
 */
export const AuditEventRecordSchema = z.object({
  id: z.string().uuid(),
  jobId: z.string().uuid(),
  agentKind: z.string(),
  eventType: z.string(),
  payload: z.record(z.string(), z.unknown()),
  timestamp: z.date(),
  entityId: z.string().uuid().nullable(),
  entityType: z.string().nullable(),
});

export type AuditEventRecord = z.infer<typeof AuditEventRecordSchema>;

/**
 * Summary statistics computed from the event log. Counts are
 * grouped two ways: by `agentKind` (who) and by `eventType` (what),
 * plus a handful of high-value rollups the UI displays prominently.
 */
export const AuditReportSummarySchema = z.object({
  totalEvents: z.number().int().nonnegative(),
  byAgent: z.record(z.string(), z.number().int().nonnegative()),
  byEventType: z.record(z.string(), z.number().int().nonnegative()),
  patchesProposed: z.number().int().nonnegative(),
  patchesApplied: z.number().int().nonnegative(),
  patchesUnresolved: z.number().int().nonnegative(),
  testsGenerated: z.number().int().nonnegative(),
  testsPassed: z.number().int().nonnegative(),
  testsFailed: z.number().int().nonnegative(),
  failures: z.number().int().nonnegative(),
});

export type AuditReportSummary = z.infer<typeof AuditReportSummarySchema>;

/**
 * The full report payload that gets signed. Stable, deterministic, and
 * canonicalized via `@renatus/shared`'s `canonicalJson` before hashing.
 */
export const AuditReportSchema = z.object({
  jobId: z.string().uuid(),
  snapshotId: z.string().uuid(),
  timestamp: z.string().datetime(),
  summary: AuditReportSummarySchema,
  events: z.array(AuditEventRecordSchema),
});

export type AuditReport = z.infer<typeof AuditReportSchema>;

/**
 * ed25519 signature over the canonical-JSON-encoded report.
 *
 * `messageHash` is the SHA-256 of `canonicalJson(report)`.
 * `value` is the ed25519 signature over that hash.
 * `publicKey` is the verifier-side input (paired with `value`).
 */
export const SignatureSchema = z.object({
  algorithm: z.literal("ed25519"),
  value: z.string().regex(/^[0-9a-f]+$/i),
  publicKey: z.string().regex(/^[0-9a-f]+$/i),
  messageHash: z.string().regex(/^[0-9a-f]+$/i),
  signedAt: z.string().datetime(),
  /**
   * The exact canonical-JSON byte sequence (as a UTF-8 string) that was
   * SHA-256-hashed and then ed25519-signed to produce {@link value}.
   *
   * Optional because:
   *   1. In-memory verification paths (e.g. the Wave-3 structural verifier's
   *      sign+verify roundtrip) construct a {@link Signature} without ever
   *      persisting one — they trust `canonicalJson(report)` will reproduce
   *      the exact bytes that were just signed.
   *   2. Signatures persisted before this field was introduced (rare; only
   *      relevant during a rolling deploy / replay of historical jobs) don't
   *      have it. The verifier and `/api/jobs/[jobId]/audit-report` route
   *      both fall back to `canonicalJson(report)` when absent.
   *
   * When PRESENT, verifiers MUST prefer it over re-canonicalizing the
   * rebuilt report — the rebuild path is lossy on `report.timestamp` because
   * the original ISO-millisecond timestamp is not persisted in the
   * `audit_events` row's `timestamp` column (DB clock != in-process clock).
   */
  canonicalReportBytes: z.string().optional(),
});

export type Signature = z.infer<typeof SignatureSchema>;

/**
 * Payload shape stored on the `audit_signed` event row.
 *
 * Mirrors {@link SignatureSchema} on the wire — the historical persisted shape
 * used `signatureHex` / `publicKeyHex` / `messageHashHex` keys (and didn't
 * include `signedAt` or the canonical bytes). The current Auditor writes:
 *   - algorithm, value, publicKey, messageHash, signedAt (the full Signature)
 *   - canonicalReportBytes — the exact bytes that were hashed + signed
 *   - reportTimestamp — the `report.timestamp` value as a convenience field
 *     (redundant with canonicalReportBytes but cheap and self-documenting)
 *
 * The legacy keys are also accepted (and preferred when present) so the
 * `/api/jobs/[jobId]/audit-report` route handler can verify both new and old
 * signed events from the same DB without a migration.
 */
export const AuditSignedEventPayloadSchema = z.object({
  algorithm: z.literal("ed25519"),
  value: z.string().regex(/^[0-9a-f]+$/i),
  publicKey: z.string().regex(/^[0-9a-f]+$/i),
  messageHash: z.string().regex(/^[0-9a-f]+$/i),
  signedAt: z.string().datetime(),
  canonicalReportBytes: z.string(),
  reportTimestamp: z.string().datetime(),
});

export type AuditSignedEventPayload = z.infer<
  typeof AuditSignedEventPayloadSchema
>;

/**
 * Output from the Auditor agent.
 *
 * `auditUrl` is reserved for the web app (Wave 4); the agent returns
 * `null` today.
 */
export const AuditorOutputSchema = z.object({
  jobId: z.string().uuid(),
  auditReport: AuditReportSchema,
  signature: SignatureSchema,
  auditUrl: z.string().url().nullable(),
});

export type AuditorOutput = z.infer<typeof AuditorOutputSchema>;
