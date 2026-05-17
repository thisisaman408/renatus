import { writeFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { PatchRepository, SnapshotRepository } from "@renatus/db";

/**
 * `apply_patch` MCP tool — write a proposed Patch to disk and mark applied.
 *
 * The Surgeon emits patches with `status='proposed'`. This tool is the
 * deliberate human-in-the-loop / orchestrator-decided commit step:
 *
 *   1. Look up the patch row.
 *   2. Look up its snapshot to find the working-tree root.
 *   3. Write `patch.after` to `<snapshot.localPath>/<patch.filePath>`.
 *   4. Flip the row to `status='applied'`.
 *
 * Errors at any step bubble; we deliberately do NOT auto-rollback on a
 * failed write — the partial state is useful audit evidence for Wave 3.
 */
export const ApplyPatchInputSchema = z.object({
  patchId: z.string().uuid(),
});

export type ApplyPatchInput = z.infer<typeof ApplyPatchInputSchema>;

export const ApplyPatchOutputSchema = z.object({
  patchId: z.string().uuid(),
  filePath: z.string(),
  bytesWritten: z.number().int().nonnegative(),
  status: z.string(),
});

export type ApplyPatchOutput = z.infer<typeof ApplyPatchOutputSchema>;

export async function applyPatchTool(
  input: ApplyPatchInput,
  databaseUrl: string,
): Promise<ApplyPatchOutput> {
  const patchRepo = new PatchRepository(databaseUrl);
  const snapshotRepo = new SnapshotRepository(databaseUrl);

  const patch = await patchRepo.getById(input.patchId);
  if (patch === null) {
    throw new Error(`Patch not found: ${input.patchId}`);
  }

  const snapshot = await snapshotRepo.getById(patch.snapshotId);
  if (snapshot === null) {
    throw new Error(
      `Snapshot not found for patch ${input.patchId}: snapshotId=${patch.snapshotId}`,
    );
  }

  const absPath = path.join(snapshot.localPath, patch.filePath);
  const buffer = Buffer.from(patch.after, "utf8");
  await writeFile(absPath, buffer);

  await patchRepo.updateStatus(input.patchId, "applied");

  return {
    patchId: input.patchId,
    filePath: patch.filePath,
    bytesWritten: buffer.length,
    status: "applied",
  };
}

// Made with Bob
