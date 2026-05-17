import {
  AuditEventRepository,
  JobRepository,
  QaTranscriptRepository,
} from '@renatus/db';
import { notFound } from 'next/navigation';
import { requireDatabaseUrl } from '../../../lib/database-url';
import JobLiveFeed from './job-live-feed';

/**
 * `/jobs/[jobId]` — live progress feed for a running job.
 *
 * RSC. We do an initial server-side fetch of the job row + audit events so
 * the page is interactive on first paint. The client island opens an
 * EventSource against `/api/jobs/[jobId]/stream` and merges new events
 * into a local list.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ jobId: string }>;
}

interface InitialAuditEvent {
  id: string;
  timestamp: string;
  agentKind: string;
  eventType: string;
  payload: Record<string, unknown>;
  entityId: string | null;
  entityType: string | null;
}

export default async function JobPage({ params }: PageProps) {
  const { jobId } = await params;

  const databaseUrl = requireDatabaseUrl();
  const jobRepo = new JobRepository(databaseUrl);
  const auditEventRepo = new AuditEventRepository(databaseUrl);
  const qaRepo = new QaTranscriptRepository(databaseUrl);

  const job = await jobRepo.getById(jobId);
  if (!job) {
    notFound();
  }

  const events = await auditEventRepo.findByJobId(jobId);
  const initialEvents: InitialAuditEvent[] = events.map((e) => ({
    id: e.id,
    timestamp: e.timestamp.toISOString(),
    agentKind: e.agentKind,
    eventType: e.eventType,
    payload: e.payload as Record<string, unknown>,
    entityId: e.entityId,
    entityType: e.entityType,
  }));

  // For Q&A jobs, surface the transcript inline when it's ready.
  const transcript =
    job.agentKind === 'qa' ? await qaRepo.getByJob(jobId) : null;

  return (
    <main className="container" style={{ padding: '3rem 1.5rem 6rem' }}>
      <p className="muted" style={{ marginBottom: '0.5rem', fontSize: '0.9375rem' }}>
        Renatus · job
      </p>
      <h1 style={{ marginBottom: '0.25rem' }}>
        <span className="badge badge-brand" style={{ marginRight: '0.75rem' }}>
          {job.agentKind}
        </span>
        Job <code style={{ fontSize: '1.25rem' }}>{shortId(jobId)}</code>
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

      <nav
        aria-label="Job views"
        style={{
          display: 'flex',
          gap: '0.5rem',
          flexWrap: 'wrap',
          margin: '1.25rem 0 0.5rem',
        }}
      >
        <a
          href={`/audit/${jobId}`}
          className="btn"
          style={{ textDecoration: 'none' }}
        >
          Signed audit →
        </a>
        <a
          href={`/kg/${jobId}`}
          className="btn"
          style={{ textDecoration: 'none' }}
        >
          Knowledge graph →
        </a>
        <a
          href={`/replay/${jobId}`}
          className="btn"
          style={{ textDecoration: 'none' }}
        >
          In-browser replay →
        </a>
      </nav>

      <JobLiveFeed
        jobId={jobId}
        agentKind={job.agentKind}
        initialState={job.state}
        initialEvents={initialEvents}
        initialTranscript={
          transcript
            ? {
                question: transcript.question,
                answer: transcript.answer,
                citations: transcript.citations,
              }
            : null
        }
      />
    </main>
  );
}

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}
