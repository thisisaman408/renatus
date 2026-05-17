import { z } from "zod";
import { Indexer } from "@renatus/agents";
import {
  AuditEventRepository,
  FileRepository,
  ImportRepository,
  SymbolRepository,
} from "@renatus/db";

export const IndexRepositoryInputSchema = z.object({
  snapshotId: z.string().uuid(),
  localPath: z
    .string()
    .min(1)
    .describe("Absolute path to the cloned working tree"),
  /**
   * Optional owning job UUID. When supplied, the Indexer emits
   * `index_started` / `index_completed` audit events. Absent for ad-hoc
   * one-off tool calls outside a job context.
   */
  jobId: z.string().uuid().optional(),
});

export type IndexRepositoryInput = z.infer<typeof IndexRepositoryInputSchema>;

export const IndexRepositoryOutputSchema = z.object({
  snapshotId: z.string().uuid(),
  fileCount: z.number().int().nonnegative(),
  importCount: z.number().int().nonnegative(),
  symbolCount: z.number().int().nonnegative(),
});

export type IndexRepositoryOutput = z.infer<typeof IndexRepositoryOutputSchema>;

/**
 * index_repository MCP tool — wraps {@link Indexer.index}.
 *
 * Walks the snapshot's working tree, parses TS/JS modules with ts-morph,
 * and persists files, import edges, and top-level symbols to Postgres.
 */
export async function indexRepositoryTool(
  input: IndexRepositoryInput,
  databaseUrl: string,
): Promise<IndexRepositoryOutput> {
  const fileRepo = new FileRepository(databaseUrl);
  const importRepo = new ImportRepository(databaseUrl);
  const symbolRepo = new SymbolRepository(databaseUrl);
  const auditRepo = new AuditEventRepository(databaseUrl);
  const indexer = new Indexer(fileRepo, importRepo, symbolRepo, auditRepo);

  const result = await indexer.index({
    snapshotId: input.snapshotId,
    localPath: input.localPath,
    jobId: input.jobId,
  });

  return {
    snapshotId: result.snapshotId,
    fileCount: result.fileCount,
    importCount: result.importCount,
    symbolCount: result.symbolCount,
  };
}

// Made with Bob
