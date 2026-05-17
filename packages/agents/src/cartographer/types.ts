import { z } from "zod";
import {
  AgentKindSchema,
  EcosystemSchema,
  RuleSchema,
} from "@renatus/shared";

/**
 * Source kinds accepted by `planFromSource` (Path B). Mirrors the
 * `RuleSourceSchema` discriminator minus `pack` (which has its own path).
 */
export const SourceKindSchema = z.enum([
  "changelog",
  "diff",
  "guide-url",
  "refactor-intent",
  "cve-advisory",
]);
export type SourceKind = z.infer<typeof SourceKindSchema>;

/**
 * `PlanResult.sourceKind` widens `SourceKindSchema` with `'pack'` so the same
 * shape covers Path A and Path B return values.
 */
export const PlanResultSourceKindSchema = z.enum([
  "pack",
  "changelog",
  "diff",
  "guide-url",
  "refactor-intent",
  "cve-advisory",
]);
export type PlanResultSourceKind = z.infer<typeof PlanResultSourceKindSchema>;

export const PlanFromPackInputSchema = z.object({
  agentKind: AgentKindSchema.default("migrate"),
  ecosystem: EcosystemSchema,
  fromVersion: z.string(),
  toVersion: z.string(),
  /**
   * Optional npm package name to disambiguate when multiple bundled packs
   * share the same (ecosystem, fromMajor, toMajor) tuple — e.g. "react" or
   * "tailwindcss". When unset, the registry returns every pack that matches
   * the ecosystem + major-version pair.
   */
  package: z
    .string()
    .optional()
    .describe(
      "Optional npm package name to disambiguate, e.g., 'react' or 'tailwindcss'",
    ),
  /** Optional — callers may want pack rules without an owning job (preview). */
  jobId: z.string().uuid().optional(),
});
export type PlanFromPackInput = z.infer<typeof PlanFromPackInputSchema>;

export const PlanFromSourceInputSchema = z.object({
  agentKind: AgentKindSchema,
  sourceKind: SourceKindSchema,
  sourceText: z.string().min(1),
  ecosystem: EcosystemSchema.optional(),
  fromVersion: z.string().optional(),
  toVersion: z.string().optional(),
  jobId: z.string().uuid().optional(),
});
export type PlanFromSourceInput = z.infer<typeof PlanFromSourceInputSchema>;

export const PlanResultSchema = z.object({
  cacheKey: z.string(),
  agentKind: AgentKindSchema,
  sourceKind: PlanResultSourceKindSchema,
  /** true on cache hit; false on freshly generated. */
  cached: z.boolean(),
  rules: z.array(RuleSchema),
  llmLatencyMs: z.number().nonnegative().optional(),
  llmProvider: z.string().optional(),
});
export type PlanResult = z.infer<typeof PlanResultSchema>;

/**
 * Thrown when the LLM output cannot be coerced into `{ rules: Rule[] }` after
 * the configured retry budget is exhausted. Carries the last raw output so the
 * caller (or audit log) can inspect what went wrong.
 */
export class CartographerLlmValidationError extends Error {
  override readonly name = "CartographerLlmValidationError" as const;
  readonly lastRawOutput: string;
  readonly attempts: number;

  constructor(message: string, lastRawOutput: string, attempts: number) {
    super(message);
    this.lastRawOutput = lastRawOutput;
    this.attempts = attempts;
  }
}

/**
 * Thrown when the Cartographer is invoked for an agent kind it doesn't serve
 * (currently: `qa`, which runs through its own pipeline).
 */
export class CartographerNotApplicableError extends Error {
  override readonly name = "CartographerNotApplicableError" as const;
  constructor(message: string) {
    super(message);
  }
}

// Made with Bob
