/**
 * Base error for Auditor agent failures.
 */
export class AuditorError extends Error {
  public override readonly cause?: unknown;
  
  constructor(message: string, cause?: unknown) {
    super(message);
    this.name = "AuditorError";
    this.cause = cause;
  }
}

/**
 * Thrown when audit event retrieval fails.
 */
export class AuditorEventRetrievalError extends AuditorError {
  constructor(jobId: string, cause?: unknown) {
    super(`Failed to retrieve audit events for job ${jobId}`, cause);
    this.name = "AuditorEventRetrievalError";
  }
}

/**
 * Thrown when sandbox execution fails.
 */
export class AuditorSandboxError extends AuditorError {
  constructor(message: string, cause?: unknown) {
    super(`Sandbox execution failed: ${message}`, cause);
    this.name = "AuditorSandboxError";
  }
}

/**
 * Thrown when cryptographic signing fails.
 */
export class AuditorSigningError extends AuditorError {
  constructor(message: string, cause?: unknown) {
    super(`Cryptographic signing failed: ${message}`, cause);
    this.name = "AuditorSigningError";
  }
}

/**
 * Thrown when audit report generation fails.
 */
export class AuditorReportGenerationError extends AuditorError {
  constructor(message: string, cause?: unknown) {
    super(`Audit report generation failed: ${message}`, cause);
    this.name = "AuditorReportGenerationError";
  }
}

// Made with Bob
