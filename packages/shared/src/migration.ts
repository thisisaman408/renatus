import { z } from "zod";
import { EcosystemSchema } from "./schemas.js";

/**
 * Severity levels for rules (migration / refactor / mitigation).
 * - blocker: Must be fixed before the operation can proceed
 * - breaking: Will cause runtime errors if not addressed
 * - warning: May cause issues but not guaranteed
 * - info: Informational, best practice recommendation
 */
export const RuleSeveritySchema = z.enum([
  "blocker",
  "breaking",
  "warning",
  "info",
]);
export type RuleSeverity = z.infer<typeof RuleSeveritySchema>;

/**
 * Categories of migration rules based on the type of change.
 */
export const RuleCategorySchema = z.enum([
  "api-removal",
  "api-rename",
  "api-signature-change",
  "deprecation",
  "config-change",
  "dependency-bump",
]);
export type RuleCategory = z.infer<typeof RuleCategorySchema>;

/**
 * Detection strategy for identifying affected code.
 */
export const DetectStrategySchema = z.object({
  kind: z.enum(["pattern", "ast"]),
  expr: z.string().describe("Regex pattern or AST query expression"),
});
export type DetectStrategy = z.infer<typeof DetectStrategySchema>;

/**
 * Fix strategy for applying the migration.
 */
export const FixStrategySchema = z.object({
  kind: z.enum(["codemod", "manual"]),
  expr: z.string().optional().describe("Codemod expression if automated"),
  instructions: z.string().optional().describe("Manual fix instructions"),
});
export type FixStrategy = z.infer<typeof FixStrategySchema>;

/**
 * Shared base shape across every rule kind (migration / refactor / mitigation).
 * Domain-specific kinds extend this with their own fields and discriminator.
 */
export const RuleBaseShape = {
  id: z.string().describe("Kebab-case unique identifier"),
  severity: RuleSeveritySchema,
  title: z.string().describe("Human-readable title"),
  rationale: z.string().describe("Why this change was made"),
  detect: DetectStrategySchema,
  fix: FixStrategySchema.optional(),
} as const;

/**
 * A single migration rule describing a breaking change in a dependency upgrade.
 *
 * Carries `kind: 'migration'` as the discriminator for the union `Rule` type in
 * `./rule.ts`. The discriminator defaults to `'migration'` so existing rule-pack
 * literals that omit the field continue to parse.
 */
export const MigrationRuleSchema = z.object({
  ...RuleBaseShape,
  kind: z.literal("migration").default("migration"),
  category: RuleCategorySchema,
  fromVersion: z.string().describe("Semver range of affected versions"),
  toVersion: z.string().describe("Semver range of target versions"),
  ecosystem: EcosystemSchema,
});
export type MigrationRule = z.infer<typeof MigrationRuleSchema>;

/**
 * A complete migration plan for a job.
 */
export const MigrationPlanSchema = z.object({
  id: z.string().uuid().describe("Unique plan identifier"),
  jobId: z.string().uuid().describe("Associated job ID"),
  ecosystem: EcosystemSchema,
  fromVersion: z.string().describe("Source version"),
  toVersion: z.string().describe("Target version"),
  rules: z.array(MigrationRuleSchema),
  createdAt: z.date(),
});
export type MigrationPlan = z.infer<typeof MigrationPlanSchema>;

// Made with Bob
