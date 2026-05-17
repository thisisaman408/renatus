import { z } from "zod";
import { Cartographer } from "@renatus/agents";
import {
  AuditEventRepository,
  BreakingChangeMapRepository,
  MigrationPlanRepository,
} from "@renatus/db";
import { LlmRouter } from "@renatus/llm";
import { EcosystemSchema } from "@renatus/shared";

export const CartographInputSchema = z.object({
  jobId: z.string().uuid().describe("The job ID to associate with this plan"),
  ecosystem: EcosystemSchema.describe("The package ecosystem (npm, pypi, etc.)"),
  fromVersion: z.string().describe("Source version to migrate from"),
  toVersion: z.string().describe("Target version to migrate to"),
});

export type CartographInput = z.infer<typeof CartographInputSchema>;

export const CartographOutputSchema = z.object({
  planId: z.string().uuid(),
  jobId: z.string().uuid(),
  ecosystem: z.string(),
  fromVersion: z.string(),
  toVersion: z.string(),
  ruleCount: z.number(),
  rules: z.array(
    z.object({
      id: z.string(),
      severity: z.string(),
      category: z.string(),
      title: z.string(),
    })
  ),
  createdAt: z.string(),
});

export type CartographOutput = z.infer<typeof CartographOutputSchema>;

/**
 * Cartograph Repository Tool
 * 
 * Generates a migration plan for a given version-to-version migration.
 * This is the Cartographer agent's entry point via MCP.
 * 
 * Wave 2 implementation is deterministic (no LLM) - it filters hardcoded
 * rule packs by ecosystem and version range.
 */
export async function cartographTool(
  input: CartographInput,
  databaseUrl: string
): Promise<CartographOutput> {
  // Initialize the Cartographer agent. The constructor now requires an LLM
  // router (Path B) and a cache repository (shared across both paths). The
  // legacy `.plan()` call below only exercises Path A (pack lookup), but we
  // still wire the router for forward-compat.
  const router = new LlmRouter();
  const cacheRepo = new BreakingChangeMapRepository(databaseUrl);
  const auditRepo = new AuditEventRepository(databaseUrl);
  const cartographer = new Cartographer(router, cacheRepo, auditRepo);

  // Generate the migration plan
  const plan = await cartographer.plan({
    jobId: input.jobId,
    ecosystem: input.ecosystem,
    fromVersion: input.fromVersion,
    toVersion: input.toVersion,
  });

  // Persist the plan to the database
  const repository = new MigrationPlanRepository(databaseUrl);
  await repository.save(plan);

  // Return a summary of the plan
  return {
    planId: plan.id,
    jobId: plan.jobId,
    ecosystem: plan.ecosystem,
    fromVersion: plan.fromVersion,
    toVersion: plan.toVersion,
    ruleCount: plan.rules.length,
    rules: plan.rules.map((rule: any) => ({ // rationale: MigrationRule type from @renatus/shared will be available after build
      id: rule.id,
      severity: rule.severity,
      category: rule.category,
      title: rule.title,
    })),
    createdAt: plan.createdAt.toISOString(),
  };
}

// Made with Bob