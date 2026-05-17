'use client';

import { useState, useTransition } from 'react';
import {
  verifyAuditSignature,
  verifyAuditSignatureFromBytes,
  type AuditReport,
  type Signature,
} from '../../../lib/verify-signature';

/**
 * Client-side signature verification widget.
 *
 * On click:
 *   1. Fetches `/api/jobs/[jobId]/audit-report` for the canonical report bytes
 *      + the signature.
 *   2. Calls `AuditorService.verifySignature(report, signature)` — which
 *      re-canonicalizes the report, recomputes the SHA-256 hash, and runs
 *      ed25519.verify in the browser via `@noble/curves/ed25519`. No server
 *      round-trip; the public key is the only thing we trust from the server.
 *
 * Both `@noble/curves`, `@noble/hashes`, and `canonicalJson` from
 * `@renatus/shared` are pure JS (no Node-only deps), so they tree-shake into
 * the client bundle cleanly. We deliberately do NOT re-implement
 * `verifySignature` here — the same code path runs in the agent and on the
 * client, which is the whole point.
 */

interface VerificationWidgetProps {
  jobId: string;
}

type VerificationState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'pass'; publicKeyShort: string }
  | { kind: 'fail'; reason: string };

interface AuditReportApiBody {
  status: 'signed' | 'signed-legacy' | 'unsigned';
  report: AuditReport;
  signature: Signature | null;
  /**
   * Present on `status: 'signed'` — the exact canonical-JSON bytes the
   * Auditor signed. When present we verify against these directly,
   * sidestepping the `report.timestamp` drift between in-process and DB
   * clocks. See `verifyAuditSignatureFromBytes`.
   */
  canonicalReportBytes?: string;
}

export default function VerificationWidget({
  jobId,
}: VerificationWidgetProps) {
  const [result, setResult] = useState<VerificationState>({ kind: 'idle' });
  const [isPending, startTransition] = useTransition();

  const verify = (): void => {
    setResult({ kind: 'checking' });
    startTransition(async () => {
      try {
        const res = await fetch(`/api/jobs/${jobId}/audit-report`, {
          cache: 'no-store',
        });
        if (!res.ok) {
          setResult({
            kind: 'fail',
            reason: `Could not fetch report (${res.status}).`,
          });
          return;
        }
        const data = (await res.json()) as AuditReportApiBody;
        if (!data.signature || data.status === 'unsigned') {
          setResult({
            kind: 'fail',
            reason: 'No signature present on this job.',
          });
          return;
        }

        // Preferred path — the server returned the exact canonical bytes
        // that were signed. Hash + verify directly. Byte-for-byte; no
        // re-canonicalization, no timestamp drift.
        if (
          data.status === 'signed' &&
          typeof data.canonicalReportBytes === 'string'
        ) {
          const verifyResult = verifyAuditSignatureFromBytes(
            data.canonicalReportBytes,
            data.signature,
          );
          if (verifyResult.ok) {
            setResult({
              kind: 'pass',
              publicKeyShort: `${data.signature.publicKey.slice(0, 16)}…${data.signature.publicKey.slice(-8)}`,
            });
          } else {
            setResult({
              kind: 'fail',
              reason:
                verifyResult.reason ??
                'Signature does NOT match the canonical report bytes.',
            });
          }
          return;
        }

        // Fallback (status === 'signed-legacy'): no canonical bytes
        // persisted. Re-canonicalize the rebuilt report. The report's
        // `timestamp` field is a string in the JSON shape; the
        // AuditEventRecord schema has `timestamp: z.date()`. JSON.parse
        // gave us strings — we have to coerce each event's timestamp back
        // to a Date so `canonicalJson` produces the same bytes the server
        // signed.
        const reportWithDates: AuditReport = {
          ...data.report,
          events: data.report.events.map((e) => ({
            ...e,
            timestamp:
              e.timestamp instanceof Date ? e.timestamp : new Date(e.timestamp),
          })),
        };

        const ok = verifyAuditSignature(reportWithDates, data.signature);
        if (ok) {
          setResult({
            kind: 'pass',
            publicKeyShort: `${data.signature.publicKey.slice(0, 16)}…${data.signature.publicKey.slice(-8)}`,
          });
        } else {
          setResult({
            kind: 'fail',
            reason:
              'Signature does NOT match the canonical report bytes. Either the report was tampered with, or the signature is wrong.',
          });
        }
      } catch (err) {
        setResult({
          kind: 'fail',
          reason: err instanceof Error ? err.message : String(err),
        });
      }
    });
  };

  return (
    <div>
      <button
        type="button"
        className="btn btn-primary"
        onClick={verify}
        disabled={isPending || result.kind === 'checking'}
      >
        {result.kind === 'checking' ? 'Verifying…' : 'Verify signature in browser'}
      </button>

      {result.kind === 'pass' && (
        <div
          className="card"
          role="status"
          style={{
            marginTop: '1rem',
            borderColor: 'rgba(34, 197, 94, 0.4)',
            background: 'rgba(34, 197, 94, 0.08)',
          }}
        >
          <strong className="badge badge-success" style={{ marginRight: '0.5rem' }}>
            VALID
          </strong>
          Signature verifies. The canonical report bytes match the message hash, and the
          ed25519 signature is valid against public key{' '}
          <code>{result.publicKeyShort}</code>.
        </div>
      )}

      {result.kind === 'fail' && (
        <div
          className="card"
          role="alert"
          style={{
            marginTop: '1rem',
            borderColor: 'rgba(239, 68, 68, 0.4)',
            background: 'rgba(239, 68, 68, 0.08)',
          }}
        >
          <strong className="badge badge-error" style={{ marginRight: '0.5rem' }}>
            INVALID
          </strong>
          {result.reason}
        </div>
      )}
    </div>
  );
}
