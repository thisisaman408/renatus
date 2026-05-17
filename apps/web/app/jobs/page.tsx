import {
  JobRepository,
  SnapshotRepository,
  type JobRow,
  type SnapshotRow,
} from '@renatus/db';
import CopyButton from '../components/copy-button';
import { requireDatabaseUrl } from '../../lib/database-url';

/**
 * `/jobs` — directory-index view of every job persisted in Postgres,
 * newest first. RSC.
 *
 * The demo needs a way to navigate from "I just ran a thing" to "wait, what
 * did I run yesterday?" without remembering the job UUID. This is that page.
 *
 * No pagination yet — the demo footprint stays under 50 rows comfortably.
 * If we ever push past that, swap to keyset on `startedAt`.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_ROWS = 50;

export default async function JobsIndexPage() {
  const databaseUrl = requireDatabaseUrl();
  const jobRepo = new JobRepository(databaseUrl);
  const snapshotRepo = new SnapshotRepository(databaseUrl);
  const jobs = await jobRepo.getRecent(MAX_ROWS);

  // One DB round trip for all snapshots, keyed by jobId. The Q&A re-run CTA
  // needs the snapshot UUID per row — fetching one-by-one would be N+1.
  const snapshotsByJobId = await snapshotRepo.getByJobIds(jobs.map((j) => j.id));

  return (
    <main className="container" style={{ padding: '3rem 1.5rem 6rem' }}>
      <p className="muted" style={{ marginBottom: '0.5rem', fontSize: '0.9375rem' }}>
        Renatus · job history
      </p>
      <h1 style={{ marginBottom: '0.5rem' }}>Job history</h1>
      <p className="muted" style={{ maxWidth: 720 }}>
        Every Renatus run is persisted. Click into any job to see its signed
        audit, knowledge graph, or run tests in your browser.
      </p>

      <div style={{ marginTop: '1.5rem' }}>
        <a
          href="/run"
          className="btn btn-primary"
          style={{ textDecoration: 'none' }}
        >
          Submit a new job →
        </a>
      </div>

      {jobs.length === 0 ? (
        <section className="card" style={{ marginTop: '2rem', textAlign: 'center' }}>
          <p className="muted" style={{ margin: 0 }}>
            No jobs yet.{' '}
            <a href="/run">Submit your first →</a>
          </p>
        </section>
      ) : (
        <section style={{ marginTop: '2rem', overflowX: 'auto' }}>
          <table
            style={{
              width: '100%',
              borderCollapse: 'collapse',
              fontSize: '0.9375rem',
            }}
          >
            <thead>
              <tr
                style={{
                  textAlign: 'left',
                  color: 'var(--text-dim)',
                  borderBottom: '1px solid var(--border)',
                }}
              >
                <th style={cellHeader}>Job ID</th>
                <th style={cellHeader}>Agent</th>
                <th style={cellHeader}>Repository</th>
                <th style={cellHeader}>State</th>
                <th style={cellHeader}>Snapshot</th>
                <th style={cellHeader}>Started</th>
                <th style={cellHeader}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {jobs.map((job) => (
                <JobRowView
                  key={job.id}
                  job={job}
                  snapshot={snapshotsByJobId.get(job.id) ?? null}
                />
              ))}
            </tbody>
          </table>
        </section>
      )}
    </main>
  );
}

function JobRowView({
  job,
  snapshot,
}: {
  job: JobRow;
  snapshot: SnapshotRow | null;
}) {
  // Pre-encode for URL embedding. The Re-run quick-launch CTAs hand these to
  // `/run` as `repoUrl=…&ref=…` so the form pre-fills correctly. We honor
  // `metadata.ref` if present (set by the run-form on dispatch), else fall
  // back to the snapshot's recorded ref, else "main".
  const repoUrlEnc = encodeURIComponent(job.repoUrl);
  const metadataRef =
    job.metadata && typeof job.metadata['ref'] === 'string'
      ? (job.metadata['ref'] as string)
      : null;
  const ref = metadataRef ?? snapshot?.ref ?? 'main';
  const refEnc = encodeURIComponent(ref);
  const snapshotId = snapshot?.id ?? null;
  const snapshotIdEnc = snapshotId ? encodeURIComponent(snapshotId) : null;

  return (
    <tr style={{ borderBottom: '1px solid var(--border)' }}>
      <td style={cell}>
        <a href={`/jobs/${job.id}`}>
          <code style={{ fontSize: '0.875rem' }}>{shortId(job.id)}</code>
        </a>
      </td>
      <td style={cell}>
        <span className="badge badge-brand">{job.agentKind}</span>
      </td>
      <td
        style={{
          ...cell,
          maxWidth: 300,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
        title={job.repoUrl}
      >
        <code style={{ fontSize: '0.8125rem' }}>{job.repoUrl}</code>
      </td>
      <td style={cell}>
        <span className={`badge ${stateBadgeClass(job.state)}`}>
          {job.state}
        </span>
      </td>
      <td style={cell}>
        {snapshotId ? (
          <span
            style={{
              display: 'inline-flex',
              gap: '0.375rem',
              alignItems: 'center',
            }}
            title={snapshotId}
          >
            <code style={{ fontSize: '0.8125rem' }}>
              {snapshotId.slice(0, 8)}
            </code>
            <CopyButton value={snapshotId} compact />
          </span>
        ) : (
          <span className="mute">—</span>
        )}
      </td>
      <td style={{ ...cell, color: 'var(--text-dim)', fontSize: '0.8125rem' }}>
        {timeAgo(job.startedAt)}
      </td>
      <td style={cell}>
        {/* Two-row stack: "View" group (jump to existing artifacts) vs.
         * "Re-run" group (dispatch a NEW job on this same repo through a
         * different agent). Q&A is only available when a snapshot exists —
         * otherwise the route would have to clone again, and that's the
         * Refactor/Security CTAs' job. */}
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.25rem',
            fontSize: '0.875rem',
          }}
        >
          <div
            style={{
              display: 'inline-flex',
              gap: '0.625rem',
              flexWrap: 'wrap',
            }}
          >
            <a href={`/audit/${job.id}`}>Audit →</a>
            <a href={`/kg/${job.id}`}>Graph →</a>
            <a href={`/replay/${job.id}`}>Replay →</a>
            {/* Verify is only meaningful once the Auditor has signed — for
             * failed/cloning jobs there's no signature to verify yet. We
             * render a muted "—" slot in non-done rows to keep the column
             * width stable. */}
            {job.state === 'done' ? (
              <a href={`/verify?jobId=${job.id}`}>Verify →</a>
            ) : (
              <span className="mute" title="No signature until the Auditor finishes">
                Verify —
              </span>
            )}
          </div>
          <div
            style={{
              display: 'inline-flex',
              gap: '0.625rem',
              flexWrap: 'wrap',
              fontSize: '0.8125rem',
              borderTop: '1px dashed var(--border)',
              paddingTop: '0.25rem',
            }}
          >
            {snapshotIdEnc ? (
              <a href={`/run?agent=qa&snapshotId=${snapshotIdEnc}`}>Q&amp;A →</a>
            ) : (
              <span className="mute" title="No snapshot — re-run via repoUrl">
                Q&amp;A —
              </span>
            )}
            <a
              href={`/run?agent=refactor&repoUrl=${repoUrlEnc}&ref=${refEnc}`}
            >
              Refactor →
            </a>
            <a
              href={`/run?agent=security&repoUrl=${repoUrlEnc}&ref=${refEnc}`}
            >
              Security →
            </a>
          </div>
        </div>
      </td>
    </tr>
  );
}

const cellHeader: React.CSSProperties = {
  padding: '0.5rem 0.75rem',
  fontWeight: 500,
  fontSize: '0.8125rem',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
};

const cell: React.CSSProperties = {
  padding: '0.75rem 0.75rem',
  verticalAlign: 'middle',
};

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

function stateBadgeClass(state: string): string {
  if (state === 'done') return 'badge-success';
  if (state === 'failed' || state === 'aborted') return 'badge-error';
  return 'badge-brand';
}

/**
 * Compact "x seconds ago" / "x minutes ago" / "x hours ago" / "x days ago".
 * Renders on the server with `Date.now()` at request-time — this RSC is
 * `force-dynamic` so each refresh shows fresh deltas.
 */
function timeAgo(d: Date): string {
  const sec = Math.floor((Date.now() - d.getTime()) / 1000);
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ago`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h ago`;
  return `${Math.floor(sec / 86400)}d ago`;
}

// Made with Bob
