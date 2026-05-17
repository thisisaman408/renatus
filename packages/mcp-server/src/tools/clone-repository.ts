import { z } from "zod";
import { GitHubAdapter } from "@renatus/agents";
import { AuditEventRepository, SnapshotRepository } from "@renatus/db";

export const CloneRepositoryInputSchema = z.object({
  jobId: z.string().uuid().describe("UUID of the job owning this snapshot"),
  repoUrl: z
    .string()
    .min(1)
    .describe("https://, git@, or file:// URL of the source repository"),
  ref: z
    .string()
    .optional()
    .describe("Branch, tag, or commit SHA — defaults to 'main'"),
});

export type CloneRepositoryInput = z.infer<typeof CloneRepositoryInputSchema>;

export const CloneRepositoryOutputSchema = z.object({
  snapshotId: z.string().uuid(),
  commitSha: z.string(),
  localPath: z.string(),
  filesCount: z.number().int().nonnegative(),
});

export type CloneRepositoryOutput = z.infer<typeof CloneRepositoryOutputSchema>;

/**
 * clone_repository MCP tool — wraps {@link GitHubAdapter.clone}.
 *
 * Clones (or copies, for file:// URLs) the target repository into a
 * per-job workspace, persists a `repo_snapshots` row, and returns the
 * snapshot identity + file count.
 */
export async function cloneRepositoryTool(
  input: CloneRepositoryInput,
  databaseUrl: string,
): Promise<CloneRepositoryOutput> {
  const snapshotRepo = new SnapshotRepository(databaseUrl);
  const auditRepo = new AuditEventRepository(databaseUrl);
  const adapter = new GitHubAdapter(snapshotRepo, auditRepo);

  const result = await adapter.clone({
    jobId: input.jobId,
    repoUrl: input.repoUrl,
    ref: input.ref,
  });

  return {
    snapshotId: result.snapshotId,
    commitSha: result.commitSha,
    localPath: result.localPath,
    filesCount: result.filesCount,
  };
}

// Made with Bob
