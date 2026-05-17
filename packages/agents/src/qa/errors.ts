/**
 * Domain errors raised by the Codebase Q&A agent. Errors are named subclasses
 * so callers (Inngest workflow steps, tool harnesses, tests) can
 * `instanceof`-check rather than parse message strings.
 */

/**
 * Raised when the LLM's JSON response fails Zod validation across the full
 * retry budget (initial call + `MAX_QA_VALIDATION_RETRIES` retries). Carries
 * the raw last-attempt content so callers can surface it for debugging.
 */
export class QaLlmValidationError extends Error {
  override readonly name = "QaLlmValidationError";

  constructor(
    message: string,
    public readonly attempts: number,
    public readonly lastRawOutput: string,
  ) {
    super(message);
  }
}
