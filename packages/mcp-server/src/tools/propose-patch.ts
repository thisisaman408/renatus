import { z } from "zod";
import { SurgeonService } from "@renatus/agents";
import { AuditEventRepository, PatchRepository } from "@renatus/db";
import { LlmRouter } from "@renatus/llm";
import { AgentKindSchema, RuleSchema } from "@renatus/shared";

/**
 * `propose_patch` MCP tool — Surgeon entry point.
 *
 * Given a `FileBatch` (from `find_affected_files`), the Cartographer-emitted
 * rule subset attributed to that batch, and an `agentKind`, runs the
 * full Surgeon pipeline: LLM call → JSON parse → Zod validate →
 * ts-morph syntactic validation, with up to 2 retries.
 *
 * `persist=true` (default) writes the proposed patches to the `patches`
 * table; `persist=false` is a dry-run — useful for Bob-driven previews and
 * tool harnesses where DB writes are out of scope.
 */
export const ProposePatchInputSchema = z.object({
  jobId: z.string().uuid(),
  batch: z.object({
    id: z.string().uuid(),
    snapshotId: z.string().uuid(),
    files: z.array(
      z.object({
        fileId: z.string().uuid(),
        filePath: z.string().min(1),
        absPath: z.string().min(1),
        language: z.string(),
        sha: z.string(),
      }),
    ),
    ruleIds: z.array(z.string()),
  }),
  rules: z.array(RuleSchema),
  agentKind: AgentKindSchema,
  persist: z.boolean().default(true),
});

export type ProposePatchInput = z.infer<typeof ProposePatchInputSchema>;

export const ProposePatchOutputSchema = z.object({
  jobId: z.string().uuid(),
  batchId: z.string().uuid(),
  patchCount: z.number().int().nonnegative(),
  unresolvedFileCount: z.number().int().nonnegative(),
  llmAttempts: z.number().int().nonnegative(),
  llmLatencyMs: z.number().nonnegative(),
  llmProvider: z.string(),
  persisted: z.boolean(),
  patches: z.array(
    z.object({
      id: z.string().uuid(),
      filePath: z.string(),
      confidence: z.number(),
      status: z.string(),
      appliedRuleIds: z.array(z.string()),
      rationale: z.string().optional(),
    }),
  ),
});

export type ProposePatchOutput = z.infer<typeof ProposePatchOutputSchema>;

export async function proposePatchTool(
  input: ProposePatchInput,
  databaseUrl: string,
): Promise<ProposePatchOutput> {
  const router = new LlmRouter();
  const patchRepo = new PatchRepository(databaseUrl);
  const auditRepo = new AuditEventRepository(databaseUrl);
  const surgeon = new SurgeonService(router, patchRepo, auditRepo);

  // The FileBatch interface uses a discriminated `language` (FileLanguage);
  // the tool schema accepts an opaque string so callers don't need the
  // shared enum at the MCP boundary. We cast at the seam — the Surgeon
  // never inspects `language` itself, it's metadata for the LLM prompt and
  // for downstream tooling.
  const result = await surgeon.migrateBatch({
    jobId: input.jobId,
    batch: {
      id: input.batch.id,
      snapshotId: input.batch.snapshotId,
      files: input.batch.files.map((f) => ({
        fileId: f.fileId,
        filePath: f.filePath,
        absPath: f.absPath,
        // rationale: FileLanguage is a closed enum but at the MCP boundary we accept any string; Surgeon does not branch on language.
        language: f.language as never,
        sha: f.sha,
      })),
      ruleIds: input.batch.ruleIds,
    },
    rules: input.rules,
    agentKind: input.agentKind,
  });

  if (input.persist && result.patches.length > 0) {
    await surgeon.persistPatches(result.patches);
  }

  return {
    jobId: input.jobId,
    batchId: input.batch.id,
    patchCount: result.patches.length,
    unresolvedFileCount: result.unresolvedFileIds.length,
    llmAttempts: result.llmAttempts,
    llmLatencyMs: result.llmLatencyMs,
    llmProvider: result.llmProvider,
    persisted: input.persist && result.patches.length > 0,
    patches: result.patches.map((p) => ({
      id: p.id,
      filePath: p.filePath,
      confidence: p.confidence,
      status: p.status,
      appliedRuleIds: p.appliedRuleIds,
      rationale: p.rationale,
    })),
  };
}

// Made with Bob
