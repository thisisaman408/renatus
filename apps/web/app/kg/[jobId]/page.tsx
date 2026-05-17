import {
  AuditEventRepository,
  FileRepository,
  ImportRepository,
  JobRepository,
  PatchRepository,
  SnapshotRepository,
  type AuditEvent,
} from '@renatus/db';
import { notFound } from 'next/navigation';
import { requireDatabaseUrl } from '../../../lib/database-url';
import KgCanvas, { type KgData } from './kg-canvas';

/**
 * `/kg/[jobId]` — 2D knowledge graph of the indexed repo.
 *
 * RSC. Loads the snapshot's files + import edges + Surgeon patches + the
 * `patch_batch_completed` audit events that record the actual order in which
 * Surgeon applied batches. The client island then renders a force-directed
 * graph and replays the patch batches in their emission order.
 *
 * The animation order = the data structure the recursive CTE produced.
 * That's the demo pitch — Renatus patches connected file clusters as
 * coherent batches, not files in isolation.
 *
 * If the snapshot isn't yet created (job is mid-clone), we render an empty
 * state with the current state badge. Same for jobs that have no patches yet.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

interface PageProps {
  params: Promise<{ jobId: string }>;
}

export default async function KgPage({ params }: PageProps) {
  const { jobId } = await params;

  const databaseUrl = requireDatabaseUrl();
  const jobRepo = new JobRepository(databaseUrl);
  const snapshotRepo = new SnapshotRepository(databaseUrl);
  const fileRepo = new FileRepository(databaseUrl);
  const importRepo = new ImportRepository(databaseUrl);
  const patchRepo = new PatchRepository(databaseUrl);
  const auditEventRepo = new AuditEventRepository(databaseUrl);

  const job = await jobRepo.getById(jobId);
  if (!job) notFound();

  const snapshot = await snapshotRepo.getByJobId(jobId);

  // Empty-state path: snapshot isn't created yet (clone/index still running)
  // or the workflow never reached the index step. We render the page shell
  // with a clear status — no 404.
  if (!snapshot) {
    return (
      <main className="container" style={{ padding: '3rem 1.5rem 6rem' }}>
        <KgHeader jobId={jobId} agentKind={job.agentKind} state={job.state} />
        <section className="card" style={{ marginTop: '1.5rem' }}>
          <h2 style={{ marginTop: 0 }}>Knowledge graph not yet available</h2>
          <p className="muted" style={{ margin: 0 }}>
            The clone/index step has not completed yet. Current job state:{' '}
            <span className="badge">{job.state}</span>. Reload this page once
            the workflow reaches <code>indexed</code> or later.
          </p>
        </section>
      </main>
    );
  }

  const [files, edges, patches, events] = await Promise.all([
    fileRepo.getBySnapshot(snapshot.id),
    importRepo.getBySnapshot(snapshot.id),
    patchRepo.getByJob(jobId),
    auditEventRepo.findByJobId(jobId),
  ]);

  const kgData = buildKgData(files, edges, patches, events);

  return (
    <main className="container" style={{ padding: '3rem 1.5rem 6rem' }}>
      <KgHeader jobId={jobId} agentKind={job.agentKind} state={job.state} />

      {/* What-you're-looking-at callout. The force-directed graph is visually
       * striking but inscrutable on first glance — this panel anchors three
       * audiences (humans, the LLM, MCP/Bob) to the same artifact. */}
      <section
        className="card"
        style={{
          marginTop: '1.25rem',
          borderColor: 'var(--brand)',
          maxWidth: 760,
        }}
      >
        <p style={{ margin: '0 0 0.5rem' }}>
          <strong>Knowledge graph — Renatus&apos;s retrieval layer.</strong>
        </p>
        <ul
          style={{
            margin: 0,
            paddingLeft: '1.25rem',
            fontSize: '0.9375rem',
            lineHeight: 1.6,
          }}
        >
          <li>
            <strong>For humans:</strong> the blast radius of this migration.
            Highlighted nodes = files Renatus patched. Their importers light
            up to show propagation.
          </li>
          <li>
            <strong>For the LLM:</strong> this graph <em>is</em> the retrieval
            system. The Surgeon walks the import edges to pick what code goes
            into each prompt — never the whole repo.
          </li>
          <li>
            <strong>For MCP / Bob:</strong> the{' '}
            <code>query_knowledge_graph</code> tool exposes the same graph.
            Bob can ask &quot;what depends on auth.ts&quot; and get a
            structured answer grounded in this index.
          </li>
        </ul>
      </section>

      <p
        className="muted"
        style={{ marginTop: '1.5rem', maxWidth: 760, fontSize: '0.9375rem' }}
      >
        Renatus operates on the dependency graph — it patches connected file
        clusters as coherent batches, not files in isolation. The replay order
        below is the actual batch-emission order from this run&apos;s Surgeon.
      </p>
      <section style={{ marginTop: '1.5rem' }}>
        <KgCanvas data={kgData} />
      </section>
      <p className="mute" style={{ marginTop: '2rem', fontSize: '0.8125rem' }}>
        {kgData.nodes.length} files · {kgData.edges.length} edges ·{' '}
        {kgData.batchOrder.length} patch batches.
      </p>
    </main>
  );
}

function KgHeader({
  jobId,
  agentKind,
  state,
}: {
  jobId: string;
  agentKind: string;
  state: string;
}) {
  return (
    <>
      <p
        className="muted"
        style={{ marginBottom: '0.5rem', fontSize: '0.9375rem' }}
      >
        Renatus · 2D knowledge graph
      </p>
      <h1 style={{ marginBottom: '0.25rem' }}>
        <span className="badge badge-brand" style={{ marginRight: '0.75rem' }}>
          {agentKind}
        </span>
        Graph <code style={{ fontSize: '1.25rem' }}>{shortId(jobId)}</code>{' '}
        <span className="badge" style={{ marginLeft: '0.5rem' }}>
          {state}
        </span>
      </h1>
    </>
  );
}

function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

/**
 * Roll up files + edges + patches + audit events into the serializable shape
 * the client island consumes. Three transforms:
 *
 *  1. Nodes: one per file, sized by sha256-derived sizeBytes, coloured by
 *     patch confidence (or null = unpatched).
 *  2. Edges: one per import row. `isTypeOnly` controls dashed rendering.
 *  3. batchOrder: walk audit_events in timestamp order, attribute each
 *     `patch_proposed` event to the open batch, and seal the batch when
 *     `patch_batch_completed` is seen. The batchId comes from the
 *     `patch_batch_completed` payload (we don't have it on `patch_proposed`).
 *     File-IDs are resolved by joining filePath against the file list.
 *
 * The ordering invariant — events come back from the repository in
 * `ORDER BY timestamp ASC` — is preserved here so the animation runs in the
 * actual Surgeon application order.
 */
function buildKgData(
  files: ReadonlyArray<{
    id: string;
    path: string;
    sizeBytes: number;
  }>,
  edges: ReadonlyArray<{
    fromFileId: string;
    toFileId: string;
    isTypeOnly: boolean;
  }>,
  patches: ReadonlyArray<{
    fileId: string;
    filePath: string;
    confidence: number;
    appliedRuleIds: string[];
  }>,
  events: ReadonlyArray<AuditEvent>,
): KgData {
  const patchByFileId = new Map<
    string,
    { confidence: number; appliedRuleIds: string[] }
  >();
  for (const p of patches) {
    // Last write wins — there's at most one patch per (jobId, fileId) by
    // the Surgeon's contract, but we don't assume that here.
    patchByFileId.set(p.fileId, {
      confidence: p.confidence,
      appliedRuleIds: p.appliedRuleIds,
    });
  }

  const fileIdByPath = new Map<string, string>();
  for (const f of files) {
    fileIdByPath.set(f.path, f.id);
  }

  const nodes = files.map((f) => {
    const patch = patchByFileId.get(f.id);
    return {
      id: f.id,
      path: f.path,
      sizeBytes: f.sizeBytes,
      patchedConfidence: patch ? patch.confidence : null,
      patchedRuleIds: patch ? patch.appliedRuleIds : [],
    };
  });

  const kgEdges = edges.map((e) => ({
    fromId: e.fromFileId,
    toId: e.toFileId,
    isTypeOnly: e.isTypeOnly,
  }));

  // Walk audit events. Accumulate filePaths from `patch_proposed` into the
  // open batch; seal the batch when `patch_batch_completed` fires. Resolve
  // filePath → fileId at seal time.
  const batches: KgData['batchOrder'] = [];
  let pending: { filePaths: string[]; timestamp: string } = {
    filePaths: [],
    timestamp: '',
  };
  for (const evt of events) {
    if (evt.agentKind !== 'surgeon') continue;
    if (evt.eventType === 'patch_proposed') {
      const payload = evt.payload as Record<string, unknown>;
      const fp = payload['filePath'];
      if (typeof fp === 'string') {
        pending.filePaths.push(fp);
        if (pending.timestamp === '') {
          pending.timestamp = evt.timestamp.toISOString();
        }
      }
    } else if (evt.eventType === 'patch_batch_completed') {
      const payload = evt.payload as Record<string, unknown>;
      const batchId =
        typeof payload['batchId'] === 'string'
          ? (payload['batchId'] as string)
          : `batch-${batches.length}`;
      const fileIds = pending.filePaths
        .map((fp) => fileIdByPath.get(fp))
        .filter((id): id is string => id !== undefined);
      if (fileIds.length > 0) {
        batches.push({
          batchId,
          fileIds,
          timestamp: evt.timestamp.toISOString(),
        });
      }
      pending = { filePaths: [], timestamp: '' };
    }
  }

  return {
    nodes,
    edges: kgEdges,
    batchOrder: batches,
  };
}
