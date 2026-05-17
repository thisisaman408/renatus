import { z } from "zod";
import { Cartographer } from "@renatus/agents";
import {
  AuditEventRepository,
  BreakingChangeMapRepository,
} from "@renatus/db";
import { LlmRouter } from "@renatus/llm";
import { AgentKindSchema, EcosystemSchema } from "@renatus/shared";

/**
 * `plan_change` — the headline Cartographer MCP tool.
 *
 * Accepts EITHER:
 *   - `mode: 'pack'`   → deterministic lookup against bundled rule packs
 *   - `mode: 'source'` → LLM-driven rule synthesis from changelog / diff /
 *                        guide-url / refactor-intent / cve-advisory
 *
 * Returns a thin summary of the resulting Rule[] plus the cache key, cache-hit
 * flag, and (for Path B) LLM provider/latency telemetry.
 */
export const PlanChangeInputSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("pack"),
    agentKind: AgentKindSchema.default("migrate"),
    ecosystem: EcosystemSchema,
    fromVersion: z.string(),
    toVersion: z.string(),
    jobId: z.string().uuid().optional(),
  }),
  z.object({
    mode: z.literal("source"),
    agentKind: AgentKindSchema,
    sourceKind: z.enum([
      "changelog",
      "diff",
      "guide-url",
      "refactor-intent",
      "cve-advisory",
    ]),
    sourceText: z.string().min(1),
    ecosystem: EcosystemSchema.optional(),
    fromVersion: z.string().optional(),
    toVersion: z.string().optional(),
    jobId: z.string().uuid().optional(),
  }),
]);

export type PlanChangeInput = z.infer<typeof PlanChangeInputSchema>;

export const PlanChangeOutputSchema = z.object({
  cacheKey: z.string(),
  agentKind: AgentKindSchema,
  sourceKind: z.string(),
  cached: z.boolean(),
  ruleCount: z.number().int().nonnegative(),
  rules: z.array(
    z.object({
      id: z.string(),
      kind: z.string(),
      severity: z.string(),
      category: z.string(),
      title: z.string(),
    }),
  ),
  llmLatencyMs: z.number().nonnegative().optional(),
  llmProvider: z.string().optional(),
});

export type PlanChangeOutput = z.infer<typeof PlanChangeOutputSchema>;

export async function planChangeTool(
  input: PlanChangeInput,
  databaseUrl: string,
): Promise<PlanChangeOutput> {
  const router = new LlmRouter();
  const cacheRepo = new BreakingChangeMapRepository(databaseUrl);
  const auditRepo = new AuditEventRepository(databaseUrl);
  const cartographer = new Cartographer(router, cacheRepo, auditRepo);

  const result =
    input.mode === "pack"
      ? await cartographer.planFromPack({
          agentKind: input.agentKind,
          ecosystem: input.ecosystem,
          fromVersion: input.fromVersion,
          toVersion: input.toVersion,
          jobId: input.jobId,
        })
      : await cartographer.planFromSource({
          agentKind: input.agentKind,
          sourceKind: input.sourceKind,
          sourceText: input.sourceText,
          ecosystem: input.ecosystem,
          fromVersion: input.fromVersion,
          toVersion: input.toVersion,
          jobId: input.jobId,
        });

  return {
    cacheKey: result.cacheKey,
    agentKind: result.agentKind,
    sourceKind: result.sourceKind,
    cached: result.cached,
    ruleCount: result.rules.length,
    rules: result.rules.map((rule) => ({
      id: rule.id,
      kind: rule.kind,
      severity: rule.severity,
      category: rule.category,
      title: rule.title,
    })),
    llmLatencyMs: result.llmLatencyMs,
    llmProvider: result.llmProvider,
  };
}

// Made with Bob
