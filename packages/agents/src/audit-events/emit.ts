import type { AuditEventRepository, NewAuditEvent } from "@renatus/db";

/**
 * Best-effort audit event emission. Used by agents to record their actions
 * without breaking the workflow on persistence failures. The Auditor reads
 * these later to compose the signed audit report.
 *
 * @param repo - audit-event repository, or null/undefined to no-op (lets agents
 *               run in test contexts without a DB).
 * @param event - the new audit event (jobId / agentKind / eventType / payload required).
 *
 * Errors are logged to stderr and swallowed. Audit emission must NEVER throw
 * — a failed audit log shouldn't fail the migration.
 */
export async function emitAuditEvent(
  repo: AuditEventRepository | null | undefined,
  event: NewAuditEvent,
): Promise<void> {
  if (!repo) {
    return;
  }

  try {
    await repo.create(event);
  } catch (err) {
    // Never propagate. A failed audit log must not fail the migration.
    // We log to stderr so operators can spot persistent failures.
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(
      `[audit-events] emit failed for job=${event.jobId} agent=${event.agentKind} event=${event.eventType}: ${message}\n`,
    );
  }
}

/**
 * Curry the repo so call sites can emit events without re-passing it.
 *
 * The returned function accepts a partial event (omits `id` / `timestamp`,
 * both DB-defaulted) and is itself never-throws.
 */
export function createEmitter(
  repo: AuditEventRepository | null | undefined,
): (event: Omit<NewAuditEvent, "id" | "timestamp">) => Promise<void> {
  return async (event) => {
    await emitAuditEvent(repo, event as NewAuditEvent);
  };
}

// Made with Bob
