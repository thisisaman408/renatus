import type { PatchRow } from '@renatus/db';
import type { Patch } from '@renatus/shared';

/**
 * Lift a Drizzle `PatchRow` to the Zod-validated `Patch` shape from
 * `@renatus/shared`. The two are structurally compatible — same column
 * names, same primitives — but we map field-by-field at this single seam
 * so any future divergence (e.g. a renamed column, a tightened nullable)
 * shows up as a type error here rather than at every workflow call site.
 *
 * Nullable DB columns (`rationale`, `llmTranscriptId`) become `undefined`
 * on the domain object, matching the `.optional()` declarations on
 * `PatchSchema`. Field casts have inline rationale comments and are
 * limited to the JSONB array and the enum-constrained text column —
 * Drizzle reports both as broader types than the schema enforces at
 * write time.
 *
 * Shared between `migrate-repository` and `refactor-repository` Inngest
 * workflows so the Examiner sees an identical Patch[] shape regardless
 * of which agent kind fanned it in.
 */
export function mapPatchRowToPatch(row: PatchRow): Patch {
  return {
    id: row.id,
    jobId: row.jobId,
    snapshotId: row.snapshotId,
    fileId: row.fileId,
    filePath: row.filePath,
    before: row.before,
    after: row.after,
    // rationale: jsonb<string[]> typed by Drizzle's $type, narrowed at the seam.
    appliedRuleIds: row.appliedRuleIds as string[],
    confidence: row.confidence,
    // rationale: text column with enum constraint enforced at write via PatchStatusSchema.
    status: row.status as Patch['status'],
    rationale: row.rationale ?? undefined,
    retries: row.retries,
    llmTranscriptId: row.llmTranscriptId ?? undefined,
    createdAt: row.createdAt,
  };
}

// Made with Bob
