import {
  AuditEventRepository,
  JobRepository,
  PatchRepository,
  SnapshotRepository,
  TestRepository,
  type GeneratedTestRow,
  type PatchRow,
} from '@renatus/db';
import { notFound } from 'next/navigation';
import CopyButton from '../../components/copy-button';
import { requireDatabaseUrl } from '../../../lib/database-url';
import AuditActions from './audit-actions';
import VerificationWidget from './verification-widget';

/**
 * `/audit/[jobId]` — signed audit report viewer.
 *
 * RSC. Renders:
 *   - Job summary card (agent kind, repo, state, started/completed timestamps)
 *   - Signature panel (algorithm, public key, message hash, signed-at) + the
 *     in-browser verification widget (client island)
 *   - Patch list (expandable side-by-side before/after diffs)
 *   - Generated tests list (framework, strategy, file path)
 *
 * The page renders even when the job has zero patches or zero tests — the
 * empty states are first-class.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ jobId: string }>;
}

export default async function AuditPage({ params }: PageProps) {
  const { jobId } = await params;

  const databaseUrl = requireDatabaseUrl();
  const jobRepo = new JobRepository(databaseUrl);
  const auditEventRepo = new AuditEventRepository(databaseUrl);
  const patchRepo = new PatchRepository(databaseUrl);
  const testRepo = new TestRepository(databaseUrl);
  const snapshotRepo = new SnapshotRepository(databaseUrl);

  const job = await jobRepo.getById(jobId);
  if (!job) {
    notFound();
  }

  const [events, patches, tests, snapshot] = await Promise.all([
    auditEventRepo.findByJobId(jobId),
    patchRepo.getByJob(jobId),
    testRepo.getByJob(jobId),
    snapshotRepo.getByJobId(jobId),
  ]);

  // Snapshot may be null when the job failed before the clone step or the
  // snapshot was reaped. Q&A-cached needs it; the other cross-agent CTAs
  // don't (they clone fresh).
  const snapshotId: string | null = snapshot?.id ?? null;

  // Pre-encode for URL embedding. `encodeURIComponent` is the safe choice for
  // values inside a query string — it escapes `&`, `=`, `#`, etc.
  const repoUrlEnc = encodeURIComponent(job.repoUrl);
  const refEnc = encodeURIComponent(
    job.metadata && typeof job.metadata['ref'] === 'string'
      ? (job.metadata['ref'] as string)
      : 'main',
  );
  const snapshotIdEnc = snapshotId ? encodeURIComponent(snapshotId) : null;

  // Locate the audit_signed event payload — populated by AuditorService.
  const signedEvent = [...events]
    .reverse()
    .find((e) => e.eventType === 'audit_signed');
  const signedPayload = (signedEvent?.payload ?? {}) as Record<string, unknown>;
  const algorithm =
    typeof signedPayload['algorithm'] === 'string'
      ? (signedPayload['algorithm'] as string)
      : null;
  const signatureHex =
    typeof signedPayload['signatureHex'] === 'string'
      ? (signedPayload['signatureHex'] as string)
      : null;
  const publicKeyHex =
    typeof signedPayload['publicKeyHex'] === 'string'
      ? (signedPayload['publicKeyHex'] as string)
      : null;
  const messageHashHex =
    typeof signedPayload['messageHashHex'] === 'string'
      ? (signedPayload['messageHashHex'] as string)
      : null;

  const hasSignature = Boolean(
    algorithm && signatureHex && publicKeyHex && messageHashHex,
  );

  // Roll up byEventType for quick stats.
  const stats = aggregateStats(events.map((e) => e.eventType));

  return (
    <main className="container" style={{ padding: '3rem 1.5rem 6rem' }}>
      <p
        className="muted"
        style={{
          marginBottom: '0.5rem',
          fontSize: '0.9375rem',
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          flexWrap: 'wrap',
        }}
      >
        <a href="/jobs">← Back to all jobs</a>
        <span aria-hidden="true">·</span>
        Renatus · signed audit report
      </p>
      <h1 style={{ marginBottom: '0.25rem' }}>
        <span className="badge badge-brand" style={{ marginRight: '0.75rem' }}>
          {job.agentKind}
        </span>
        Audit <code style={{ fontSize: '1.25rem' }}>{shortId(jobId)}</code>
      </h1>
      <p className="muted" style={{ fontSize: '0.9375rem' }}>
        Repository: <code>{job.repoUrl}</code>
        {job.sourceVersion !== job.targetVersion && (
          <>
            {' · '}
            <code>
              {job.sourceVersion} → {job.targetVersion}
            </code>
          </>
        )}
      </p>

      {/* ─── Summary card ─── */}
      <section className="card" style={{ marginTop: '2rem' }}>
        <h2 style={{ marginTop: 0 }}>Summary</h2>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))',
            gap: '1rem',
            marginTop: '1rem',
          }}
        >
          <Stat label="State" value={job.state} />
          <Stat label="Total events" value={String(events.length)} />
          <Stat label="Patches" value={String(patches.length)} />
          <Stat label="Tests" value={String(tests.length)} />
          <Stat label="Failures" value={String(stats.failures)} />
        </div>
      </section>

      {/* ─── Signature panel ─── */}
      <section className="card" style={{ marginTop: '1.5rem' }}>
        <h2 style={{ marginTop: 0 }}>Signature</h2>
        {!hasSignature ? (
          <p className="muted">
            No signature yet — the Auditor either hasn&apos;t run or the job
            failed before the audit step.
          </p>
        ) : (
          <>
            <dl
              className="signature-grid"
              style={{
                display: 'grid',
                gridTemplateColumns: '140px 1fr',
                gap: '0.5rem 1rem',
                margin: 0,
              }}
            >
              <dt className="muted">Algorithm</dt>
              <dd style={{ margin: 0 }}>
                <code>{algorithm}</code>
              </dd>
              <dt className="muted">Public key</dt>
              <dd style={{ margin: 0, wordBreak: 'break-all' }}>
                <code>{publicKeyHex}</code>
              </dd>
              <dt className="muted">Message hash</dt>
              <dd style={{ margin: 0, wordBreak: 'break-all' }}>
                <code>{messageHashHex}</code>
              </dd>
              <dt className="muted">Signature</dt>
              <dd style={{ margin: 0, wordBreak: 'break-all' }}>
                <code>{signatureHex}</code>
              </dd>
              <dt className="muted">Signed at</dt>
              <dd style={{ margin: 0 }}>
                <code>
                  {signedEvent
                    ? signedEvent.timestamp.toISOString()
                    : 'unknown'}
                </code>
              </dd>
            </dl>
            <div style={{ marginTop: '1.25rem' }}>
              <VerificationWidget jobId={jobId} />
            </div>
          </>
        )}
      </section>

      {/* ─── Verify cryptographically ─── */}
      {hasSignature && (
        <section className="card" style={{ marginTop: '1.5rem' }}>
          <h2 style={{ marginTop: 0 }}>Verify cryptographically</h2>
          <p className="muted" style={{ marginTop: 0, marginBottom: '1rem' }}>
            Hand this signed report to a third party — auditor, compliance, or
            yourself in six months — and they can confirm tamper-freedom
            without trusting Renatus.
          </p>
          <AuditActions jobId={jobId} />
        </section>
      )}

      {/* ─── Patches list ─── */}
      <section style={{ marginTop: '2rem' }}>
        <h2>Patches ({patches.length})</h2>
        {patches.length === 0 ? (
          <p className="muted">No patches were generated for this job.</p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {patches.map((p) => (
              <PatchCard key={p.id} patch={p} />
            ))}
          </div>
        )}
      </section>

      {/* ─── Continue with this codebase ─── */}
      <section style={{ marginTop: '2rem' }}>
        <h2>Continue with this codebase</h2>

        {/* Snapshot ID surface. Renatus's Q&A "cached" mode needs this UUID,
         * and prior to this section the user had to dig into the DB to find
         * it. Now: visible, copyable, and the cached-Q&A CTA below auto-pre-
         * fills with this same value via query string. */}
        {snapshotId ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              flexWrap: 'wrap',
              marginBottom: '0.75rem',
              fontSize: '0.875rem',
            }}
          >
            <span className="muted">Snapshot ID:</span>
            <code style={{ wordBreak: 'break-all' }}>{snapshotId}</code>
            <CopyButton value={snapshotId} compact />
          </div>
        ) : (
          <p className="muted" style={{ fontSize: '0.875rem' }}>
            Snapshot ID:{' '}
            <span className="mute">
              not available (job failed before clone, or snapshot was reaped)
            </span>
          </p>
        )}

        <div
          style={{
            display: 'flex',
            flexWrap: 'wrap',
            gap: '0.75rem',
            marginTop: '0.5rem',
          }}
        >
          <a
            href={`/run?agent=refactor&repoUrl=${repoUrlEnc}&ref=${refEnc}`}
            className="btn"
            style={{
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
            }}
          >
            Refactor this codebase →
          </a>
          <a
            href={`/run?agent=security&repoUrl=${repoUrlEnc}&ref=${refEnc}`}
            className="btn"
            style={{
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
            }}
          >
            Security audit →
          </a>
          {snapshotIdEnc ? (
            <a
              href={`/run?agent=qa&snapshotId=${snapshotIdEnc}`}
              className="btn"
              style={{
                textDecoration: 'none',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
              }}
            >
              Ask Q&amp;A (instant) →
            </a>
          ) : (
            <span
              className="btn"
              aria-disabled="true"
              title="Snapshot not available — clone again via fresh repo URL"
              style={{
                opacity: 0.55,
                cursor: 'not-allowed',
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
              }}
            >
              Ask Q&amp;A (unavailable)
            </span>
          )}
        </div>
        <p className="muted" style={{ marginTop: '0.75rem', fontSize: '0.875rem' }}>
          Same engine, different agent. Click any to pre-fill the form with this
          repo.
        </p>
      </section>

      {/* ─── Tests list ─── */}
      <section style={{ marginTop: '2rem' }}>
        <h2>Generated tests ({tests.length})</h2>
        {tests.length === 0 ? (
          <p className="muted">No tests were generated for this job.</p>
        ) : (
          <ul style={{ paddingLeft: 0, listStyle: 'none', margin: 0 }}>
            {tests.map((t) => (
              <TestRow key={t.id} test={t} />
            ))}
          </ul>
        )}
      </section>

      <p className="mute" style={{ marginTop: '3rem', fontSize: '0.8125rem' }}>
        The full event log is also available via{' '}
        <code>GET /api/jobs/{jobId}/audit-report</code> as canonical JSON.
      </p>
    </main>
  );
}

function aggregateStats(eventTypes: string[]): {
  failures: number;
} {
  let failures = 0;
  for (const t of eventTypes) {
    if (t.endsWith('_failed')) failures += 1;
  }
  return { failures };
}

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="muted" style={{ fontSize: '0.8125rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
        {label}
      </div>
      <div style={{ fontSize: '1.5rem', fontWeight: 600, marginTop: '0.25rem' }}>
        {value}
      </div>
    </div>
  );
}

function PatchCard({ patch }: { patch: PatchRow }) {
  const statusBadgeClass =
    patch.status === 'applied'
      ? 'badge-success'
      : patch.status === 'rejected' || patch.status === 'unresolved'
        ? 'badge-error'
        : 'badge';
  return (
    <details className="card" style={{ padding: '1rem 1.25rem' }}>
      <summary
        style={{
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'baseline',
          gap: '0.75rem',
          flexWrap: 'wrap',
        }}
      >
        <code style={{ fontWeight: 500 }}>{patch.filePath}</code>
        <span className={`badge ${statusBadgeClass}`}>{patch.status}</span>
        <span className="muted" style={{ fontSize: '0.8125rem' }}>
          confidence {(patch.confidence * 100).toFixed(0)}%
        </span>
        {patch.rationale && (
          <span className="mute" style={{ fontSize: '0.8125rem' }}>
            · {patch.rationale}
          </span>
        )}
      </summary>
      <div
        className="patch-diff-grid"
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '0.75rem',
          marginTop: '1rem',
        }}
      >
        <div>
          <div
            className="muted"
            style={{
              fontSize: '0.75rem',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginBottom: '0.375rem',
            }}
          >
            Before
          </div>
          <pre style={{ fontSize: '0.75rem', maxHeight: '320px' }}>{patch.before}</pre>
        </div>
        <div>
          <div
            className="muted"
            style={{
              fontSize: '0.75rem',
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
              marginBottom: '0.375rem',
            }}
          >
            After
          </div>
          <pre style={{ fontSize: '0.75rem', maxHeight: '320px' }}>{patch.after}</pre>
        </div>
      </div>
    </details>
  );
}

function TestRow({ test }: { test: GeneratedTestRow }) {
  const resultBadge =
    test.passes === true
      ? <span className="badge badge-success">pass</span>
      : test.passes === false
        ? <span className="badge badge-error">fail</span>
        : <span className="badge">unrun</span>;
  return (
    <li className="card" style={{ padding: '0.75rem 1rem', marginBottom: '0.5rem' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'baseline',
          gap: '0.75rem',
          flexWrap: 'wrap',
        }}
      >
        <code>{test.filePath}</code>
        <span className="badge">{test.framework}</span>
        <span className="badge">{test.strategy}</span>
        {resultBadge}
        {test.durationMs !== null && (
          <span className="mute" style={{ fontSize: '0.8125rem' }}>
            {test.durationMs}ms
          </span>
        )}
      </div>
    </li>
  );
}
