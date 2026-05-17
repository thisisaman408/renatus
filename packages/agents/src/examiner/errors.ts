/**
 * Thrown when the Examiner is invoked for an agent kind it doesn't serve
 * (currently: `qa`, which runs through its own pipeline).
 */
export class ExaminerNotApplicableError extends Error {
  override readonly name = "ExaminerNotApplicableError" as const;
  constructor(message: string) {
    super(message);
  }
}

/**
 * Thrown when the LLM output cannot be coerced into a syntactically valid
 * TypeScript test file — after the configured retry budget is exhausted.
 * Carries the last raw output so the caller (or the audit log) can inspect
 * what went wrong.
 *
 * Note: the public-facing Examiner pipeline does NOT throw this — per-patch
 * validation failures are collected into an `errors` array and reported in
 * the batch result so a single bad LLM round trip cannot kill the job. This
 * class exists for callers who want to opt into stricter handling.
 */
export class ExaminerValidationError extends Error {
  override readonly name = "ExaminerValidationError" as const;
  readonly attempts: number;
  readonly lastRawOutput: string;

  constructor(message: string, attempts: number, lastRawOutput: string) {
    super(message);
    this.attempts = attempts;
    this.lastRawOutput = lastRawOutput;
  }
}

// Made with Bob
