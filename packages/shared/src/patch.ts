import { z } from "zod";
import { ConfidenceSchema } from "./schemas.js";

/**
 * Lifecycle status of a single patch.
 *
 * - `proposed`: produced by the Surgeon, not yet applied
 * - `applied`: written to the snapshot working tree
 * - `rejected`: dropped by the Examiner / Auditor
 * - `unresolved`: terminal state after retries failed
 */
export const PatchStatusSchema = z.enum([
  "proposed",
  "applied",
  "rejected",
  "unresolved",
]);
export type PatchStatus = z.infer<typeof PatchStatusSchema>;

/**
 * A single per-file patch produced by the Surgeon.
 *
 * `before`/`after` carry full file contents so the Examiner can re-render diffs
 * deterministically without re-reading the snapshot.
 */
export const PatchSchema = z.object({
  id: z.string().uuid(),
  jobId: z.string().uuid(),
  snapshotId: z.string().uuid(),
  fileId: z.string().uuid(),
  filePath: z.string(),
  before: z.string().describe("File contents before the patch"),
  after: z.string().describe("File contents after the patch"),
  appliedRuleIds: z.array(z.string()),
  confidence: ConfidenceSchema,
  status: PatchStatusSchema,
  rationale: z.string().optional(),
  retries: z.number().int().nonnegative().default(0),
  llmTranscriptId: z.string().uuid().optional(),
  createdAt: z.date(),
});
export type Patch = z.infer<typeof PatchSchema>;

/**
 * A batch of files + rules dispatched to the Surgeon as a single unit of work.
 */
export const PatchBatchSchema = z.object({
  id: z.string().uuid(),
  jobId: z.string().uuid(),
  fileIds: z.array(z.string().uuid()),
  ruleIds: z.array(z.string()),
});
export type PatchBatch = z.infer<typeof PatchBatchSchema>;

// Made with Bob
