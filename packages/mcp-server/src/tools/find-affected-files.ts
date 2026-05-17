import { z } from "zod";
import { RetrievalService } from "@renatus/agents";
import {
  AuditEventRepository,
  FileRepository,
  KnowledgeGraphRepository,
} from "@renatus/db";
import { RuleSchema } from "@renatus/shared";

export const FindAffectedFilesInputSchema = z.object({
  snapshotId: z.string().uuid(),
  localPath: z.string().min(1),
  rules: z.array(RuleSchema),
  maxBatchSize: z.number().int().positive().optional(),
  /**
   * Optional owning job UUID. When supplied, the RetrievalService emits a
   * `retrieve_completed` audit event with batch / file telemetry.
   */
  jobId: z.string().uuid().optional(),
});

export type FindAffectedFilesInput = z.infer<typeof FindAffectedFilesInputSchema>;

export const FindAffectedFilesOutputSchema = z.object({
  batchCount: z.number().int().nonnegative(),
  totalFiles: z.number().int().nonnegative(),
  unmatchedFileCount: z.number().int().nonnegative(),
  unmatchedRuleIds: z.array(z.string()),
  batches: z.array(
    z.object({
      id: z.string().uuid(),
      fileCount: z.number().int().nonnegative(),
      ruleIds: z.array(z.string()),
      files: z.array(
        z.object({
          fileId: z.string().uuid(),
          filePath: z.string(),
          language: z.string(),
        }),
      ),
    }),
  ),
});

export type FindAffectedFilesOutput = z.infer<
  typeof FindAffectedFilesOutputSchema
>;

/**
 * find_affected_files MCP tool — wraps {@link RetrievalService.retrieve}.
 *
 * Given a Cartographer-emitted Rule[] and a previously-indexed snapshot,
 * returns import-coherent file batches that the Surgeon can patch in one
 * LLM context. Output is intentionally lean: file paths + ids only — Surgeon
 * reads contents from disk via `localPath` itself.
 */
export async function findAffectedFilesTool(
  input: FindAffectedFilesInput,
  databaseUrl: string,
): Promise<FindAffectedFilesOutput> {
  const fileRepo = new FileRepository(databaseUrl);
  const kgRepo = new KnowledgeGraphRepository(databaseUrl);
  const auditRepo = new AuditEventRepository(databaseUrl);
  const retrieval = new RetrievalService(fileRepo, kgRepo, auditRepo);

  const result = await retrieval.retrieve({
    snapshotId: input.snapshotId,
    localPath: input.localPath,
    rules: input.rules,
    maxBatchSize: input.maxBatchSize,
    jobId: input.jobId,
  });

  return {
    batchCount: result.batches.length,
    totalFiles: result.batches.reduce((sum, b) => sum + b.files.length, 0),
    unmatchedFileCount: result.unmatchedFileCount,
    unmatchedRuleIds: result.unmatchedRuleIds,
    batches: result.batches.map((b) => ({
      id: b.id,
      fileCount: b.files.length,
      ruleIds: b.ruleIds,
      files: b.files.map((f) => ({
        fileId: f.fileId,
        filePath: f.filePath,
        language: f.language,
      })),
    })),
  };
}

// Made with Bob
