'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  AuditReportSchema,
  SignatureSchema,
  verifyAuditSignature,
  type AuditReport,
  type Signature,
} from '../../lib/verify-signature';

/**
 * Pure-client verifier form. Two textareas:
 *   1. Audit report JSON  (must match `AuditReport` schema)
 *   2. Signature JSON     (must match `Signature` schema)
 *
 * We Zod-parse each before invoking `verifySignature` so bad inputs surface
 * as clear validation errors rather than as `verify returns false`.
 *
 * Optional auto-fill: when `?jobId=…` is present on the URL we fetch the
 * job's canonical report + signature via `/api/jobs/[jobId]/audit-report`
 * and populate the two textareas. The manual paste path stays untouched —
 * we only mutate state when a jobId query param exists, and only once on
 * mount (an aborted-fetch guard prevents the fetch from racing with a user
 * who starts typing while the request is in flight).
 *
 * Auto-verify (after auto-fill) is gated on a successful `signed` status
 * fetch. We submit through the same `handleSubmit` path the manual button
 * uses, so there's exactly one verifier code path to maintain.
 */

type Result =
  | { kind: 'idle' }
  | { kind: 'pass' }
  | { kind: 'fail'; reason: string };

type AutoFillState =
  | { kind: 'idle' }
  | { kind: 'loading'; jobIdShort: string }
  | { kind: 'unsigned' }
  | { kind: 'legacy' }
  | { kind: 'signed' }
  | { kind: 'error'; message: string };

interface AuditReportApiBody {
  status: 'signed' | 'signed-legacy' | 'unsigned';
  report: unknown;
  signature: unknown;
  canonicalReportBytes?: string;
}

export default function VerifyForm() {
  const [reportText, setReportText] = useState('');
  const [signatureText, setSignatureText] = useState('');
  const [result, setResult] = useState<Result>({ kind: 'idle' });
  const [autoFill, setAutoFill] = useState<AutoFillState>({ kind: 'idle' });

  // Ref to the form for programmatic auto-submit. We use requestSubmit (which
  // triggers the normal submit handler) rather than calling handleSubmit
  // directly — keeps a single code path and respects HTML5 validation.
  const formRef = useRef<HTMLFormElement | null>(null);
  // Track whether we've already auto-submitted to avoid double-firing if
  // React re-runs the effect. Strict-mode + useEffect double-invoke would
  // otherwise trigger two verifications.
  const didAutoSubmitRef = useRef(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    const jobId = params.get('jobId');
    if (!jobId) return;

    const jobIdShort = jobId.length > 8 ? jobId.slice(0, 8) : jobId;
    setAutoFill({ kind: 'loading', jobIdShort });

    // AbortController so a user navigating away or hot-reloading doesn't get
    // a late state update.
    const controller = new AbortController();

    void (async () => {
      try {
        const res = await fetch(`/api/jobs/${jobId}/audit-report`, {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!res.ok) {
          setAutoFill({
            kind: 'error',
            message:
              res.status === 404
                ? `Job ${jobIdShort} not found.`
                : `Could not load report (HTTP ${res.status}).`,
          });
          return;
        }
        const body = (await res.json()) as AuditReportApiBody;

        if (body.status === 'unsigned') {
          setAutoFill({ kind: 'unsigned' });
          return;
        }

        // Both signed + signed-legacy paths populate the textareas — the
        // verifier itself handles the rebuild-vs-byte path internally.
        const reportJson = JSON.stringify(body.report, null, 2);
        const signatureJson = JSON.stringify(body.signature, null, 2);
        setReportText(reportJson);
        setSignatureText(signatureJson);

        if (body.status === 'signed-legacy') {
          setAutoFill({ kind: 'legacy' });
        } else {
          setAutoFill({ kind: 'signed' });
        }

        // Auto-verify after a short delay so the user sees the textareas
        // populate before the green badge appears. We schedule the submit
        // via setTimeout — not via state — because the textarea state
        // updates above are batched; calling requestSubmit synchronously
        // would race against React's commit phase. 300ms is enough cushion
        // to land both setStates AND give the eye a chance to register the
        // fields filling in.
        if (!didAutoSubmitRef.current) {
          didAutoSubmitRef.current = true;
          setTimeout(() => {
            if (controller.signal.aborted) return;
            formRef.current?.requestSubmit();
          }, 300);
        }
      } catch (err) {
        // AbortError is expected on unmount — swallow silently.
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setAutoFill({
          kind: 'error',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    })();

    return () => {
      controller.abort();
    };
  }, []);

  const handleSubmit = (e: FormEvent<HTMLFormElement>): void => {
    e.preventDefault();
    setResult({ kind: 'idle' });

    let report: AuditReport;
    let signature: Signature;

    try {
      const parsedReport = JSON.parse(reportText) as unknown;
      // Audit events from `/audit-report` come back with timestamp as a
      // string; coerce to Date before Zod-parse since AuditEventRecordSchema
      // requires Date instances.
      const coerced = coerceTimestamps(parsedReport);
      const validatedReport = AuditReportSchema.safeParse(coerced);
      if (!validatedReport.success) {
        setResult({
          kind: 'fail',
          reason: `Report JSON does not match AuditReport schema: ${validatedReport.error.issues[0]?.message ?? 'unknown'}`,
        });
        return;
      }
      report = validatedReport.data;
    } catch (err) {
      setResult({
        kind: 'fail',
        reason: `Report JSON parse error: ${err instanceof Error ? err.message : String(err)}`,
      });
      return;
    }

    try {
      const parsedSig = JSON.parse(signatureText) as unknown;
      const validatedSig = SignatureSchema.safeParse(parsedSig);
      if (!validatedSig.success) {
        setResult({
          kind: 'fail',
          reason: `Signature JSON does not match Signature schema: ${validatedSig.error.issues[0]?.message ?? 'unknown'}`,
        });
        return;
      }
      signature = validatedSig.data;
    } catch (err) {
      setResult({
        kind: 'fail',
        reason: `Signature JSON parse error: ${err instanceof Error ? err.message : String(err)}`,
      });
      return;
    }

    const ok = verifyAuditSignature(report, signature);
    if (ok) {
      setResult({ kind: 'pass' });
    } else {
      setResult({
        kind: 'fail',
        reason:
          'ed25519.verify returned false. Either the report bytes were tampered, or the signature is for a different report, or the public key is wrong.',
      });
    }
  };

  return (
    <>
      {autoFill.kind === 'loading' && (
        <p
          className="muted"
          role="status"
          style={{ marginTop: '1.5rem', fontSize: '0.9375rem' }}
        >
          Loading signed report for job <code>{autoFill.jobIdShort}…</code>
        </p>
      )}
      {autoFill.kind === 'unsigned' && (
        <div
          className="card"
          role="alert"
          style={{
            marginTop: '1.5rem',
            borderColor: 'rgba(234, 179, 8, 0.4)',
            background: 'rgba(234, 179, 8, 0.08)',
          }}
        >
          This job hasn&apos;t been signed yet — the verifier needs both report
          and signature. Wait for the Auditor to finish, then refresh.
        </div>
      )}
      {autoFill.kind === 'error' && (
        <div
          className="card"
          role="alert"
          style={{
            marginTop: '1.5rem',
            borderColor: 'rgba(239, 68, 68, 0.4)',
            background: 'rgba(239, 68, 68, 0.08)',
          }}
        >
          Could not auto-fill: {autoFill.message} You can still paste a report
          + signature manually below.
        </div>
      )}

      <form ref={formRef} onSubmit={handleSubmit} style={{ marginTop: '2rem' }}>
        <div className="field">
          <label htmlFor="report">Audit report (JSON)</label>
          <textarea
            id="report"
            required
            rows={10}
            value={reportText}
            onChange={(e) => setReportText(e.target.value)}
            placeholder='{"jobId":"…","snapshotId":"…","timestamp":"…","summary":{…},"events":[…]}'
          />
        </div>
        <div className="field">
          <label htmlFor="signature">Signature (JSON)</label>
          <textarea
            id="signature"
            required
            rows={6}
            value={signatureText}
            onChange={(e) => setSignatureText(e.target.value)}
            placeholder='{"algorithm":"ed25519","value":"…","publicKey":"…","messageHash":"…","signedAt":"…"}'
          />
        </div>
        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <button className="btn btn-primary" type="submit">
            Verify
          </button>
          {autoFill.kind === 'legacy' && (
            <span
              className="badge"
              title="Pre-W5 event format — verifier rebuilds canonical bytes from events"
            >
              legacy event format
            </span>
          )}
          {result.kind === 'pass' && (
            <span className="badge badge-success">VALID</span>
          )}
          {result.kind === 'fail' && (
            <span className="badge badge-error">INVALID</span>
          )}
        </div>
        {result.kind === 'fail' && (
          <p
            role="alert"
            style={{ marginTop: '1rem', color: 'var(--error)', fontSize: '0.9375rem' }}
          >
            {result.reason}
          </p>
        )}
        {result.kind === 'pass' && (
          <p
            role="status"
            style={{ marginTop: '1rem', color: 'var(--success)', fontSize: '0.9375rem' }}
          >
            Signature is valid. The canonical JSON of the report hashes to the
            declared message hash, and the ed25519 signature checks against the
            declared public key.
          </p>
        )}
      </form>
    </>
  );
}

/**
 * The `/api/jobs/[jobId]/audit-report` route returns events with `timestamp`
 * as an ISO string. The Zod schema requires `Date` instances. Walk the parsed
 * value once and coerce — non-Date strings on `events[].timestamp` become
 * Date objects.
 *
 * We only touch `events[*].timestamp`. `report.timestamp` is a string by the
 * schema definition; it stays as-is.
 */
function coerceTimestamps(parsed: unknown): unknown {
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !('events' in parsed) ||
    !Array.isArray((parsed as { events: unknown }).events)
  ) {
    return parsed;
  }
  const root = parsed as { events: unknown[] };
  root.events = root.events.map((e) => {
    if (e && typeof e === 'object' && 'timestamp' in e) {
      const event = e as { timestamp: unknown };
      if (typeof event.timestamp === 'string') {
        return { ...e, timestamp: new Date(event.timestamp) };
      }
    }
    return e;
  });
  return root;
}
