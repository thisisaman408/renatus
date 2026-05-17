import { NextResponse, type NextRequest } from 'next/server';
import { AuditEventRepository, JobRepository } from '@renatus/db';
import type {
  AuditEventRecord,
  AuditReport,
  AuditReportSummary,
  Signature,
} from '@renatus/agents';
import { requireDatabaseUrl } from '../../../../../lib/database-url';

/**
 * `/api/jobs/[jobId]/audit-report` — canonical `AuditReport` JSON for the job.
 *
 * Two modes:
 *
 *   1. New (preferred). The most recent `audit_signed` event has a
 *      `canonicalReportBytes` field in its payload — the exact bytes the
 *      Auditor signed. We `JSON.parse(canonicalReportBytes)` to recover the
 *      AuditReport object that was originally signed and return it plus the
 *      raw bytes (`canonicalReportBytes`). The client verifies against the
 *      bytes directly — guaranteed byte-for-byte match, regardless of any
 *      timestamp drift between the in-process `new Date()` and the DB's
 *      `audit_signed` row timestamp.
 *
 *   2. Legacy / unsigned. The event has no `canonicalReportBytes`, OR the
 *      job hasn't been signed yet. We rebuild the report shape from
 *      `audit_events` exactly as before — this path is lossy on
 *      `report.timestamp` (the rebuilt value uses the audit_signed event's
 *      DB timestamp, which can drift microseconds from the originally
 *      signed value), so we mark the body `status: 'signed-legacy'` and the
 *      client falls back to `verifyAuditSignature(report, signature)`
 *      which re-canonicalizes the rebuilt report. Console-warn so the
 *      operator notices.
 *
 * `status: 'unsigned'` for jobs not yet audited — the UI shows "audit
 * pending" rather than asking the user to verify nothing.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface RouteContext {
  params: Promise<{ jobId: string }>;
}

interface SuccessBody {
  status: 'signed' | 'signed-legacy' | 'unsigned';
  report: AuditReport;
  signature: Signature | null;
  /**
   * Present only on the new persisted path (`status: 'signed'`). The exact
   * canonical-JSON bytes the Auditor signed — the client uses these to
   * hash-and-verify byte-for-byte.
   */
  canonicalReportBytes?: string;
}

interface ErrorBody {
  error: string;
}

export async function GET(
  _req: NextRequest,
  context: RouteContext,
): Promise<NextResponse<SuccessBody | ErrorBody>> {
  const { jobId } = await context.params;

  let databaseUrl: string;
  try {
    databaseUrl = requireDatabaseUrl();
  } catch (err) {
    return NextResponse.json<ErrorBody>(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }

  const jobRepo = new JobRepository(databaseUrl);
  const auditEventRepo = new AuditEventRepository(databaseUrl);

  const job = await jobRepo.getById(jobId);
  if (!job) {
    return NextResponse.json<ErrorBody>(
      { error: 'Job not found' },
      { status: 404 },
    );
  }

  const events = await auditEventRepo.findByJobId(jobId);

  // We need a snapshotId for the AuditReport schema. The migrate / refactor /
  // security workflows attach it to the `snapshot_created` event payload as
  // `snapshotId`. We pull it from there; if the workflow failed before clone,
  // the field is missing and we use the zero-UUID sentinel so the report
  // still parses (and the UI can flag the failure).
  const ZERO_UUID = '00000000-0000-0000-0000-000000000000';
  let snapshotId: string = ZERO_UUID;
  for (const e of events) {
    if (e.eventType === 'snapshot_created') {
      const payload = e.payload as Record<string, unknown>;
      const snap = payload['snapshotId'];
      if (typeof snap === 'string') {
        snapshotId = snap;
        break;
      }
    }
  }

  // Locate the most recent `audit_signed` event. We defensively pick the
  // latest (the Auditor only emits one per run, but Inngest retries could
  // in theory produce duplicates).
  type SignedEventRow = (typeof events)[number];
  let signedEvent: SignedEventRow | null = null;
  for (let i = events.length - 1; i >= 0; i--) {
    if (events[i]!.eventType === 'audit_signed') {
      signedEvent = events[i]!;
      break;
    }
  }

  // Re-shape DB rows into the canonical AuditEventRecord shape — same
  // structural transform as `AuditorService.generateAuditReport`. Used by
  // the legacy/unsigned fallback paths.
  const eventRecords: AuditEventRecord[] = events.map((e) => ({
    id: e.id,
    jobId: e.jobId,
    agentKind: e.agentKind,
    eventType: e.eventType,
    payload: e.payload as Record<string, unknown>,
    timestamp: e.timestamp,
    entityId: e.entityId,
    entityType: e.entityType,
  }));

  // Compute the summary the same way the Auditor does. We rebuild here
  // (rather than importing `AuditorService`'s private method) so this route
  // is self-contained.
  const summary = buildSummary(eventRecords);

  // ────────────────────────────────────────────────────────────────────
  // Path 1: unsigned (no audit_signed event at all)
  // ────────────────────────────────────────────────────────────────────
  if (!signedEvent) {
    const report: AuditReport = {
      jobId,
      snapshotId,
      timestamp: new Date().toISOString(),
      summary,
      events: eventRecords,
    };
    return NextResponse.json<SuccessBody>({
      status: 'unsigned',
      report,
      signature: null,
    });
  }

  const payload = signedEvent.payload as Record<string, unknown>;
  // rationale: jsonb columns come back typed as `unknown`; we narrow each
  // field at the seam. Same pattern as `AuditorService.generateAuditReport`.
  const algorithm = payload['algorithm'];
  const canonicalReportBytes = payload['canonicalReportBytes'];
  // Prefer the explicit new keys; fall back to legacy `*Hex` keys for any
  // signed event written before this route + Auditor were updated.
  const valueField =
    typeof payload['value'] === 'string'
      ? (payload['value'] as string)
      : typeof payload['signatureHex'] === 'string'
        ? (payload['signatureHex'] as string)
        : null;
  const publicKeyField =
    typeof payload['publicKey'] === 'string'
      ? (payload['publicKey'] as string)
      : typeof payload['publicKeyHex'] === 'string'
        ? (payload['publicKeyHex'] as string)
        : null;
  const messageHashField =
    typeof payload['messageHash'] === 'string'
      ? (payload['messageHash'] as string)
      : typeof payload['messageHashHex'] === 'string'
        ? (payload['messageHashHex'] as string)
        : null;
  const signedAtField =
    typeof payload['signedAt'] === 'string'
      ? (payload['signedAt'] as string)
      : signedEvent.timestamp.toISOString();

  if (
    algorithm !== 'ed25519' ||
    valueField === null ||
    publicKeyField === null ||
    messageHashField === null
  ) {
    // Malformed audit_signed payload — treat as unsigned so the UI shows
    // "audit pending" rather than wedging on a falsy signature object.
    const report: AuditReport = {
      jobId,
      snapshotId,
      timestamp: new Date().toISOString(),
      summary,
      events: eventRecords,
    };
    return NextResponse.json<SuccessBody>({
      status: 'unsigned',
      report,
      signature: null,
    });
  }

  // ────────────────────────────────────────────────────────────────────
  // Path 2: signed (new) — canonical bytes available, byte-for-byte verify
  // ────────────────────────────────────────────────────────────────────
  if (typeof canonicalReportBytes === 'string') {
    let signedReport: AuditReport;
    try {
      // rationale: canonicalReportBytes is canonical JSON we produced
      // server-side; parsing yields the exact object that was signed.
      signedReport = JSON.parse(canonicalReportBytes) as AuditReport;
    } catch (err) {
      console.warn(
        `[audit-report] Failed to JSON.parse canonicalReportBytes for job ${jobId}: ${
          err instanceof Error ? err.message : String(err)
        } — falling back to event-rebuild path`,
      );
      const fallbackReport: AuditReport = {
        jobId,
        snapshotId,
        timestamp: signedAtField,
        summary,
        events: eventRecords,
      };
      const fallbackSignature: Signature = {
        algorithm: 'ed25519',
        value: valueField,
        publicKey: publicKeyField,
        messageHash: messageHashField,
        signedAt: signedAtField,
      };
      return NextResponse.json<SuccessBody>({
        status: 'signed-legacy',
        report: fallbackReport,
        signature: fallbackSignature,
      });
    }

    const signature: Signature = {
      algorithm: 'ed25519',
      value: valueField,
      publicKey: publicKeyField,
      messageHash: messageHashField,
      signedAt: signedAtField,
      canonicalReportBytes,
    };

    return NextResponse.json<SuccessBody>({
      status: 'signed',
      report: signedReport,
      signature,
      canonicalReportBytes,
    });
  }

  // ────────────────────────────────────────────────────────────────────
  // Path 3: signed (legacy) — pre-W5 event, no canonical bytes persisted
  // ────────────────────────────────────────────────────────────────────
  console.warn(
    `[audit-report] Missing canonicalReportBytes for job ${jobId}; ` +
      `falling back to event-rebuild path (signature verification may fail ` +
      `due to timestamp drift between in-process clock and DB clock).`,
  );

  const legacyReport: AuditReport = {
    jobId,
    snapshotId,
    timestamp: signedAtField,
    summary,
    events: eventRecords,
  };
  const legacySignature: Signature = {
    algorithm: 'ed25519',
    value: valueField,
    publicKey: publicKeyField,
    messageHash: messageHashField,
    signedAt: signedAtField,
  };

  return NextResponse.json<SuccessBody>({
    status: 'signed-legacy',
    report: legacyReport,
    signature: legacySignature,
  });
}

function buildSummary(events: AuditEventRecord[]): AuditReportSummary {
  const byAgent: Record<string, number> = {};
  const byEventType: Record<string, number> = {};

  for (const event of events) {
    byAgent[event.agentKind] = (byAgent[event.agentKind] ?? 0) + 1;
    byEventType[event.eventType] = (byEventType[event.eventType] ?? 0) + 1;
  }

  return {
    totalEvents: events.length,
    byAgent,
    byEventType,
    patchesProposed: byEventType['patch_proposed'] ?? 0,
    patchesApplied: byEventType['patch_applied'] ?? 0,
    patchesUnresolved: byEventType['patch_unresolved'] ?? 0,
    testsGenerated: byEventType['test_generated'] ?? 0,
    testsPassed: byEventType['test_passed'] ?? 0,
    testsFailed: byEventType['test_failed'] ?? 0,
    failures: Object.entries(byEventType)
      .filter(([type]) => type.endsWith('_failed'))
      .reduce((sum, [, count]) => sum + count, 0),
  };
}
