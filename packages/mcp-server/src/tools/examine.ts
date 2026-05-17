import { z } from "zod";
import { ExaminerService } from "@renatus/agents";
import {
  AuditEventRepository,
  PatchRepository,
  TestRepository,
} from "@renatus/db";
import { LlmRouter } from "@renatus/llm";
import { AgentKindSchema, PatchSchema } from "@renatus/shared";
import type { Patch } from "@renatus/shared";

/**
 * `examine` MCP tool — Examiner entry point.
 *
 * Given a snapshot (with on-disk working tree at `localPath`), an `agentKind`,
 * and a set of patches the Surgeon has produced, run the full Examiner
 * pipeline: detect framework → pick strategy → per-patch LLM → ts-morph
 * validate → retry-with-feedback (max 2 retries) → emit GeneratedTest rows.
 *
 * Callers usually omit `patches` — the tool loads them from
 * `PatchRepository.getByJob(jobId)` when not supplied. The dry-run path
 * (caller passes patches + persist=false) is provided for Bob previews and
 * harness use.
 */
export const ExamineInputSchema = z.object({
  jobId: z.string().uuid(),
  snapshotId: z.string().uuid(),
  localPath: z.string().min(1),
  agentKind: AgentKindSchema,
  // Caller can pass patches directly (e.g. dry-run); else we load by jobId.
  patches: z.array(PatchSchema).optional(),
  persist: z.boolean().default(true),
});
export type ExamineInput = z.infer<typeof ExamineInputSchema>;

export const ExamineOutputSchema = z.object({
  jobId: z.string().uuid(),
  framework: z.string(),
  testCount: z.number().int().nonnegative(),
  errorCount: z.number().int().nonnegative(),
  llmAttempts: z.number().int().nonnegative(),
  llmLatencyMs: z.number().nonnegative(),
  llmProvider: z.string(),
  persisted: z.boolean(),
  tests: z.array(
    z.object({
      id: z.string().uuid(),
      patchId: z.string().uuid().nullable(),
      filePath: z.string(),
      framework: z.string(),
      strategy: z.string(),
    }),
  ),
  errors: z.array(
    z.object({
      patchId: z.string().uuid(),
      reason: z.string(),
    }),
  ),
});
export type ExamineOutput = z.infer<typeof ExamineOutputSchema>;

export async function examineTool(
  input: ExamineInput,
  databaseUrl: string,
): Promise<ExamineOutput> {
  const router = new LlmRouter();
  const testRepo = new TestRepository(databaseUrl);
  const auditRepo = new AuditEventRepository(databaseUrl);
  const examiner = new ExaminerService(router, testRepo, auditRepo);

  let patches: Patch[];
  if (input.patches !== undefined) {
    patches = input.patches;
  } else {
    const patchRepo = new PatchRepository(databaseUrl);
    const rows = await patchRepo.getByJob(input.jobId);
    // Lift DB rows to the Zod-validated Patch type. Field shapes match —
    // the Drizzle PatchRow is structurally a Patch — but we map explicitly
    // so any future divergence shows up at this single seam.
    patches = rows.map((r) => ({
      id: r.id,
      jobId: r.jobId,
      snapshotId: r.snapshotId,
      fileId: r.fileId,
      filePath: r.filePath,
      before: r.before,
      after: r.after,
      appliedRuleIds: r.appliedRuleIds,
      confidence: r.confidence,
      status: r.status,
      rationale: r.rationale ?? undefined,
      retries: r.retries,
      llmTranscriptId: r.llmTranscriptId ?? undefined,
      createdAt: r.createdAt,
    }));
  }

  const result = await examiner.examineBatch({
    jobId: input.jobId,
    snapshotId: input.snapshotId,
    localPath: input.localPath,
    patches,
    agentKind: input.agentKind,
  });

  const willPersist = input.persist && result.tests.length > 0;
  if (willPersist) {
    await examiner.persistTests(result.tests);
  }

  return {
    jobId: input.jobId,
    framework: result.framework,
    testCount: result.tests.length,
    errorCount: result.errors.length,
    llmAttempts: result.llmAttempts,
    llmLatencyMs: result.llmLatencyMs,
    llmProvider: result.llmProvider,
    persisted: willPersist,
    tests: result.tests.map((t) => ({
      id: t.id,
      patchId: t.patchId,
      filePath: t.filePath,
      framework: t.framework,
      strategy: t.strategy,
    })),
    errors: result.errors,
  };
}

// Made with Bob
