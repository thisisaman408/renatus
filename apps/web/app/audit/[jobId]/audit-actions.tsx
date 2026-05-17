'use client';

import { useState } from 'react';

/**
 * Client-side download buttons for the audit page.
 *
 * Fetches `/api/jobs/[jobId]/audit-report` and triggers browser downloads for
 * either the canonical report JSON or the signature JSON. The audit page is an
 * RSC, so the actual click handlers + DOM-creating download trick must live in
 * a client island.
 *
 * Each button tracks its own state independently — clicking "Download report"
 * shouldn't flicker the signature button. State machine per button:
 *   idle → busy → done   (success)
 *   idle → busy → failed (error)
 *
 * The two buttons share a single fetch path. We don't cache between clicks —
 * the canonical bytes are tiny (sub-100KB even for jobs with hundreds of
 * events) and the demo audience expects "fresh download" semantics.
 */

interface AuditActionsProps {
  jobId: string;
}

type ButtonState = 'idle' | 'busy' | 'done' | 'failed';

interface AuditReportApiBody {
  status: 'signed' | 'signed-legacy' | 'unsigned';
  // rationale: we don't depend on the shape of report/signature here — we
  // only stringify them and hand them to the browser. The /verify page does
  // the actual schema validation.
  report: unknown;
  signature: unknown;
  canonicalReportBytes?: string;
}

export default function AuditActions({ jobId }: AuditActionsProps) {
  const [reportState, setReportState] = useState<ButtonState>('idle');
  const [signatureState, setSignatureState] = useState<ButtonState>('idle');

  const jobIdShort = jobId.length > 8 ? jobId.slice(0, 8) : jobId;

  const download = async (kind: 'report' | 'signature'): Promise<void> => {
    const setState = kind === 'report' ? setReportState : setSignatureState;
    setState('busy');
    try {
      const res = await fetch(`/api/jobs/${jobId}/audit-report`, {
        cache: 'no-store',
      });
      if (!res.ok) {
        setState('failed');
        return;
      }
      const body = (await res.json()) as AuditReportApiBody;
      const payload = kind === 'report' ? body.report : body.signature;
      if (payload === null || payload === undefined) {
        // signature is null when the job is unsigned. Surface failure rather
        // than downloading "null".
        setState('failed');
        return;
      }
      const json = JSON.stringify(payload, null, 2);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const filename =
        kind === 'report'
          ? `audit-report-${jobIdShort}.json`
          : `audit-signature-${jobIdShort}.json`;
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      setState('done');
    } catch {
      setState('failed');
    }
  };

  return (
    <div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.75rem',
          alignItems: 'center',
        }}
      >
        <a
          href={`/verify?jobId=${jobId}`}
          className="btn btn-primary"
          style={{
            textDecoration: 'none',
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.5rem',
          }}
        >
          Open in browser verifier →
        </a>
        <button
          type="button"
          className="btn"
          onClick={() => {
            void download('report');
          }}
          disabled={reportState === 'busy'}
        >
          {labelFor('Download report JSON', reportState)}
        </button>
        <button
          type="button"
          className="btn"
          onClick={() => {
            void download('signature');
          }}
          disabled={signatureState === 'busy'}
        >
          {labelFor('Download signature JSON', signatureState)}
        </button>
      </div>
      <p
        className="muted"
        style={{ marginTop: '0.75rem', fontSize: '0.875rem' }}
      >
        The verifier runs entirely in your browser — paste-and-verify, or click
        &quot;Open in verifier&quot; to auto-fill both fields.
      </p>
    </div>
  );
}

function labelFor(base: string, state: ButtonState): string {
  if (state === 'busy') return `${base}…`;
  if (state === 'done') return `${base} ✓`;
  if (state === 'failed') return `${base} (failed)`;
  return base;
}
