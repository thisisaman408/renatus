import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import {
  DiagnosticCategory,
  Project,
  ScriptKind,
  type SourceFile,
} from "ts-morph";
import type {
  AgentKind,
  Patch,
  ReasoningMessage,
} from "@renatus/shared";
import type { LlmRouter } from "@renatus/llm";
import type {
  AuditEventRepository,
  NewGeneratedTest,
  TestRepository,
} from "@renatus/db";
import { emitAuditEvent } from "../audit-events/emit.js";
import {
  examinerSystemPromptFor,
  type TestFramework,
  type TestStrategy,
} from "./prompts.js";
import { ExaminerNotApplicableError } from "./errors.js";

/** Total LLM rounds per patch = 1 initial + this many retries. */
const MAX_LLM_VALIDATION_RETRIES = 2;

/**
 * ts-morph's script-kind discriminator per extension. Identical to the
 * Surgeon's mapping — single source of truth would be nice, but keeping it
 * inline here avoids a cross-agent dependency on validation internals.
 */
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

const PARSEABLE_EXT_RE = /\.(ts|tsx|js|jsx|mts|cts|mjs|cjs)$/i;

/**
 * Statuses we'll generate tests for. We only test patches the orchestrator
 * has accepted forward — proposed (pre-apply) or applied (post-apply). A
 * rejected or unresolved Patch has no behaviour to regression-guard.
 */
const TESTABLE_PATCH_STATUSES: ReadonlySet<string> = new Set([
  "proposed",
  "applied",
]);

// Re-export the framework / strategy types so consumers don't have to know
// they live in prompts.ts. The MCP tool boundary uses these directly.
export type { TestFramework, TestStrategy };

/**
 * A regression test that the Examiner has generated. NOT yet persisted —
 * callers opt in via {@link ExaminerService.persistTests}. Pure data; safe
 * to log, serialize, hand to Bob for preview, etc.
 */
export interface GeneratedTest {
  id: string;
  jobId: string;
  /** null only allowed for orphan CVE-replay tests; Wave-3 flows always set it. */
  patchId: string | null;
  fileId: string;
  snapshotId: string;
  framework: TestFramework;
  strategy: TestStrategy;
  /** Test file path RELATIVE to the snapshot root, e.g. `src/foo.test.ts`. */
  filePath: string;
  testContents: string;
  passes: boolean | null;
  durationMs: number | null;
  createdAt: Date;
}

export interface ExamineBatchInput {
  jobId: string;
  snapshotId: string;
  /** Absolute path to the snapshot working tree (used for framework detection). */
  localPath: string;
  /** Patches from PatchRepository.getByJob — only `proposed` or `applied` status. */
  patches: Patch[];
  /** `'qa'` is rejected — it uses the QA pipeline, not the Examiner. */
  agentKind: AgentKind;
}

export interface ExamineBatchResult {
  /** Never persisted by examineBatch itself — caller decides. */
  tests: GeneratedTest[];
  /** Detected once for the whole batch from the snapshot's package.json. */
  framework: TestFramework;
  /** Patches that failed test generation after the retry budget was exhausted. */
  errors: Array<{ patchId: string; reason: string }>;
  /** Sum of LLM calls across all patches (1 + retries actually consumed each). */
  llmAttempts: number;
  /** Sum of LLM latency across all patches in milliseconds. */
  llmLatencyMs: number;
  /** Last-seen provider tag. Mixed-provider runs are rare but possible. */
  llmProvider: string;
}

/**
 * ExaminerService — Wave 3 Task 14 (SYSTEM-DESIGN.md §5.3).
 *
 * Generates regression tests for each patched file using the LLM. Pipeline:
 *
 *   detect framework from package.json
 *   → pick strategy from agentKind
 *   → for each patch:
 *       LLM call (system prompt scoped to framework + strategy)
 *       → strip code fence
 *       → ts-morph syntactic validation (TS error codes 1000–1999)
 *       → retry-with-feedback up to 2 times
 *       → on success: build GeneratedTest, emit 'test_generated' event
 *       → on exhaustion: log to errors[], skip patch
 *
 * Stateless aside from the injected collaborators. `examineBatch` is pure
 * with respect to its inputs (no mutation, no DB writes); persistence is
 * opt-in via `persistTests`, so dry-runs and tool harnesses can exercise the
 * full pipeline without touching Postgres.
 */
export class ExaminerService {
  constructor(
    private readonly llmRouter: LlmRouter,
    private readonly testRepo: TestRepository,
    private readonly auditRepo: AuditEventRepository | null = null,
  ) {}

  async examineBatch(input: ExamineBatchInput): Promise<ExamineBatchResult> {
    if (input.agentKind === "qa") {
      throw new ExaminerNotApplicableError(
        "qa agent uses the QA pipeline, not the Examiner",
      );
    }

    const framework = await this.detectFramework(input.localPath);
    const strategy = strategyForAgent(input.agentKind);

    await emitAuditEvent(this.auditRepo, {
      jobId: input.jobId,
      agentKind: "examiner",
      eventType: "examine_started",
      payload: {
        snapshotId: input.snapshotId,
        patchCount: input.patches.length,
        framework,
        strategy,
        agentKind: input.agentKind,
      },
    });

    const tests: GeneratedTest[] = [];
    const errors: Array<{ patchId: string; reason: string }> = [];
    let totalAttempts = 0;
    let totalLatencyMs = 0;
    let lastProvider = "unknown";

    // Sequential per-patch — keeps token usage low, lets us skip-on-failure
    // cleanly without poisoning a parallel-with-shared-state pipeline, and
    // matches the Surgeon's batching cadence.
    for (const patch of input.patches) {
      if (!TESTABLE_PATCH_STATUSES.has(patch.status)) {
        // Skip silently — caller can pre-filter, but we double-check.
        continue;
      }

      const system = examinerSystemPromptFor({
        framework,
        strategy,
        agentKind: input.agentKind,
      });
      const userMessage = buildUserMessage(patch, strategy);

      const elicited = await this.elicitTestWithRetry(
        system,
        userMessage,
        {
          jobId: input.jobId,
          patchId: patch.id,
          filePath: patch.filePath,
          agentKind: input.agentKind,
        },
        patch.filePath,
      );

      totalAttempts += elicited.attempts;
      totalLatencyMs += elicited.latencyMs;
      lastProvider = elicited.provider;

      if (elicited.gaveUp) {
        errors.push({ patchId: patch.id, reason: elicited.failureReason });
        await emitAuditEvent(this.auditRepo, {
          jobId: input.jobId,
          agentKind: "examiner",
          eventType: "test_generation_failed",
          payload: {
            patchId: patch.id,
            filePath: patch.filePath,
            attempts: elicited.attempts,
            lastError: elicited.failureReason,
          },
          entityId: patch.id,
          entityType: "patch",
        });
        continue;
      }

      const testFilePath = testPathFor(patch.filePath);
      const test: GeneratedTest = {
        id: randomUUID(),
        jobId: input.jobId,
        patchId: patch.id,
        fileId: patch.fileId,
        snapshotId: input.snapshotId,
        framework,
        strategy,
        filePath: testFilePath,
        testContents: elicited.testSource,
        passes: null,
        durationMs: null,
        createdAt: new Date(),
      };
      tests.push(test);

      await emitAuditEvent(this.auditRepo, {
        jobId: input.jobId,
        agentKind: "examiner",
        eventType: "test_generated",
        payload: {
          testId: test.id,
          patchId: test.patchId,
          framework: test.framework,
          strategy: test.strategy,
          filePath: test.filePath,
        },
        entityId: test.id,
        entityType: "test",
      });
    }

    await emitAuditEvent(this.auditRepo, {
      jobId: input.jobId,
      agentKind: "examiner",
      eventType: "examine_batch_completed",
      payload: {
        snapshotId: input.snapshotId,
        framework,
        strategy,
        testCount: tests.length,
        errorCount: errors.length,
        llmAttempts: totalAttempts,
        llmLatencyMs: totalLatencyMs,
        llmProvider: lastProvider,
      },
    });

    return {
      tests,
      framework,
      errors,
      llmAttempts: totalAttempts,
      llmLatencyMs: totalLatencyMs,
      llmProvider: lastProvider,
    };
  }

  async persistTests(tests: GeneratedTest[]): Promise<void> {
    if (tests.length === 0) return;

    const rows: NewGeneratedTest[] = tests.map((t) => ({
      id: t.id,
      jobId: t.jobId,
      patchId: t.patchId ?? null,
      fileId: t.fileId,
      snapshotId: t.snapshotId,
      framework: t.framework,
      strategy: t.strategy,
      filePath: t.filePath,
      testContents: t.testContents,
      passes: t.passes ?? null,
      durationMs: t.durationMs ?? null,
      createdAt: t.createdAt,
    }));

    await this.testRepo.bulkInsert(rows);

    const firstJobId = tests[0]?.jobId;
    if (firstJobId !== undefined) {
      await emitAuditEvent(this.auditRepo, {
        jobId: firstJobId,
        agentKind: "examiner",
        eventType: "tests_persisted",
        payload: { count: tests.length },
      });
    }
  }

  /**
   * Read the snapshot's `package.json` and pick the test framework by
   * scanning `devDependencies` + `dependencies`. Returns `'vitest'` when
   * package.json is present but names none of the known runners (most-popular
   * default for modern TS projects + matches our React fixture); returns
   * `'unknown'` only when package.json is unreadable / unparseable.
   */
  async detectFramework(localPath: string): Promise<TestFramework> {
    const pkgPath = path.join(localPath, "package.json");
    let raw: string;
    try {
      raw = await readFile(pkgPath, "utf8");
    } catch {
      return "unknown";
    }

    let pkg: unknown;
    try {
      pkg = JSON.parse(raw);
    } catch {
      return "unknown";
    }

    if (pkg === null || typeof pkg !== "object") return "unknown";

    const deps = mergeDeps(pkg as Record<string, unknown>);

    if (deps.has("vitest")) return "vitest";
    if (deps.has("jest") || deps.has("@jest/core")) return "jest";
    if (deps.has("mocha")) return "mocha";
    if (deps.has("@playwright/test") || deps.has("playwright"))
      return "playwright";

    // package.json present, no known runner. Default to Vitest — best fit
    // for modern TS + the React fixture; auditor sees the truth via the
    // package.json itself.
    return "vitest";
  }

  /**
   * Drive the LLM-call → ts-morph-validate → retry-with-feedback loop for a
   * single patch. Same conversation pattern as Surgeon + Cartographer Path B:
   * the assistant's previous turn plus an explicit error-feedback user turn
   * are appended on every failure so the model can self-correct.
   */
  private async elicitTestWithRetry(
    system: string,
    initialUserMessage: string,
    metadata: {
      jobId: string;
      patchId: string;
      filePath: string;
      agentKind: AgentKind;
    },
    sourceFilePath: string,
  ): Promise<
    | {
        gaveUp: false;
        testSource: string;
        attempts: number;
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
    let cumulativeLatencyMs = 0;
    let lastProvider = "unknown";

    for (let attempt = 0; attempt <= MAX_LLM_VALIDATION_RETRIES; attempt += 1) {
      const response = await this.llmRouter.reason({
        system,
        messages,
        responseFormat: "text",
        temperature: 0.1,
        maxTokens: 2048,
        metadata: {
          jobId: metadata.jobId,
          patchId: metadata.patchId,
          filePath: metadata.filePath,
          agentKind: metadata.agentKind,
          attempt,
        },
      });

      lastRaw = response.content;
      cumulativeLatencyMs += response.latencyMs;
      lastProvider = response.provider;

      const stripped = stripCodeFence(response.content);
      if (stripped.length === 0) {
        lastError = new Error("LLM returned empty response after fence-strip");
        if (attempt === MAX_LLM_VALIDATION_RETRIES) break;
        messages.push({ role: "assistant", content: response.content });
        messages.push({
          role: "user",
          content:
            "Your previous response was empty after stripping markdown fences. Emit the test source code directly, starting with the first import statement. No prose, no fences.",
        });
        continue;
      }

      const parseFailure = validateTestSyntax(stripped, sourceFilePath);
      if (parseFailure !== null) {
        lastError = new Error(parseFailure);
        if (attempt === MAX_LLM_VALIDATION_RETRIES) break;
        messages.push({ role: "assistant", content: response.content });
        messages.push({
          role: "user",
          content: `Your previous output is not parseable as TypeScript:\n- ${parseFailure}\nRe-emit the COMPLETE test file. It must parse cleanly with ts-morph. Include all imports. Do NOT wrap in markdown fences.`,
        });
        continue;
      }

      return {
        gaveUp: false,
        testSource: stripped,
        attempts: attempt + 1,
        latencyMs: cumulativeLatencyMs,
        provider: lastProvider,
      };
    }

    const reason =
      lastError instanceof Error ? lastError.message : String(lastError);
    return {
      gaveUp: true,
      attempts: MAX_LLM_VALIDATION_RETRIES + 1,
      failureReason: reason,
      lastRawOutput: lastRaw,
      latencyMs: cumulativeLatencyMs,
      provider: lastProvider,
    };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers (file-local; not exported)
// ────────────────────────────────────────────────────────────────────────────

/**
 * Per-agentKind strategy selection. Matches the task spec:
 *   migrate / refactor → snapshot
 *   security_audit    → cve-replay
 *   qa                → rejected earlier by examineBatch
 */
function strategyForAgent(agentKind: AgentKind): TestStrategy {
  switch (agentKind) {
    case "migrate":
    case "refactor":
      return "snapshot";
    case "security_audit":
      return "cve-replay";
    case "qa":
      // Defensive — examineBatch rejects 'qa' upstream; the case keeps
      // the switch exhaustive without dropping to a runtime default.
      throw new ExaminerNotApplicableError(
        "qa agent uses the QA pipeline, not the Examiner",
      );
    default: {
      const _exhaustive: never = agentKind;
      throw new Error(`Unsupported agent kind: ${String(_exhaustive)}`);
    }
  }
}

/**
 * Compose the per-patch user-turn payload.
 */
function buildUserMessage(patch: Patch, strategy: TestStrategy): string {
  const fenceLang = fenceLanguageFor(patch.filePath);
  const ruleIdsLine =
    patch.appliedRuleIds.length === 0
      ? "(none)"
      : patch.appliedRuleIds.join(", ");
  const sections: string[] = [];
  sections.push("## Patch context");
  sections.push(`File path: ${patch.filePath}`);
  sections.push(`Confidence: ${patch.confidence}`);
  sections.push(`Applied rules: ${ruleIdsLine}`);
  sections.push(`Strategy: ${strategy}`);
  sections.push("");
  sections.push("## Before");
  sections.push("```" + fenceLang);
  sections.push(patch.before);
  sections.push("```");
  sections.push("");
  sections.push("## After");
  sections.push("```" + fenceLang);
  sections.push(patch.after);
  sections.push("```");
  return sections.join("\n");
}

/**
 * Read package.json's dep maps into a single Set of names so callers can do
 * O(1) lookups regardless of which map a dep was declared in.
 */
function mergeDeps(pkg: Record<string, unknown>): Set<string> {
  const out = new Set<string>();
  for (const key of ["dependencies", "devDependencies"] as const) {
    const value = pkg[key];
    if (value === null || typeof value !== "object") continue;
    for (const name of Object.keys(value as Record<string, unknown>)) {
      out.add(name);
    }
  }
  return out;
}

/**
 * Derive a test path from a source path: replace `.tsx` → `.test.tsx`,
 * `.ts` → `.test.ts`, etc. Files without a known extension get `.test.ts`
 * appended (rare in this codebase; falls back gracefully).
 *
 * Test file lives next to the source — Vitest / Jest default convention.
 */
function testPathFor(sourcePath: string): string {
  const lastDot = sourcePath.lastIndexOf(".");
  if (lastDot === -1) return `${sourcePath}.test.ts`;
  const base = sourcePath.slice(0, lastDot);
  const ext = sourcePath.slice(lastDot + 1).toLowerCase();
  if (PARSEABLE_EXT_RE.test(`.${ext}`)) {
    return `${base}.test.${ext}`;
  }
  // Unknown extension — append .test.ts as a defensive default.
  return `${sourcePath}.test.ts`;
}

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

function extensionOf(filePath: string): string {
  const lastDot = filePath.lastIndexOf(".");
  if (lastDot === -1 || lastDot === filePath.length - 1) return "";
  return filePath.slice(lastDot + 1).toLowerCase();
}

function scriptKindFor(filePath: string): ScriptKind | null {
  const ext = extensionOf(filePath);
  return SCRIPT_KIND_BY_EXT.get(ext) ?? null;
}

/**
 * Strip a leading/trailing ```ts / ```tsx / ```js / ``` markdown fence if
 * the LLM ignored the no-fence instruction. Idempotent on clean input.
 */
function stripCodeFence(text: string): string {
  let s = text.trim();
  const fenceOpen = s.match(/^```(?:tsx|ts|typescript|jsx|js|javascript)?\s*\n?/i);
  if (fenceOpen) s = s.slice(fenceOpen[0].length);
  const fenceClose = s.match(/\n?```\s*$/);
  if (fenceClose) s = s.slice(0, s.length - fenceClose[0].length);
  return s.trim();
}

/**
 * Validate that the LLM-emitted test source is syntactically valid TS/JS.
 * Returns null on success, an error-string description on failure (TS code +
 * message of the first syntactic diagnostic).
 *
 * Strategy mirrors the Surgeon: in-memory Project + TS error codes 1000–1999
 * (parser range; semantic 2xxx+ are ignored — the model can't know about
 * every project type).
 *
 * The test file's script kind is derived from the SOURCE file's extension
 * (test of a .tsx is a .tsx); that's what determines whether JSX syntax is
 * allowed in the test body.
 */
function validateTestSyntax(
  testSource: string,
  sourceFilePath: string,
): string | null {
  const sk = scriptKindFor(sourceFilePath) ?? ScriptKind.TS;
  const testFilePath = testPathFor(sourceFilePath);

  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: {
      // rationale: numeric enums match TypeScript 5.x ts.ts ts.JsxEmit / ScriptTarget / ModuleKind values.
      allowJs: true,
      jsx: 4 /* React JSX */,
      target: 99 /* ESNext */,
      module: 99 /* ESNext */,
      isolatedModules: true,
      noEmit: true,
    },
  });

  let sourceFile: SourceFile;
  try {
    sourceFile = project.createSourceFile(testFilePath, testSource, {
      overwrite: true,
      scriptKind: sk,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return `ts-morph rejected the test source: ${msg}`;
  }

  const diagnostics = sourceFile
    .getPreEmitDiagnostics()
    .filter(
      (d) =>
        d.getCategory() === DiagnosticCategory.Error &&
        isSyntacticCode(d.getCode()),
    );

  if (diagnostics.length === 0) return null;

  const first = diagnostics[0];
  if (first === undefined) return null;
  const messageText = first.getMessageText();
  const message =
    typeof messageText === "string"
      ? messageText
      : flattenDiagnosticMessage(messageText);
  return `TS${first.getCode()}: ${message}`;
}

function isSyntacticCode(code: number): boolean {
  return code >= 1000 && code <= 1999;
}

function flattenDiagnosticMessage(chain: unknown): string {
  if (chain === null || chain === undefined) return "";
  if (typeof chain === "string") return chain;
  if (typeof chain !== "object") return String(chain);
  const obj = chain as { messageText?: unknown; next?: unknown };
  if (typeof obj.messageText === "string") return obj.messageText;
  return JSON.stringify(chain);
}

// Re-export the public error surface for ergonomic consumption alongside
// the service class.
export {
  ExaminerNotApplicableError,
  ExaminerValidationError,
} from "./errors.js";

// Made with Bob
