import { JobRepository, PatchRepository, SnapshotRepository } from '@renatus/db';
import { notFound } from 'next/navigation';
import { requireDatabaseUrl } from '../../../lib/database-url';
import ReplayCanvas from './replay-canvas';

/**
 * `/replay/[jobId]` — WebContainers in-browser test runner.
 *
 * RSC shell. We gate on the job's `state` because WebContainers can only
 * usefully replay a workspace that has at least proposed patches. For early
 * states (clone/index/plan) we render a status card instead of booting the
 * sandbox just to fail.
 *
 * Cross-origin isolation headers (`Cross-Origin-Embedder-Policy: require-corp`
 * + `Cross-Origin-Opener-Policy: same-origin`) are set globally for `/replay`
 * in `apps/web/next.config.ts`. Without them, `SharedArrayBuffer` is not
 * available and the WebContainers boot throws. The client island surfaces
 * a clear error in that case.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const REPLAY_READY_STATES = new Set([
  'patched',
  'testing',
  'tested',
  'auditing',
  'audited',
  'done',
]);

interface PageProps {
  params: Promise<{ jobId: string }>;
}

export default async function ReplayPage({ params }: PageProps) {
  const { jobId } = await params;

  const databaseUrl = requireDatabaseUrl();
  const jobRepo = new JobRepository(databaseUrl);
  const snapshotRepo = new SnapshotRepository(databaseUrl);
  const patchRepo = new PatchRepository(databaseUrl);

  const job = await jobRepo.getById(jobId);
  if (!job) notFound();

  const snapshot = await snapshotRepo.getByJobId(jobId);
  const patches = snapshot ? await patchRepo.getByJob(jobId) : [];
  const applicablePatchCount = patches.filter(
    (p) => p.status === 'proposed' || p.status === 'applied',
  ).length;

  const ready =
    REPLAY_READY_STATES.has(job.state) && applicablePatchCount > 0;

  return (
    <main className="container" style={{ padding: '3rem 1.5rem 6rem' }}>
      <p
        className="muted"
        style={{ marginBottom: '0.5rem', fontSize: '0.9375rem' }}
      >
        Renatus · in-browser replay
      </p>
      <h1 style={{ marginBottom: '0.25rem' }}>
        <span className="badge badge-brand" style={{ marginRight: '0.75rem' }}>
          {job.agentKind}
        </span>
        Replay <code style={{ fontSize: '1.25rem' }}>{shortId(jobId)}</code>{' '}
        <span className="badge" style={{ marginLeft: '0.5rem' }}>
          {job.state}
        </span>
      </h1>
      <p
        className="muted"
        style={{ marginTop: '0.5rem', maxWidth: 760, fontSize: '0.9375rem' }}
      >
        WebContainers boots a Node runtime inside your browser, mounts the
        patched workspace, runs <code>pnpm install</code> and{' '}
        <code>pnpm test</code>. No backend round-trip.
      </p>

      {!ready ? (
        <section className="card" style={{ marginTop: '1.5rem' }}>
          <h2 style={{ marginTop: 0 }}>Replay not yet available</h2>
          <p className="muted" style={{ margin: 0 }}>
            The Surgeon has not produced applicable patches yet. Replay opens
            once the job state reaches <code>patched</code> or later, with at
            least one <code>proposed</code> or <code>applied</code> patch.
            Current state: <span className="badge">{job.state}</span>; patches
            applicable: <code>{applicablePatchCount}</code>.
          </p>
        </section>
      ) : (
        <section style={{ marginTop: '1.5rem' }}>
          <ReplayCanvas jobId={jobId} />
        </section>
      )}
    </main>
  );
}

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}
