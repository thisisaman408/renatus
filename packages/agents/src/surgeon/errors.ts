/**
 * Thrown when the Surgeon is invoked for an agent kind it doesn't serve
 * (currently: `qa`, which runs through its own pipeline).
 */
export class SurgeonNotApplicableError extends Error {
  override readonly name = "SurgeonNotApplicableError" as const;
  constructor(message: string) {
    super(message);
  }
}

/**
 * Thrown when the LLM output cannot be coerced into `{ patches: ... }` —
 * either it fails `JSON.parse`, fails Zod validation, or every emitted
 * patch's `after` is syntactically invalid TypeScript / JavaScript — after
 * the configured retry budget is exhausted. Carries the last raw output so
 * the caller (or the audit log) can inspect what went wrong.
 */
export class SurgeonValidationError extends Error {
  override readonly name = "SurgeonValidationError" as const;
  readonly attempts: number;
  readonly lastRawOutput: string;

  constructor(message: string, attempts: number, lastRawOutput: string) {
    super(message);
    this.attempts = attempts;
    this.lastRawOutput = lastRawOutput;
  }
}

// Made with Bob
