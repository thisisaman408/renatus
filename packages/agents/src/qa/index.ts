import { readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import type {
  AuditEventRepository,
  FileRepository,
  FileRow,
  KnowledgeGraphRepository,
  NewQaTranscript,
  QaTranscriptRepository,
  SigningKeyRepository,
} from "@renatus/db";
import type { LlmRouter } from "@renatus/llm";
import { canonicalJson } from "@renatus/shared";
import type { ReasoningMessage } from "@renatus/shared";
import { emitAuditEvent } from "../audit-events/emit.js";
import { signWithJobKeypair } from "../auditor/sign.js";
import type { Signature } from "../auditor/types.js";
import { QaLlmValidationError } from "./errors.js";
import { QA_SYSTEM_PROMPT } from "./prompts.js";

/** Total LLM rounds = 1 initial + this many retries. */
const MAX_QA_VALIDATION_RETRIES = 2;

/** Default count of files we retrieve and offer to the LLM as context. */
const DEFAULT_MAX_CITATIONS = 5;

/** Max bytes we read into memory per candidate file when scoring contents. */
const MAX_CONTENT_SCORE_BYTES = 1024 * 1024;

/**
 * Stopwords for question tokenization. These dominate retrieval if not pruned
 * — every English question has "what" / "where" / "how" — so we drop them
 * before scoring. The list is intentionally short: enough to neuter generic
 * question words without scrubbing domain vocabulary the user is asking about.
 */
const STOPWORDS = new Set<string>([
  "what",
  "where",
  "does",
  "how",
  "why",
  "this",
  "that",
  "with",
  "have",
  "from",
  "they",
  "them",
  "their",
  "about",
  "code",
  "file",
  "function",
  "class",
  "when",
  "which",
  "would",
  "should",
  "could",
  "into",
  "than",
  "then",
  "there",
  "these",
  "those",
  "been",
  "being",
  "were",
  "will",
  "your",
  "yours",
  "ours",
]);

/**
 * Zod schema for the LLM's structured answer. The model is told (via the
 * system prompt) to emit exactly this shape — no markdown fences, no prose.
 */
const QaLlmResponseSchema = z.object({
  answer: z.string().min(1),
  citations: z.array(
    z.object({
      filePath: z.string(),
      line: z.number().int().positive().optional(),
      snippet: z.string().optional(),
    }),
  ),
});

type QaLlmResponse = z.infer<typeof QaLlmResponseSchema>;

export interface QaInput {
  jobId: string;
  snapshotId: string;
  /** Absolute path to the cloned working tree. */
  localPath: string;
  question: string;
  /** Cap on retrieved file context. Defaults to 5. */
  maxCitations?: number;
}

export interface QaCitation {
  /** Repo-relative path. */
  filePath: string;
  /** 1-based line number if the LLM provided one. */
  line?: number;
  /** File content sha at retrieval time. */
  sha: string;
  /** Optional verbatim snippet (≤3 lines) lifted from the file. */
  snippet?: string;
}

export interface QaResult {
  transcriptId: string;
  question: string;
  answer: string;
  citations: QaCitation[];
  signature: Signature;
  llmProvider: string;
  llmLatencyMs: number;
}

/**
 * Internal record for a candidate file we've offered to the LLM as context.
 * Indexed by `filePath` so we can enrich the LLM's citations by looking up
 * `sha` without trusting the LLM to repeat it.
 */
interface CandidateFile {
  filePath: string;
  sha: string;
  contents: string;
}

/**
 * QaService — Wave-4 Codebase Q&A agent.
 *
 * Pipeline (read-only — no Surgeon, no Auditor):
 *   1. Retrieve candidate files by scoring file path / basename / content
 *      against the question's keyword tokens.
 *   2. Read each candidate's contents from disk.
 *   3. Call the LLM with the question + each file as a fenced context block.
 *      JSON response, validated with `QaLlmResponseSchema`, retry-with-feedback
 *      up to {@link MAX_QA_VALIDATION_RETRIES} on parse / Zod failures.
 *   4. Enrich each LLM-emitted citation with the file's sha from our
 *      candidate set. Citations pointing to files the LLM hallucinated (not
 *      in our retrieval set) are silently dropped.
 *   5. Sign the transcript with ed25519 over canonicalJson of
 *      `{ jobId, question, answer, citations }`. Same signing primitives the
 *      Auditor uses, shared via `auditor/sign.ts`.
 *   6. Persist the transcript and return.
 *
 * Audit events: `qa_started` at the top, `qa_completed` at the bottom, plus
 * `qa_failed` if the LLM exhausts the retry budget.
 */
export class QaService {
  constructor(
    private readonly llmRouter: LlmRouter,
    private readonly fileRepo: FileRepository,
    // KG repo is reserved for the Wave-4-follow-on hybrid retriever (path-score
    // ∪ recursive-CTE ∪ pgvector). It's accepted by the constructor today so
    // callers in the Inngest workflow can wire it without a follow-up refactor.
    kgRepo: KnowledgeGraphRepository,
    private readonly transcriptRepo: QaTranscriptRepository,
    private readonly signingKeyRepo: SigningKeyRepository,
    private readonly auditRepo: AuditEventRepository | null = null,
  ) {
    // Anchor a reference so the param isn't reported as unused. The hybrid
    // retriever lands in a follow-on patch — until then this is a deliberate
    // shape-preserving anchor, not dead code.
    void kgRepo;
  }

  async ask(input: QaInput): Promise<QaResult> {
    const maxCitations = input.maxCitations ?? DEFAULT_MAX_CITATIONS;

    await emitAuditEvent(this.auditRepo, {
      jobId: input.jobId,
      agentKind: "qa",
      eventType: "qa_started",
      payload: {
        snapshotId: input.snapshotId,
        questionLength: input.question.length,
        maxCitations,
      },
    });

    const candidates = await this.findRelevantFiles(
      input.snapshotId,
      input.localPath,
      input.question,
      maxCitations,
    );

    const userMessage = buildUserMessage(input.question, candidates);

    const elicited = await this.elicitAnswerWithRetry({
      jobId: input.jobId,
      agentKind: "qa",
      userMessage,
    });

    if (elicited.gaveUp) {
      await emitAuditEvent(this.auditRepo, {
        jobId: input.jobId,
        agentKind: "qa",
        eventType: "qa_failed",
        payload: {
          attempts: elicited.attempts,
          failureReason: elicited.failureReason,
          llmProvider: elicited.provider,
          llmLatencyMs: elicited.latencyMs,
        },
      });
      throw new QaLlmValidationError(
        `Q&A LLM failed validation after ${elicited.attempts} attempts: ${elicited.failureReason}`,
        elicited.attempts,
        elicited.lastRawOutput,
      );
    }

    const candidatesByPath = new Map<string, CandidateFile>();
    for (const c of candidates) {
      candidatesByPath.set(c.filePath, c);
    }

    // Drop citations to files the LLM didn't actually see (hallucinated paths).
    const enrichedCitations: QaCitation[] = [];
    for (const cite of elicited.parsed.citations) {
      const candidate = candidatesByPath.get(cite.filePath);
      if (!candidate) {
        continue;
      }
      const enriched: QaCitation = {
        filePath: cite.filePath,
        sha: candidate.sha,
      };
      if (cite.line !== undefined) enriched.line = cite.line;
      if (cite.snippet !== undefined) enriched.snippet = cite.snippet;
      enrichedCitations.push(enriched);
    }

    // Sign the transcript over canonicalJson(jobId, question, answer, citations).
    // Same ed25519 primitives the Auditor uses — shared via auditor/sign.ts.
    const canonical = canonicalJson({
      jobId: input.jobId,
      question: input.question,
      answer: elicited.parsed.answer,
      citations: enrichedCitations,
    });
    const signature = await signWithJobKeypair(
      canonical,
      input.jobId,
      this.signingKeyRepo,
      "Qa",
    );

    const newRow: NewQaTranscript = {
      jobId: input.jobId,
      snapshotId: input.snapshotId,
      question: input.question,
      answer: elicited.parsed.answer,
      citations: enrichedCitations,
      signature,
      llmProvider: elicited.provider,
      llmLatencyMs: elicited.latencyMs,
    };
    const transcript = await this.transcriptRepo.create(newRow);

    await emitAuditEvent(this.auditRepo, {
      jobId: input.jobId,
      agentKind: "qa",
      eventType: "qa_completed",
      payload: {
        transcriptId: transcript.id,
        citationCount: enrichedCitations.length,
        llmProvider: elicited.provider,
        llmLatencyMs: elicited.latencyMs,
      },
      entityId: transcript.id,
      entityType: "qa_transcript",
    });

    return {
      transcriptId: transcript.id,
      question: input.question,
      answer: elicited.parsed.answer,
      citations: enrichedCitations,
      signature,
      llmProvider: elicited.provider,
      llmLatencyMs: elicited.latencyMs,
    };
  }

  /**
   * Score files in the snapshot against the question's keyword tokens.
   *
   *   +5 per token match in `file.path`
   *   +2 per token match in basename
   *   +1 per token match in file contents (cap content scoring at 1MB / file)
   *
   * Ties broken by alphabetical `filePath`. Returns the top-N with full
   * contents read from disk. Files that fail to read from disk are skipped
   * silently — the question may be answerable from the remaining files.
   *
   * Wave-4 simplicity: pure substring / regex matching. pgvector semantic
   * retrieval is deferred (kept the constructor parameter so a future hybrid
   * retriever can land without breaking callers).
   */
  private async findRelevantFiles(
    snapshotId: string,
    localPath: string,
    question: string,
    max: number,
  ): Promise<CandidateFile[]> {
    const tokens = tokenize(question);
    if (tokens.length === 0) {
      return [];
    }

    const fileRows: FileRow[] = await this.fileRepo.getBySnapshot(snapshotId);
    if (fileRows.length === 0) {
      return [];
    }

    interface Scored {
      row: FileRow;
      score: number;
    }

    const scored: Scored[] = [];

    for (const row of fileRows) {
      const pathLower = row.path.toLowerCase();
      const basename = path.basename(row.path).toLowerCase();

      let score = 0;
      let pathMatchCount = 0;
      for (const token of tokens) {
        if (pathLower.includes(token)) {
          score += 5;
          pathMatchCount += 1;
        }
        if (basename.includes(token)) {
          score += 2;
        }
      }

      // Only read content for files that already have *some* path signal or
      // are small enough that content scoring is cheap. Without this guard,
      // a 500-file repo + 6-token question = 3000 file reads per question.
      let contentScore = 0;
      if (pathMatchCount > 0 || row.sizeBytes < 32 * 1024) {
        contentScore = await this.scoreFileContents(
          path.join(localPath, row.path),
          tokens,
        );
      }
      score += contentScore;

      if (score > 0) {
        scored.push({ row, score });
      }
    }

    scored.sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.row.path.localeCompare(b.row.path);
    });

    const top = scored.slice(0, max);

    const candidates: CandidateFile[] = [];
    for (const { row } of top) {
      const abs = path.join(localPath, row.path);
      try {
        const contents = await readFile(abs, "utf8");
        candidates.push({ filePath: row.path, sha: row.sha, contents });
      } catch {
        // Skip silently — the file may have been removed since indexing.
      }
    }

    return candidates;
  }

  /**
   * Read a file from disk (capped at {@link MAX_CONTENT_SCORE_BYTES}) and
   * count token occurrences. Returns 0 on read failure — the path-score
   * signal is sufficient on its own when content scoring is unavailable.
   */
  private async scoreFileContents(
    absPath: string,
    tokens: ReadonlyArray<string>,
  ): Promise<number> {
    let raw: string;
    try {
      raw = await readFile(absPath, "utf8");
    } catch {
      return 0;
    }

    const truncated =
      raw.length > MAX_CONTENT_SCORE_BYTES
        ? raw.slice(0, MAX_CONTENT_SCORE_BYTES)
        : raw;
    const lower = truncated.toLowerCase();

    let total = 0;
    for (const token of tokens) {
      if (lower.includes(token)) {
        total += 1;
      }
    }
    return total;
  }

  /**
   * Drive the LLM-call → JSON-parse → Zod-validate → retry-with-feedback loop.
   * Same conversation pattern as Surgeon + Cartographer Path B: the
   * assistant's previous turn plus an explicit error-feedback user turn are
   * appended on every failure so the model can self-correct.
   */
  private async elicitAnswerWithRetry(args: {
    jobId: string;
    agentKind: "qa";
    userMessage: string;
  }): Promise<
    | {
        gaveUp: false;
        parsed: QaLlmResponse;
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
      { role: "user", content: args.userMessage },
    ];
    let lastRaw = "";
    let lastError: unknown = null;
    let cumulativeLatencyMs = 0;
    let lastProvider = "unknown";

    for (let attempt = 0; attempt <= MAX_QA_VALIDATION_RETRIES; attempt += 1) {
      const response = await this.llmRouter.reason({
        system: QA_SYSTEM_PROMPT,
        messages,
        responseFormat: "json",
        temperature: 0.1,
        maxTokens: 2048,
        metadata: {
          jobId: args.jobId,
          agentKind: args.agentKind,
          attempt,
        },
      });

      lastRaw = response.content;
      cumulativeLatencyMs += response.latencyMs;
      lastProvider = response.provider;

      const stripped = stripJsonFence(response.content);
      if (stripped.length === 0) {
        lastError = new Error("LLM returned empty response after fence-strip");
        if (attempt === MAX_QA_VALIDATION_RETRIES) break;
        messages.push({ role: "assistant", content: response.content });
        messages.push({
          role: "user",
          content:
            "Your previous response was empty after stripping markdown fences. Emit the JSON object directly, starting with '{'. No prose, no fences.",
        });
        continue;
      }

      let raw: unknown;
      try {
        raw = JSON.parse(stripped);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        lastError = new Error(`JSON.parse failed: ${msg}`);
        if (attempt === MAX_QA_VALIDATION_RETRIES) break;
        messages.push({ role: "assistant", content: response.content });
        messages.push({
          role: "user",
          content: `Your previous output is not valid JSON: ${msg}. Re-emit the COMPLETE JSON object with the exact shape from the system prompt. No markdown fences.`,
        });
        continue;
      }

      const validation = QaLlmResponseSchema.safeParse(raw);
      if (!validation.success) {
        const issues = validation.error.issues
          .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
          .join("; ");
        lastError = new Error(`Zod validation failed: ${issues}`);
        if (attempt === MAX_QA_VALIDATION_RETRIES) break;
        messages.push({ role: "assistant", content: response.content });
        messages.push({
          role: "user",
          content: `Your previous JSON failed validation:\n- ${issues}\nRe-emit the COMPLETE JSON object with the exact shape from the system prompt. No markdown fences.`,
        });
        continue;
      }

      return {
        gaveUp: false,
        parsed: validation.data,
        attempts: attempt + 1,
        latencyMs: cumulativeLatencyMs,
        provider: lastProvider,
      };
    }

    const reason =
      lastError instanceof Error ? lastError.message : String(lastError);
    return {
      gaveUp: true,
      attempts: MAX_QA_VALIDATION_RETRIES + 1,
      failureReason: reason,
      lastRawOutput: lastRaw,
      latencyMs: cumulativeLatencyMs,
      provider: lastProvider,
    };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// File-local helpers
// ────────────────────────────────────────────────────────────────────────────

/**
 * Tokenize a natural-language question into lowercase keyword tokens.
 *
 *   - Split on whitespace + punctuation (non-alphanumeric).
 *   - Filter to length ≥ 4.
 *   - Drop {@link STOPWORDS}.
 *
 * Deduplicated; insertion order preserved.
 */
function tokenize(question: string): string[] {
  const raw = question.toLowerCase().split(/[^a-z0-9]+/g);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const token of raw) {
    if (token.length < 4) continue;
    if (STOPWORDS.has(token)) continue;
    if (seen.has(token)) continue;
    seen.add(token);
    out.push(token);
  }
  return out;
}

/**
 * Compose the user-turn payload: the question, then each candidate file
 * inside a `## File: <path>` header + `// sha: <sha>` line + fenced contents.
 */
function buildUserMessage(
  question: string,
  candidates: ReadonlyArray<CandidateFile>,
): string {
  const sections: string[] = [];
  sections.push(`## Question`);
  sections.push(question);
  sections.push("");

  if (candidates.length === 0) {
    sections.push("## Context");
    sections.push(
      "(no relevant files were retrieved — answer with a confidence-bounded response per the system prompt rules)",
    );
    return sections.join("\n");
  }

  sections.push("## Context");
  sections.push(
    `Below are ${candidates.length} candidate file${candidates.length === 1 ? "" : "s"} retrieved from the snapshot. Cite by repo-relative filePath.`,
  );
  sections.push("");

  for (const c of candidates) {
    const lang = fenceLanguageFor(c.filePath);
    sections.push(`## File: ${c.filePath}`);
    sections.push(`// sha: ${c.sha}`);
    sections.push("```" + lang);
    sections.push(c.contents);
    sections.push("```");
    sections.push("");
  }

  return sections.join("\n");
}

function fenceLanguageFor(filePath: string): string {
  const lastDot = filePath.lastIndexOf(".");
  if (lastDot === -1 || lastDot === filePath.length - 1) return "";
  const ext = filePath.slice(lastDot + 1).toLowerCase();
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
    case "md":
      return "markdown";
    case "css":
      return "css";
    case "html":
      return "html";
    case "py":
      return "python";
    case "rs":
      return "rust";
    case "go":
      return "go";
    default:
      return "";
  }
}

/**
 * Strip a leading/trailing ```json / ``` markdown fence if the LLM ignored
 * the no-fence instruction. Idempotent on clean input.
 */
function stripJsonFence(text: string): string {
  let s = text.trim();
  const fenceOpen = s.match(/^```(?:json)?\s*\n?/i);
  if (fenceOpen) s = s.slice(fenceOpen[0].length);
  const fenceClose = s.match(/\n?```\s*$/);
  if (fenceClose) s = s.slice(0, s.length - fenceClose[0].length);
  return s.trim();
}

// Re-export the public error surface for ergonomic consumption alongside
// the service class.
export { QaLlmValidationError } from "./errors.js";
