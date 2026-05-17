import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import type {
  AgentKind,
  Ecosystem,
  MigrationPlan,
  MigrationRule,
  ReasoningMessage,
  Rule,
} from "@renatus/shared";
import { RuleSchema } from "@renatus/shared";
import type {
  AuditEventRepository,
  BreakingChangeMapRepository,
} from "@renatus/db";
import type { LlmRouter } from "@renatus/llm";
import { emitAuditEvent } from "../audit-events/emit.js";
import { REACT_18_TO_19_RULES } from "./rules/react-18-to-19.js";
import { TAILWIND_3_TO_4_RULES } from "./rules/tailwind-3-to-4.js";
import { systemPromptFor } from "./prompts.js";
import {
  CartographerLlmValidationError,
  CartographerNotApplicableError,
  type PlanFromPackInput,
  type PlanFromSourceInput,
  type PlanResult,
  type SourceKind,
} from "./types.js";

/** Legacy plan() input shape — preserved for back-compat with cartographTool. */
export interface CartographerPlanInput {
  jobId: string;
  ecosystem: Ecosystem;
  fromVersion: string;
  toVersion: string;
}

/** Max retries on JSON.parse / Zod-validation failure in Path B. */
const MAX_LLM_VALIDATION_RETRIES = 2;

/** Schema used to validate the LLM's structured rule payload. */
const RuleArrayPayloadSchema = z.object({ rules: z.array(RuleSchema) });

/**
 * Cartographer Agent — Wave 2 dual-path implementation.
 *
 * Path A (`planFromPack`): deterministic, bundled rule packs keyed by
 * `(agentKind, ecosystem, fromVersion, toVersion)`. Used when the orchestrator
 * already knows the exact upgrade pair and a hand-curated pack exists.
 *
 * Path B (`planFromSource`): LLM-driven. Accepts a free-form upstream source
 * (changelog text, diff, guide URL contents, refactor intent, CVE advisory)
 * and asks the LLM to synthesize `Rule[]` matching the discriminated union
 * for the requested agent kind. The output is JSON-parsed and Zod-validated
 * with a retry budget — bad LLM output round-trips through the same router
 * with explicit error context until it conforms or the budget is exhausted.
 *
 * Both paths share a cache (`breaking_change_maps` + `breaking_changes`) keyed
 * on a sha256 of their inputs, so identical re-runs are free.
 */
export class Cartographer {
  constructor(
    private readonly llmRouter: LlmRouter,
    private readonly cacheRepo: BreakingChangeMapRepository,
    private readonly auditRepo: AuditEventRepository | null = null,
  ) {}

  /**
   * Path A — deterministic lookup against bundled rule packs.
   *
   * Cache key = sha256("pack" + agentKind + ecosystem + fromVersion + toVersion).
   * Throws if no pack matches — pack-based planning fails loud rather than
   * silently returning an empty plan.
   */
  async planFromPack(input: PlanFromPackInput): Promise<PlanResult> {
    if (input.agentKind === "qa") {
      throw new CartographerNotApplicableError(
        "qa agent uses the QA pipeline, not the Cartographer",
      );
    }

    if (input.jobId !== undefined) {
      await emitAuditEvent(this.auditRepo, {
        jobId: input.jobId,
        agentKind: "cartographer",
        eventType: "cartograph_started",
        payload: {
          sourceKind: "pack",
          agentKind: input.agentKind,
          ecosystem: input.ecosystem,
          fromVersion: input.fromVersion,
          toVersion: input.toVersion,
        },
      });
    }

    const cacheKey = buildPackCacheKey(
      input.agentKind,
      input.ecosystem,
      input.fromVersion,
      input.toVersion,
      input.package,
    );

    const hit = await this.cacheRepo.findByCacheKey(cacheKey);
    if (hit) {
      const rules = reconstructRulesFromCache(hit.rules);
      if (input.jobId !== undefined) {
        await emitAuditEvent(this.auditRepo, {
          jobId: input.jobId,
          agentKind: "cartographer",
          eventType: "cartograph_completed",
          payload: {
            cacheKey,
            cached: true,
            ruleCount: rules.length,
            sourceKind: "pack",
          },
        });
      }
      return {
        cacheKey,
        agentKind: input.agentKind,
        sourceKind: "pack",
        cached: true,
        rules,
      };
    }

    // Miss → resolve from the bundled-packs registry.
    const rules = resolvePackRules(
      input.agentKind,
      input.ecosystem,
      input.fromVersion,
      input.toVersion,
      input.package,
    );

    if (rules.length === 0) {
      const reason = `No bundled rule pack for (agentKind=${input.agentKind}, ecosystem=${input.ecosystem}, ${input.fromVersion}→${input.toVersion}). ` +
        `Use planFromSource() with a changelog/diff/guide-url instead.`;
      if (input.jobId !== undefined) {
        await emitAuditEvent(this.auditRepo, {
          jobId: input.jobId,
          agentKind: "cartographer",
          eventType: "cartograph_failed",
          payload: { reason, attempts: 0, sourceKind: "pack" },
        });
      }
      throw new Error(reason);
    }

    await this.cacheRepo.save({
      cacheKey,
      agentKind: input.agentKind,
      sourceKind: "pack",
      ecosystem: input.ecosystem,
      fromVersion: input.fromVersion,
      toVersion: input.toVersion,
      rules,
    });

    if (input.jobId !== undefined) {
      await emitAuditEvent(this.auditRepo, {
        jobId: input.jobId,
        agentKind: "cartographer",
        eventType: "cartograph_completed",
        payload: {
          cacheKey,
          cached: false,
          ruleCount: rules.length,
          sourceKind: "pack",
        },
      });
    }

    return {
      cacheKey,
      agentKind: input.agentKind,
      sourceKind: "pack",
      cached: false,
      rules,
    };
  }

  /**
   * Path B — LLM-driven rule synthesis. The headline unlock.
   *
   * Cache key = sha256(sourceText + sourceKind + agentKind). On miss, calls
   * the LLM with an agent-kind-specific system prompt, parses + Zod-validates
   * the response, and retries with explicit error context (up to
   * MAX_LLM_VALIDATION_RETRIES times) before throwing
   * `CartographerLlmValidationError`.
   */
  async planFromSource(input: PlanFromSourceInput): Promise<PlanResult> {
    if (input.agentKind === "qa") {
      throw new CartographerNotApplicableError(
        "qa agent uses the QA pipeline, not the Cartographer",
      );
    }

    if (input.jobId !== undefined) {
      await emitAuditEvent(this.auditRepo, {
        jobId: input.jobId,
        agentKind: "cartographer",
        eventType: "cartograph_started",
        payload: {
          sourceKind: input.sourceKind,
          agentKind: input.agentKind,
          ecosystem: input.ecosystem,
          fromVersion: input.fromVersion,
          toVersion: input.toVersion,
        },
      });
    }

    const cacheKey = buildSourceCacheKey(
      input.sourceText,
      input.sourceKind,
      input.agentKind,
    );

    const hit = await this.cacheRepo.findByCacheKey(cacheKey);
    if (hit) {
      const rules = reconstructRulesFromCache(hit.rules);
      if (input.jobId !== undefined) {
        await emitAuditEvent(this.auditRepo, {
          jobId: input.jobId,
          agentKind: "cartographer",
          eventType: "cartograph_completed",
          payload: {
            cacheKey,
            cached: true,
            ruleCount: rules.length,
            sourceKind: input.sourceKind,
          },
        });
      }
      return {
        cacheKey,
        agentKind: input.agentKind,
        sourceKind: input.sourceKind,
        cached: true,
        rules,
      };
    }

    const system = systemPromptFor(input.agentKind);
    const userMessage = buildUserMessage(input);

    let elicited: {
      rules: Rule[];
      latencyMs: number;
      provider: string;
      lastRaw: string;
    };
    try {
      elicited = await this.elicitRulesWithRetry(system, userMessage, {
        cacheKey,
        agentKind: input.agentKind,
        sourceKind: input.sourceKind,
        jobId: input.jobId,
      });
    } catch (error) {
      if (
        input.jobId !== undefined &&
        error instanceof CartographerLlmValidationError
      ) {
        await emitAuditEvent(this.auditRepo, {
          jobId: input.jobId,
          agentKind: "cartographer",
          eventType: "cartograph_failed",
          payload: {
            reason: error.message,
            attempts: error.attempts,
            sourceKind: input.sourceKind,
          },
        });
      }
      throw error;
    }

    const { rules, latencyMs, provider, lastRaw } = elicited;

    // lastRaw is unused once we get here, but keeping the destructure makes
    // the success-path return clear about what was discarded.
    void lastRaw;

    await this.cacheRepo.save({
      cacheKey,
      agentKind: input.agentKind,
      sourceKind: input.sourceKind,
      ecosystem: input.ecosystem,
      fromVersion: input.fromVersion,
      toVersion: input.toVersion,
      rules,
    });

    if (input.jobId !== undefined) {
      await emitAuditEvent(this.auditRepo, {
        jobId: input.jobId,
        agentKind: "cartographer",
        eventType: "cartograph_completed",
        payload: {
          cacheKey,
          cached: false,
          ruleCount: rules.length,
          sourceKind: input.sourceKind,
          llmLatencyMs: latencyMs,
          llmProvider: provider,
        },
      });
    }

    return {
      cacheKey,
      agentKind: input.agentKind,
      sourceKind: input.sourceKind,
      cached: false,
      rules,
      llmLatencyMs: latencyMs,
      llmProvider: provider,
    };
  }

  /**
   * Back-compat shim for the existing `cartograph_repository` MCP tool. Calls
   * `planFromPack` with `agentKind: 'migrate'` and shapes the result into the
   * legacy `MigrationPlan` envelope.
   */
  async plan(input: CartographerPlanInput): Promise<MigrationPlan> {
    const result = await this.planFromPack({
      agentKind: "migrate",
      ecosystem: input.ecosystem,
      fromVersion: input.fromVersion,
      toVersion: input.toVersion,
      jobId: input.jobId,
    });

    // planFromPack with agentKind=migrate is guaranteed to return MigrationRule[].
    const migrationRules = result.rules.filter(
      (r): r is MigrationRule => r.kind === "migration",
    );

    return {
      id: randomUUID(),
      jobId: input.jobId,
      ecosystem: input.ecosystem,
      fromVersion: input.fromVersion,
      toVersion: input.toVersion,
      rules: migrationRules,
      createdAt: new Date(),
    };
  }

  /**
   * Drive the LLM-call → JSON.parse → Zod-validate loop with retries.
   *
   * On each failure we append the prior assistant turn plus a new user turn
   * carrying the parse / schema error so the model has explicit context for
   * what to fix. After MAX_LLM_VALIDATION_RETRIES failed attempts we throw
   * `CartographerLlmValidationError` with the last raw output attached.
   */
  private async elicitRulesWithRetry(
    system: string,
    initialUserMessage: string,
    metadata: {
      cacheKey: string;
      agentKind: AgentKind;
      sourceKind: SourceKind;
      jobId?: string;
    },
  ): Promise<{
    rules: Rule[];
    latencyMs: number;
    provider: string;
    lastRaw: string;
  }> {
    const messages: ReasoningMessage[] = [
      { role: "user", content: initialUserMessage },
    ];
    let lastRaw = "";
    let lastError: unknown = null;

    for (let attempt = 0; attempt <= MAX_LLM_VALIDATION_RETRIES; attempt += 1) {
      const response = await this.llmRouter.reason({
        system,
        messages,
        responseFormat: "rule-classification",
        maxTokens: 4096,
        temperature: 0.1,
        metadata: {
          cacheKey: metadata.cacheKey,
          agentKind: metadata.agentKind,
          sourceKind: metadata.sourceKind,
          attempt,
        },
      });

      lastRaw = response.content;
      const stripped = stripCodeFence(response.content);

      // Stage 1: JSON.parse
      let parsed: unknown;
      try {
        parsed = JSON.parse(stripped);
      } catch (err) {
        lastError = err;
        const errMessage = err instanceof Error ? err.message : String(err);
        if (attempt === MAX_LLM_VALIDATION_RETRIES) {
          break;
        }
        if (metadata.jobId !== undefined) {
          await emitAuditEvent(this.auditRepo, {
            jobId: metadata.jobId,
            agentKind: "cartographer",
            eventType: "cartograph_retry",
            payload: { attempt, lastError: errMessage, stage: "json_parse" },
          });
        }
        messages.push({ role: "assistant", content: response.content });
        messages.push({
          role: "user",
          content: `Your previous response was not valid JSON: ${errMessage}. Return ONLY a JSON object with key 'rules' matching the schema. Do not include markdown fences, comments, or any prose.`,
        });
        continue;
      }

      // Stage 2: Zod-validate against { rules: Rule[] }
      const validation = RuleArrayPayloadSchema.safeParse(parsed);
      if (!validation.success) {
        lastError = validation.error;
        if (attempt === MAX_LLM_VALIDATION_RETRIES) {
          break;
        }
        const issues = validation.error.errors
          .map((issue) => `- ${issue.path.join(".") || "(root)"}: ${issue.message}`)
          .join("\n");
        if (metadata.jobId !== undefined) {
          await emitAuditEvent(this.auditRepo, {
            jobId: metadata.jobId,
            agentKind: "cartographer",
            eventType: "cartograph_retry",
            payload: { attempt, lastError: issues, stage: "zod_validate" },
          });
        }
        messages.push({ role: "assistant", content: response.content });
        messages.push({
          role: "user",
          content: `Your previous response failed schema validation:\n${issues}\nReturn ONLY a JSON object with key 'rules' matching the schema. Do not include markdown fences, comments, or any prose.`,
        });
        continue;
      }

      return {
        rules: validation.data.rules,
        latencyMs: response.latencyMs,
        provider: response.provider,
        lastRaw,
      };
    }

    const reason =
      lastError instanceof Error ? lastError.message : String(lastError);
    throw new CartographerLlmValidationError(
      `LLM failed to produce schema-valid Rule[] after ${MAX_LLM_VALIDATION_RETRIES + 1} attempts: ${reason}`,
      lastRaw,
      MAX_LLM_VALIDATION_RETRIES + 1,
    );
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers (file-local; not exported)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Build the Path A cache key. Stable across processes because it's a pure
 * sha256 of concatenated identifiers. `package` is included when the caller
 * disambiguates so explicit and ambiguous lookups never share a row.
 */
function buildPackCacheKey(
  agentKind: AgentKind,
  ecosystem: Ecosystem,
  fromVersion: string,
  toVersion: string,
  pkg?: string,
): string {
  return createHash("sha256")
    .update(
      "pack" + agentKind + ecosystem + fromVersion + toVersion + (pkg ?? ""),
    )
    .digest("hex");
}

/**
 * Build the Path B cache key. Same source text + source kind + agent kind
 * always yields the same key so re-runs of an identical changelog/diff are
 * free.
 */
function buildSourceCacheKey(
  sourceText: string,
  sourceKind: SourceKind,
  agentKind: AgentKind,
): string {
  return createHash("sha256")
    .update(sourceText + sourceKind + agentKind)
    .digest("hex");
}

/**
 * Compose the user-turn payload for Path B. Optional context fields are only
 * included when present so the prompt stays tight on small inputs.
 */
function buildUserMessage(input: PlanFromSourceInput): string {
  const lines: string[] = [`Source kind: ${input.sourceKind}`];
  if (input.ecosystem) lines.push(`Ecosystem: ${input.ecosystem}`);
  if (input.fromVersion) lines.push(`From: ${input.fromVersion}`);
  if (input.toVersion) lines.push(`To: ${input.toVersion}`);
  lines.push("");
  lines.push("---SOURCE---");
  lines.push(input.sourceText);
  return lines.join("\n");
}

/**
 * Strip a leading/trailing ```json … ``` (or ``` … ```) markdown fence if the
 * LLM ignored the JSON-only instruction. Idempotent on already-clean input.
 */
function stripCodeFence(text: string): string {
  let s = text.trim();
  // Leading fence: ```json\n or ```\n
  const fenceOpen = s.match(/^```(?:json|JSON)?\s*\n?/);
  if (fenceOpen) {
    s = s.slice(fenceOpen[0].length);
  }
  // Trailing fence: \n```
  const fenceClose = s.match(/\n?```\s*$/);
  if (fenceClose) {
    s = s.slice(0, s.length - fenceClose[0].length);
  }
  return s.trim();
}

/**
 * Reconstruct `Rule[]` from a `breaking_changes` cache row set. The `payload`
 * jsonb column round-trips the full Zod-validated Rule, so we re-parse it
 * defensively in case the on-disk shape has drifted from the current schema.
 */
function reconstructRulesFromCache(
  rows: Array<{ payload: unknown }>,
): Rule[] {
  return rows.map((row) => RuleSchema.parse(row.payload));
}

/**
 * Bundled-packs registry. Each row binds an (ecosystem, package?, fromMajor,
 * toMajor) tuple to a frozen list of MigrationRule.
 *
 * Adding a new pack: drop the rules file in `./rules/`, import it above, and
 * append a row here. The lookup is exact major-version equality; minor /
 * patch are ignored.
 */
const BUNDLED_PACKS: ReadonlyArray<{
  ecosystem: Ecosystem;
  /** Optional — used when multiple packs share an ecosystem + major pair. */
  package?: string;
  fromMajor: number;
  toMajor: number;
  rules: readonly MigrationRule[];
}> = [
  {
    ecosystem: "npm",
    package: "react",
    fromMajor: 18,
    toMajor: 19,
    rules: REACT_18_TO_19_RULES,
  },
  {
    ecosystem: "npm",
    package: "tailwindcss",
    fromMajor: 3,
    toMajor: 4,
    rules: TAILWIND_3_TO_4_RULES,
  },
];

/**
 * Pack-based rule resolution. Walks `BUNDLED_PACKS` and concatenates the rules
 * of every row whose (ecosystem, fromMajor, toMajor) matches the input. When
 * `pkg` is provided we further restrict to packs whose `package === pkg`,
 * letting callers disambiguate when the same major-version pair maps to
 * different ecosystems.
 *
 * Returns `[]` when nothing matches — the caller decides whether that's an
 * error.
 */
function resolvePackRules(
  agentKind: AgentKind,
  ecosystem: Ecosystem,
  fromVersion: string,
  toVersion: string,
  pkg?: string,
): Rule[] {
  if (agentKind !== "migrate") {
    return [];
  }

  const inputFromMajor = extractMajorVersion(fromVersion);
  const inputToMajor = extractMajorVersion(toVersion);

  const matchingPacks = BUNDLED_PACKS.filter((pack) => {
    if (pack.ecosystem !== ecosystem) return false;
    if (pack.fromMajor !== inputFromMajor) return false;
    if (pack.toMajor !== inputToMajor) return false;
    if (pkg !== undefined && pack.package !== pkg) return false;
    return true;
  });

  return matchingPacks.flatMap((pack) => pack.rules.slice());
}

function extractMajorVersion(version: string): number {
  const match = version.match(/(\d+)/);
  return match && match[1] ? parseInt(match[1], 10) : 0;
}

// Re-export the public types for ergonomic consumption alongside the class.
export {
  CartographerLlmValidationError,
  CartographerNotApplicableError,
} from "./types.js";
export type {
  PlanFromPackInput,
  PlanFromSourceInput,
  PlanResult,
  PlanResultSourceKind,
  SourceKind,
} from "./types.js";

// Made with Bob
