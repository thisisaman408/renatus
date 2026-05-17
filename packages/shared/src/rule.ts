import { z } from "zod";
import { EcosystemSchema } from "./schemas.js";
import {
  MigrationRuleSchema,
  RuleBaseShape,
} from "./migration.js";

/**
 * Categories of refactor rules.
 */
export const RefactorCategorySchema = z.enum([
  "rename",
  "move",
  "extract",
  "inline",
  "signature-change",
]);
export type RefactorCategory = z.infer<typeof RefactorCategorySchema>;

/**
 * A refactor rule — non-version-tied transformation of source code.
 *
 * Used by the refactor agent variant. Discriminator: `kind: 'refactor'`.
 */
export const RefactorRuleSchema = z.object({
  ...RuleBaseShape,
  kind: z.literal("refactor"),
  category: RefactorCategorySchema,
  scope: z.string().optional().describe("Optional module / directory scope"),
  from: z
    .string()
    .optional()
    .describe("Source symbol or path (for rename / move)"),
  to: z
    .string()
    .optional()
    .describe("Target symbol or path (for rename / move)"),
  intent: z.string().describe("Free-form description of the refactor intent"),
});
export type RefactorRule = z.infer<typeof RefactorRuleSchema>;

/**
 * Categories of security mitigation rules, aligned with OWASP-style buckets.
 */
export const MitigationCategorySchema = z.enum([
  "input-validation",
  "output-encoding",
  "access-control",
  "crypto",
  "sensitive-data",
  "other",
]);
export type MitigationCategory = z.infer<typeof MitigationCategorySchema>;

/**
 * A security mitigation rule — patch for a known vulnerability class.
 *
 * Used by the security audit agent variant. Discriminator: `kind: 'mitigation'`.
 */
export const MitigationRuleSchema = z.object({
  ...RuleBaseShape,
  kind: z.literal("mitigation"),
  category: MitigationCategorySchema,
  cveId: z.string().optional().describe("CVE identifier if applicable"),
  cweId: z.string().optional().describe("CWE identifier if applicable"),
});
export type MitigationRule = z.infer<typeof MitigationRuleSchema>;

/**
 * Discriminated union over all rule kinds. Downstream agents (Surgeon, Examiner,
 * Auditor) consume `Rule` and switch on `kind` to dispatch.
 */
export const RuleSchema = z.discriminatedUnion("kind", [
  MigrationRuleSchema,
  RefactorRuleSchema,
  MitigationRuleSchema,
]);
export type Rule = z.infer<typeof RuleSchema>;

/**
 * RuleSource — the upstream input that the Cartographer compiles into rules.
 *
 * Discriminated on `kind`. `pack` uses curated rule packs; `changelog` / `diff` /
 * `guide-url` feed raw text to the LLM-elicitation path; `refactor-intent` and
 * `cve-advisory` cover the non-migration agent variants.
 */
export const RuleSourceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("pack"),
    ecosystem: EcosystemSchema,
    fromVersion: z.string(),
    toVersion: z.string(),
  }),
  z.object({
    kind: z.literal("changelog"),
    sourceText: z.string(),
    ecosystem: EcosystemSchema.optional(),
    fromVersion: z.string().optional(),
    toVersion: z.string().optional(),
  }),
  z.object({
    kind: z.literal("diff"),
    sourceText: z.string(),
    ecosystem: EcosystemSchema.optional(),
    fromVersion: z.string().optional(),
    toVersion: z.string().optional(),
  }),
  z.object({
    kind: z.literal("guide-url"),
    sourceText: z.string().describe("Either URL or fetched URL content"),
    ecosystem: EcosystemSchema.optional(),
    fromVersion: z.string().optional(),
    toVersion: z.string().optional(),
  }),
  z.object({
    kind: z.literal("refactor-intent"),
    sourceText: z.string(),
  }),
  z.object({
    kind: z.literal("cve-advisory"),
    sourceText: z.string(),
  }),
]);
export type RuleSource = z.infer<typeof RuleSourceSchema>;

// Made with Bob
