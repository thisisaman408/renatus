import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import {
  DiagnosticCategory,
  Project,
  ScriptKind,
  type SourceFile,
} from "ts-morph";
import { z } from "zod";
import type {
  AgentKind,
  Patch,
  ReasoningMessage,
  Rule,
} from "@renatus/shared";
import type { LlmRouter } from "@renatus/llm";
import type { AuditEventRepository, PatchRepository } from "@renatus/db";
import type { FileBatch } from "../retrieval/index.js";
import { emitAuditEvent } from "../audit-events/emit.js";
import { surgeonSystemPromptFor } from "./prompts.js";
import { SurgeonNotApplicableError } from "./errors.js";

/** Total LLM rounds = 1 initial + this many retries. */
const MAX_LLM_VALIDATION_RETRIES = 2;

/**
 * Confidence scoring table (SYSTEM-DESIGN.md §5.2).
 *
 *  1.00 — codemod-cache hit (NOT wired in Wave 2; never emitted here)
 *  0.85 — clean LLM output on attempt 0
 *  0.70 — LLM needed 1 validation retry
 *  0.50 — LLM needed 2 validation retries
 *  0.30 — LLM gave up (stub Patch with status='unresolved')
 */
const CONFIDENCE_BY_RETRIES: readonly number[] = [0.85, 0.7, 0.5];
const UNRESOLVED_CONFIDENCE = 0.3;

/** Discriminator used by ts-morph to pick the right parser per extension. */
const SCRIPT_KIND_BY_EXT: ReadonlyMap<string, ScriptKind> = new Map([
  ["ts", ScriptKind.TS],
  ["tsx", ScriptKind.TSX],
  ["js", ScriptKind.JS],
  ["jsx", ScriptKind.JSX],
  ["mts", ScriptKind.TS],
  ["cts", ScriptKind.TS],
  ["mjs", ScriptKind.JS],
  ["cjs", ScriptKind.JS],
]);

/** Extensions that are subject to ts-morph syntactic validation. */
const PARSEABLE_EXT_RE = /\.(ts|tsx|js|jsx|mts|cts|mjs|cjs)$/i;

/**
 * Zod shape we expect the LLM to emit. Whole-file replacement — `after`
 * carries the complete new file contents, never a diff.
 */
const LlmPatchResponseSchema = z.object({
  patches: z.array(
    z.object({
      filePath: z.string().min(1),
      after: z.string(),
      rationale: z.string().optional(),
    }),
  ),
});

type LlmPatchResponse = z.infer<typeof LlmPatchResponseSchema>;

/**
 * Input handed to {@link SurgeonService.migrateBatch}.
 *
 * The batch comes verbatim from {@link RetrievalService.retrieve}; rules are
 * the subset of the Cartographer's plan that retrieval attributed to this
 * batch (caller is responsible for narrowing to `batch.ruleIds`).
 */
export interface MigrateBatchInput {
  jobId: string;
  batch: FileBatch;
  rules: Rule[];
  agentKind: AgentKind;
}

/**
 * Output from {@link SurgeonService.migrateBatch}. Pure — the caller chooses
 * whether to persist via {@link SurgeonService.persistPatches}.
 *
 * Invariants:
 *   - `patches` contains zero or more `Patch` rows with `status: 'proposed'`
 *     OR `status: 'unresolved'`. No-ops (after === before) are filtered out.
 *   - `unresolvedFileIds` lists the `fileId`s for which the LLM gave up
 *     after retries — these are mirrored by a stub `Patch` with confidence
 *     0.30 and status 'unresolved' in `patches`.
 *   - `llmAttempts` is 1 + the number of retries actually consumed
 *     (NOT necessarily MAX_LLM_VALIDATION_RETRIES + 1).
 */
export interface MigrateBatchResult {
  patches: Patch[];
  unresolvedFileIds: string[];
  llmAttempts: number;
  llmLatencyMs: number;
  llmProvider: string;
}

/**
 * SurgeonService — the heart of Renatus (SYSTEM-DESIGN.md §5.2).
 *
 * Drives the LLM → ts-morph-validate → retry-with-feedback loop that
 * transforms a `FileBatch` + `Rule[]` into a set of proposed `Patch` rows.
 *
 * Stateless aside from its two injected collaborators. `migrateBatch` is
 * pure with respect to its inputs (no mutation, no DB writes); persistence
 * is opt-in via `persistPatches`, so dry-runs and tool harnesses can exercise
 * the full pipeline without touching Postgres.
 */
export class SurgeonService {
  constructor(
    private readonly llmRouter: LlmRouter,
    private readonly patchRepo: PatchRepository,
    private readonly auditRepo: AuditEventRepository | null = null,
  ) {}

  async migrateBatch(input: MigrateBatchInput): Promise<MigrateBatchResult> {
    if (input.agentKind === "qa") {
      throw new SurgeonNotApplicableError(
        "qa agent uses the QA pipeline, not the Surgeon",
      );
    }

    await emitAuditEvent(this.auditRepo, {
      jobId: input.jobId,
      agentKind: "surgeon",
      eventType: "patch_started",
      payload: {
        batchId: input.batch.id,
        fileCount: input.batch.files.length,
        ruleCount: input.rules.length,
        agentKind: input.agentKind,
      },
    });

    // 1. Materialize the "before" contents for every file in the batch.
    //    Failing here is louder than failing later — the LLM needs the full
    //    picture, so a missing file is an abort, not a skip.
    const beforeByPath = await readBatchContents(input.batch);

    // 2. Compose prompts. The system prompt is agent-kind-specific; the user
    //    message bundles the rules + every file's full contents.
    const system = surgeonSystemPromptFor(input.agentKind);
    const initialUserMessage = buildUserMessage(input.batch, input.rules, beforeByPath);

    // 3. Drive the LLM-call → parse → Zod-validate → ts-morph-validate loop.
    //    `retriesUsed` is the count of *validation* retries the LLM consumed
    //    (0, 1, or 2) — feeds the confidence-scoring table.
    //
    //    On total retry exhaustion `elicitPatchesWithRetry` returns
    //    `{ gaveUp: true }` instead of throwing — the Surgeon then emits stub
    //    unresolved Patch rows for every file in the batch so the auditor
    //    can observe the failure rather than seeing a vanished job.
    const elicited = await this.elicitPatchesWithRetry(
      system,
      initialUserMessage,
      {
        jobId: input.jobId,
        batchId: input.batch.id,
        agentKind: input.agentKind,
      },
      beforeByPath,
    );

    const appliedRuleIds = input.rules.map((r) => r.id);
    const createdAt = new Date();

    if (elicited.gaveUp) {
      // 4a. The LLM exhausted its retry budget. Emit a stub Patch with
      //     status='unresolved' and confidence=0.30 for each file in the
      //     batch so the auditor has a row per attribution.
      await emitAuditEvent(this.auditRepo, {
        jobId: input.jobId,
        agentKind: "surgeon",
        eventType: "surgeon_gave_up",
        payload: {
          batchId: input.batch.id,
          attempts: elicited.attempts,
          lastError: elicited.failureReason,
        },
      });

      const patches: Patch[] = input.batch.files.map((meta) => {
        const before = beforeByPath.get(meta.filePath) ?? "";
        return {
          id: randomUUID(),
          jobId: input.jobId,
          snapshotId: input.batch.snapshotId,
          fileId: meta.fileId,
          filePath: meta.filePath,
          before,
          after: before,
          appliedRuleIds,
          confidence: UNRESOLVED_CONFIDENCE,
          status: "unresolved",
          rationale: `LLM unable to produce valid patch after ${elicited.attempts} attempts: ${elicited.failureReason}`,
          retries: MAX_LLM_VALIDATION_RETRIES,
          createdAt,
        };
      });

      for (const patch of patches) {
        await emitAuditEvent(this.auditRepo, {
          jobId: input.jobId,
          agentKind: "surgeon",
          eventType: "patch_unresolved",
          payload: {
            fileId: patch.fileId,
            filePath: patch.filePath,
            lastError: elicited.failureReason,
          },
          entityId: patch.fileId,
          entityType: "file",
        });
      }

      await emitAuditEvent(this.auditRepo, {
        jobId: input.jobId,
        agentKind: "surgeon",
        eventType: "patch_batch_completed",
        payload: {
          batchId: input.batch.id,
          patchCount: 0,
          unresolvedCount: patches.length,
          llmAttempts: elicited.attempts,
          llmLatencyMs: elicited.latencyMs,
          llmProvider: elicited.provider,
        },
      });

      return {
        patches,
        unresolvedFileIds: input.batch.files.map((f) => f.fileId),
        llmAttempts: elicited.attempts,
        llmLatencyMs: elicited.latencyMs,
        llmProvider: elicited.provider,
      };
    }

    // 4b. Happy path. Map the LLM's whole-file replacements onto Patch rows.
    //     Files in the batch that the LLM omitted are treated as "no-op
    //     needed" — NOT unresolved — and produce no Patch row.
    const patches: Patch[] = [];
    const fileMetaByPath = new Map(
      input.batch.files.map((f) => [f.filePath, f] as const),
    );
    const confidence = confidenceForRetries(elicited.retriesUsed);

    for (const llmPatch of elicited.response.patches) {
      const meta = fileMetaByPath.get(llmPatch.filePath);
      if (meta === undefined) {
        // LLM hallucinated a path not in the batch — silently drop. The
        // Auditor will flag the missing audit trail in Wave 3.
        continue;
      }

      const before = beforeByPath.get(llmPatch.filePath);
      if (before === undefined) continue; // defensive — keyed identically

      if (llmPatch.after === before) {
        // No-op: LLM emitted a "patch" identical to the input. Skip.
        continue;
      }

      patches.push({
        id: randomUUID(),
        jobId: input.jobId,
        snapshotId: input.batch.snapshotId,
        fileId: meta.fileId,
        filePath: meta.filePath,
        before,
        after: llmPatch.after,
        appliedRuleIds,
        confidence,
        status: "proposed",
        rationale:
          llmPatch.rationale ?? "LLM-generated patch (no rationale provided)",
        retries: elicited.retriesUsed,
        createdAt,
      });
    }

    for (const patch of patches) {
      await emitAuditEvent(this.auditRepo, {
        jobId: input.jobId,
        agentKind: "surgeon",
        eventType: "patch_proposed",
        payload: {
          patchId: patch.id,
          filePath: patch.filePath,
          confidence: patch.confidence,
          retries: patch.retries,
          status: patch.status,
        },
        entityId: patch.id,
        entityType: "patch",
      });
    }

    await emitAuditEvent(this.auditRepo, {
      jobId: input.jobId,
      agentKind: "surgeon",
      eventType: "patch_batch_completed",
      payload: {
        batchId: input.batch.id,
        patchCount: patches.length,
        unresolvedCount: 0,
        llmAttempts: elicited.retriesUsed + 1,
        llmLatencyMs: elicited.latencyMs,
        llmProvider: elicited.provider,
      },
    });

    return {
      patches,
      unresolvedFileIds: [],
      llmAttempts: elicited.retriesUsed + 1,
      llmLatencyMs: elicited.latencyMs,
      llmProvider: elicited.provider,
    };
  }

  async persistPatches(patches: Patch[]): Promise<void> {
    if (patches.length === 0) return;

    await this.patchRepo.bulkInsert(
      patches.map((p) => ({
        id: p.id,
        jobId: p.jobId,
        snapshotId: p.snapshotId,
        fileId: p.fileId,
        filePath: p.filePath,
        before: p.before,
        after: p.after,
        appliedRuleIds: p.appliedRuleIds,
        confidence: p.confidence,
        status: p.status,
        rationale: p.rationale ?? null,
        retries: p.retries,
        llmTranscriptId: p.llmTranscriptId ?? null,
        createdAt: p.createdAt,
      })),
    );

    // Use the first patch's jobId — bulkInsert always operates within a
    // single job (the Surgeon never mixes patches across jobs into one call).
    const firstJobId = patches[0]?.jobId;
    if (firstJobId !== undefined) {
      await emitAuditEvent(this.auditRepo, {
        jobId: firstJobId,
        agentKind: "surgeon",
        eventType: "patches_persisted",
        payload: { count: patches.length },
      });
    }
  }

  /**
   * Drive the LLM-call → JSON.parse → Zod-validate → ts-morph-validate loop.
   *
   * Each failure round-trips through the SAME conversation: we push the
   * prior assistant turn plus a new user turn that carries the explicit
   * error context so the model has the best shot at correcting itself.
   *
   * On total retry exhaustion we return `{ gaveUp: true, ... }` rather than
   * throwing. The caller (`migrateBatch`) materializes a stub `unresolved`
   * Patch per batch file so the auditor sees the failure instead of an
   * unraised exception killing the orchestrator. (Internal hard failures
   * — a missing LLM provider, a router crash — continue to bubble.)
   */
  private async elicitPatchesWithRetry(
    system: string,
    initialUserMessage: string,
    metadata: { jobId: string; batchId: string; agentKind: AgentKind },
    beforeByPath: ReadonlyMap<string, string>,
  ): Promise<
    | {
        gaveUp: false;
        response: LlmPatchResponse;
        retriesUsed: number;
        latencyMs: number;
        provider: string;
      }
    | {
        gaveUp: true;
        attempts: number;
        failureReason: string;
        lastRawOutput: string;
        latencyMs: number;
        provider: string;
      }
  > {
    const messages: ReasoningMessage[] = [
      { role: "user", content: initialUserMessage },
    ];
    let lastRaw = "";
    let lastError: unknown = null;
    let lastLatencyMs = 0;
    let lastProvider = "unknown";

    for (let attempt = 0; attempt <= MAX_LLM_VALIDATION_RETRIES; attempt += 1) {
      const response = await this.llmRouter.reason({
        system,
        messages,
        responseFormat: "file-replacement",
        temperature: 0.1,
        maxTokens: 4096,
        metadata: {
          jobId: metadata.jobId,
          batchId: metadata.batchId,
          agentKind: metadata.agentKind,
          attempt,
        },
      });

      lastRaw = response.content;
      lastLatencyMs = response.latencyMs;
      lastProvider = response.provider;
      const stripped = stripCodeFence(response.content);

      // Stage 1: JSON.parse
      let parsed: unknown;
      try {
        parsed = JSON.parse(stripped);
      } catch (err) {
        lastError = err;
        if (attempt === MAX_LLM_VALIDATION_RETRIES) break;
        const errMessage = err instanceof Error ? err.message : String(err);
        messages.push({ role: "assistant", content: response.content });
        messages.push({
          role: "user",
          content: `Your previous response was not valid JSON: ${errMessage}. Return ONLY a JSON object with key 'patches' matching the schema. Do not include markdown fences, comments, or any prose.`,
        });
        continue;
      }

      // Stage 2: Zod-validate against { patches: LlmPatch[] }
      const validation = LlmPatchResponseSchema.safeParse(parsed);
      if (!validation.success) {
        lastError = validation.error;
        if (attempt === MAX_LLM_VALIDATION_RETRIES) break;
        const issues = validation.error.errors
          .map(
            (issue) => `- ${issue.path.join(".") || "(root)"}: ${issue.message}`,
          )
          .join("\n");
        messages.push({ role: "assistant", content: response.content });
        messages.push({
          role: "user",
          content: `Your previous response failed schema validation:\n${issues}\nReturn ONLY a JSON object with key 'patches' matching the schema. Each patch needs filePath (string) and after (string); rationale is optional.`,
        });
        continue;
      }

      // Stage 3: ts-morph syntactic validation per emitted patch.
      const parseFailures = validatePatchSyntax(validation.data, beforeByPath);
      if (parseFailures.length > 0) {
        lastError = new Error(
          parseFailures.map((f) => `${f.filePath}: ${f.message}`).join("; "),
        );
        if (attempt === MAX_LLM_VALIDATION_RETRIES) break;
        const issues = parseFailures
          .map((f) => `- ${f.filePath}: ${f.message}`)
          .join("\n");
        messages.push({ role: "assistant", content: response.content });
        messages.push({
          role: "user",
          content: `Your previous output produced unparseable code in the following files:\n${issues}\nRe-emit the patches as syntactically valid TypeScript / JavaScript. Each "after" field must be a complete file body that parses cleanly. Keep all other patches intact unless they depended on the broken file.`,
        });
        continue;
      }

      return {
        gaveUp: false,
        response: validation.data,
        retriesUsed: attempt,
        latencyMs: response.latencyMs,
        provider: response.provider,
      };
    }

    const reason =
      lastError instanceof Error ? lastError.message : String(lastError);
    return {
      gaveUp: true,
      attempts: MAX_LLM_VALIDATION_RETRIES + 1,
      failureReason: reason,
      lastRawOutput: lastRaw,
      latencyMs: lastLatencyMs,
      provider: lastProvider,
    };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers (file-local; not exported)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Read every file in the batch into memory in parallel. Failure to read any
 * single file aborts the batch — silently skipping would hide the LLM's
 * context from itself and produce subtly wrong patches.
 */
async function readBatchContents(
  batch: FileBatch,
): Promise<ReadonlyMap<string, string>> {
  const entries = await Promise.all(
    batch.files.map(async (f) => {
      try {
        const contents = await readFile(f.absPath, "utf8");
        return [f.filePath, contents] as const;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(
          `[SurgeonService] Failed to read ${f.absPath} (file ${f.filePath} in batch ${batch.id}): ${msg}`,
        );
      }
    }),
  );
  return new Map(entries);
}

/**
 * Compose the user-turn payload: rules first (so the model has the spec
 * before the targets), then every file's full contents fenced in the
 * language-appropriate code block.
 */
function buildUserMessage(
  batch: FileBatch,
  rules: readonly Rule[],
  beforeByPath: ReadonlyMap<string, string>,
): string {
  const sections: string[] = [];
  sections.push("## Rules to apply");
  if (rules.length === 0) {
    sections.push("(no rules — return { \"patches\": [] })");
  } else {
    for (const rule of rules) sections.push(renderRule(rule));
  }
  sections.push("");
  sections.push("## Files in batch");
  for (const f of batch.files) {
    const contents = beforeByPath.get(f.filePath) ?? "";
    const fenceLang = fenceLanguageFor(f.filePath);
    sections.push(`### ${f.filePath}`);
    sections.push("```" + fenceLang);
    sections.push(contents);
    sections.push("```");
    sections.push("");
  }
  return sections.join("\n");
}

/**
 * Render a single rule as a compact YAML-ish block. We use indented bullets
 * rather than real YAML to avoid any chance of the model misinterpreting the
 * structure as something it should echo back.
 */
function renderRule(rule: Rule): string {
  const lines: string[] = [];
  lines.push(`- id: ${rule.id}`);
  lines.push(`  kind: ${rule.kind}`);
  lines.push(`  severity: ${rule.severity}`);
  lines.push(`  title: ${rule.title}`);
  lines.push(`  rationale: ${rule.rationale}`);
  lines.push(`  detect:`);
  lines.push(`    kind: ${rule.detect.kind}`);
  lines.push(`    expr: ${JSON.stringify(rule.detect.expr)}`);
  if (rule.fix !== undefined) {
    lines.push(`  fix:`);
    lines.push(`    kind: ${rule.fix.kind}`);
    if (rule.fix.expr !== undefined) {
      lines.push(`    expr: ${JSON.stringify(rule.fix.expr)}`);
    }
    if (rule.fix.instructions !== undefined) {
      lines.push(`    instructions: ${JSON.stringify(rule.fix.instructions)}`);
    }
  }
  return lines.join("\n");
}

/**
 * Pick a markdown code-fence language hint from a filename. Falls back to
 * an empty fence ("```\n...\n```") for unknown extensions so we never emit
 * a bogus lang tag the model might echo back.
 */
function fenceLanguageFor(filePath: string): string {
  const ext = extensionOf(filePath);
  switch (ext) {
    case "ts":
    case "mts":
    case "cts":
      return "typescript";
    case "tsx":
      return "tsx";
    case "js":
    case "mjs":
    case "cjs":
      return "javascript";
    case "jsx":
      return "jsx";
    case "json":
      return "json";
    default:
      return "";
  }
}

/**
 * Strip a leading/trailing ```json … ``` (or ``` … ```) markdown fence if
 * the LLM ignored the JSON-only instruction. Idempotent on clean input.
 */
function stripCodeFence(text: string): string {
  let s = text.trim();
  const fenceOpen = s.match(/^```(?:json|JSON)?\s*\n?/);
  if (fenceOpen) s = s.slice(fenceOpen[0].length);
  const fenceClose = s.match(/\n?```\s*$/);
  if (fenceClose) s = s.slice(0, s.length - fenceClose[0].length);
  return s.trim();
}

/**
 * Lower-case extension (without dot) of a path, or "" if none.
 */
function extensionOf(filePath: string): string {
  const lastDot = filePath.lastIndexOf(".");
  if (lastDot === -1 || lastDot === filePath.length - 1) return "";
  return filePath.slice(lastDot + 1).toLowerCase();
}

/**
 * ts-morph ScriptKind for a path. Used to teach the parser whether to
 * accept JSX, TypeScript syntax, both, or neither.
 */
function scriptKindFor(filePath: string): ScriptKind | null {
  const ext = extensionOf(filePath);
  return SCRIPT_KIND_BY_EXT.get(ext) ?? null;
}

interface ParseFailure {
  filePath: string;
  message: string;
}

/**
 * Validate that every emitted patch's `after` is syntactically valid TS/JS.
 *
 * Strategy: spin up a single in-memory `Project`, add each emitted patch as
 * a fresh `SourceFile`, then collect SYNTACTIC diagnostics (TS error codes
 * in the 1000–1999 range — the parser's range). Type errors (2xxx+) are
 * deliberately ignored: the LLM cannot know about every type in the project
 * and the Examiner will surface real type-check failures in Wave 2 Task 8.
 *
 * Non-TS/JS files (`.json`, `.md`, anything else) skip parse validation —
 * we trust the LLM on those since they're rare in our domain.
 */
function validatePatchSyntax(
  response: LlmPatchResponse,
  beforeByPath: ReadonlyMap<string, string>,
): ParseFailure[] {
  // Fast-out if nothing to check.
  const parseablePatches = response.patches.filter((p) =>
    PARSEABLE_EXT_RE.test(p.filePath),
  );
  if (parseablePatches.length === 0) return [];

  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: {
      // rationale: ts-morph CompilerOptions uses numeric enums; values match TypeScript 5.x.
      allowJs: true,
      jsx: 4 /* React JSX */,
      target: 99 /* ESNext */,
      module: 99 /* ESNext */,
      isolatedModules: true,
      noEmit: true,
    },
  });

  const failures: ParseFailure[] = [];

  for (const patch of parseablePatches) {
    const sk = scriptKindFor(patch.filePath);
    if (sk === null) continue; // shouldn't happen — PARSEABLE_EXT_RE was true

    // Ignore patches that are no-ops against the original — they wouldn't be
    // surfaced as Patch rows anyway, but checking them is a waste of CPU
    // and clutters retry feedback with non-actionable noise.
    const before = beforeByPath.get(patch.filePath);
    if (before !== undefined && before === patch.after) continue;

    // ts-morph's in-memory FS scopes names per path. Use the actual filePath
    // to make the diagnostics easier to read.
    let sourceFile: SourceFile;
    try {
      sourceFile = project.createSourceFile(patch.filePath, patch.after, {
        overwrite: true,
        scriptKind: sk,
      });
    } catch (err) {
      // ts-morph throws only on internal failures; treat as a parse failure.
      const msg = err instanceof Error ? err.message : String(err);
      failures.push({ filePath: patch.filePath, message: msg });
      continue;
    }

    const diagnostics = sourceFile
      .getPreEmitDiagnostics()
      .filter(
        (d) =>
          d.getCategory() === DiagnosticCategory.Error &&
          isSyntacticCode(d.getCode()),
      );

    if (diagnostics.length > 0) {
      const first = diagnostics[0];
      if (first === undefined) continue;
      const messageText = first.getMessageText();
      const message =
        typeof messageText === "string"
          ? messageText
          : flattenDiagnosticMessage(messageText);
      const code = first.getCode();
      failures.push({
        filePath: patch.filePath,
        message: `TS${code}: ${message}`,
      });
    }
  }

  return failures;
}

/**
 * TypeScript reserves diagnostic codes 1000–1999 for syntactic / lexical
 * errors emitted by the parser. 2xxx+ are semantic (type checker) errors
 * which we intentionally don't gate on here.
 */
function isSyntacticCode(code: number): boolean {
  return code >= 1000 && code <= 1999;
}

/**
 * Flatten a nested DiagnosticMessageChain into a single string. We only ever
 * read the first error here, but the chain form is common enough that
 * type-narrowing manually is worth it.
 */
function flattenDiagnosticMessage(chain: unknown): string {
  if (chain === null || chain === undefined) return "";
  if (typeof chain === "string") return chain;
  if (typeof chain !== "object") return String(chain);
  // ts.DiagnosticMessageChain shape — messageText is a string at the root.
  const obj = chain as { messageText?: unknown; next?: unknown };
  if (typeof obj.messageText === "string") return obj.messageText;
  return JSON.stringify(chain);
}

/**
 * Map "validation retries the LLM consumed" → confidence score.
 *
 * Index 0 → 0.85 (clean on attempt 0)
 * Index 1 → 0.70 (1 retry)
 * Index 2 → 0.50 (2 retries)
 * Anything else → fall back to the lowest emitted score; we never throw,
 * since this is a scoring helper, not a contract enforcer.
 */
function confidenceForRetries(retries: number): number {
  if (retries < 0) return CONFIDENCE_BY_RETRIES[0] ?? 0.85;
  if (retries >= CONFIDENCE_BY_RETRIES.length) {
    return (
      CONFIDENCE_BY_RETRIES[CONFIDENCE_BY_RETRIES.length - 1] ??
      UNRESOLVED_CONFIDENCE
    );
  }
  return CONFIDENCE_BY_RETRIES[retries] ?? UNRESOLVED_CONFIDENCE;
}

// Re-export the public error surface for ergonomic consumption alongside
// the service class.
export {
  SurgeonNotApplicableError,
  SurgeonValidationError,
} from "./errors.js";

// Made with Bob
