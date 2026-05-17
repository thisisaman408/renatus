import { z } from 'zod';
import {
  AuditEventRepository,
  FileRepository,
  ImportRepository,
  JobRepository,
  KnowledgeGraphRepository,
  QaTranscriptRepository,
  SigningKeyRepository,
  SnapshotRepository,
  SymbolRepository,
} from '@renatus/db';
import { LlmRouter } from '@renatus/llm';
import { GitHubAdapter } from '../github/index.js';
import { Indexer } from '../indexer/index.js';
import { QaService } from '../qa/index.js';
import { emitAuditEvent } from '../audit-events/emit.js';
import { inngest } from './client.js';

/**
 * Inngest event payload for `renatus/qa.requested`. Q&A jobs accept a single
 * natural-language `question` and run the read-only clone → index → ask
 * pipeline. There is no `fromVersion`/`toVersion`/`ecosystem` because Q&A
 * doesn't synthesize rules.
 *
 * The `source` discriminated union encodes the W5-code-4 cached-snapshot reuse
 * path: either we clone+index a fresh repo (`kind: 'fresh'`) or we reuse an
 * existing `repo_snapshots` row from a prior job (`kind: 'cached'`) and skip
 * straight to ask. Inngest serializes step output between replays; the
 * discriminated union is plain JSON so Inngest's serializer round-trips it
 * losslessly across function restarts.
 */
export const QaRepositoryEventSchema = z.object({
  jobId: z.string().uuid(),
  question: z.string().min(1),
  // Source: EITHER a fresh repoUrl (will clone + index) OR a snapshotId from a
  // prior job (skip clone + index — reuse the cached snapshot for fast answers).
  source: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('fresh'),
      repoUrl: z.string().min(1),
      ref: z.string().optional(),
    }),
    z.object({
      kind: z.literal('cached'),
      snapshotId: z.string().uuid(),
    }),
  ]),
});

export type QaRepositoryEvent = z.infer<typeof QaRepositoryEventSchema>;

/**
 * qaRepository — production-grade Inngest workflow for the Codebase Q&A
 * agent (Wave 4). Read-only path:
 *
 *   workflow_started → resolve-snapshot → [index?] → ask → finalize
 *
 * The `ask` step calls {@link QaService.ask}, which runs the LLM with cited
 * context and signs the transcript with ed25519 (same primitives the Auditor
 * uses, shared via `auditor/sign.ts`). There is no Surgeon, no Examiner, no
 * separate Auditor — the Q&A transcript IS the signed artefact.
 *
 * Two source paths converge at `ask`:
 *   - `source.kind === 'fresh'`: clone + index a new snapshot for this job.
 *   - `source.kind === 'cached'`: reuse an existing `repo_snapshots` row from
 *     a prior job and skip clone+index entirely. The file/import/symbol rows
 *     are already populated against that snapshotId by the source job, so
 *     retrieval works as-is.
 *
 * State-machine progression on the fresh path: `cloning → cloned → indexing →
 * indexed → planning → planned → done`. On the cached path we jump straight
 * to `indexed → planning → planned → done`. We reuse the `planning`/`planned`
 * states for the answer step rather than adding new ones — the JobStateSchema
 * enum is already in production from Wave 1.
 *
 * Heavy clients (repos, adapters, LLM router) are instantiated INSIDE each
 * step.run rather than outside the function body. Inngest serializes each
 * step's output and may re-run individual steps on a fresh process — closing
 * over outer state would couple step replays to wall-clock identity, which
 * Inngest does not guarantee.
 *
 * Idempotency notes:
 *   - `resolve-snapshot`: on fresh, GitHubAdapter wipes any prior working-tree
 *     state for the same jobId before re-cloning. On cached, lookup-by-id is
 *     a pure read and can be retried freely.
 *   - `index` uses bulk insert; on duplicate-snapshot retry this surfaces as
 *     a unique-constraint failure that Inngest will keep retrying. Skipped
 *     entirely on cached so we don't double-index the source job's rows.
 *   - `ask` writes one `qa_transcripts` row per call. A retry after a
 *     successful insert will produce a second row for the same job — the
 *     `QaTranscriptRepository.getByJob` returns the first match (LIMIT 1),
 *     so downstream readers see deterministic results.
 *   - `finalize` flips job state to 'done' and is idempotent at the DB level.
 */
export const qaRepository = inngest.createFunction(
  { id: 'qa-repository', name: 'Q&A Repository', retries: 2 },
  { event: 'renatus/qa.requested' },
  async ({ event, step }) => {
    const parsed = QaRepositoryEventSchema.parse(event.data);
    const databaseUrl = requireEnv('DATABASE_URL');

    // ── 0. workflow_started ──────────────────────────────────────────────
    await step.run('workflow_started', async () => {
      const auditRepo = new AuditEventRepository(databaseUrl);
      await emitAuditEvent(auditRepo, {
        jobId: parsed.jobId,
        agentKind: 'orchestrator',
        eventType: 'workflow_started',
        payload: {
          agentKind: 'qa',
          questionLength: parsed.question.length,
          source: parsed.source.kind,
          // Logging-friendly preview so the audit chain shows whether the
          // job is a fresh clone or a cached-snapshot reuse, without
          // duplicating fields between the two source variants.
          repoUrl:
            parsed.source.kind === 'fresh' ? parsed.source.repoUrl : null,
          ref:
            parsed.source.kind === 'fresh'
              ? parsed.source.ref ?? null
              : null,
          sourceSnapshotId:
            parsed.source.kind === 'cached' ? parsed.source.snapshotId : null,
        },
      });
      return { emitted: true };
    });

    // ── 1. resolve snapshot ─────────────────────────────────────────────
    // Fresh path: clone (GitHubAdapter emits its own clone_* audit events,
    // state machine progresses cloning → cloned).
    // Cached path: look up the existing repo_snapshots row and emit a single
    // `snapshot_resolved_from_cache` event so the audit chain shows the
    // reuse explicitly. State machine progresses directly to 'indexed' so
    // the rest of the pipeline (which assumes the same shape) does not
    // branch.
    const snapshot = await step.run('resolve-snapshot', async () => {
      const jobRepo = new JobRepository(databaseUrl);
      const snapshotRepo = new SnapshotRepository(databaseUrl);
      const auditRepo = new AuditEventRepository(databaseUrl);

      if (parsed.source.kind === 'cached') {
        const existing = await snapshotRepo.getById(parsed.source.snapshotId);
        if (!existing) {
          throw new Error(
            `Snapshot ${parsed.source.snapshotId} not found — was the source job aborted or deleted?`,
          );
        }
        // No clone, no index. The downstream snapshot is byte-identical to
        // whatever the source job indexed, so the files/imports/symbols rows
        // are already in place against this snapshotId.
        await emitAuditEvent(auditRepo, {
          jobId: parsed.jobId,
          agentKind: 'orchestrator',
          eventType: 'snapshot_resolved_from_cache',
          payload: {
            snapshotId: existing.id,
            sourceJobId: existing.jobId,
            commitSha: existing.commitSha,
            repoUrl: existing.repoUrl,
            ref: existing.ref,
          },
        });
        // Skip cloning/cloned/indexing transitions — the snapshot is already
        // indexed by the source job. Land directly on 'indexed' so the ask
        // step's 'planning' transition is a valid successor.
        await jobRepo.updateState(parsed.jobId, 'indexed');
        return {
          snapshotId: existing.id,
          localPath: existing.localPath,
          commitSha: existing.commitSha,
          cached: true as const,
        };
      }

      // Fresh path: clone (index runs in the next step).
      await jobRepo.updateState(parsed.jobId, 'cloning');
      const adapter = new GitHubAdapter(snapshotRepo, auditRepo);
      const cloneResult = await adapter.clone({
        jobId: parsed.jobId,
        repoUrl: parsed.source.repoUrl,
        ref: parsed.source.ref,
      });
      await jobRepo.updateState(parsed.jobId, 'cloned');
      return {
        snapshotId: cloneResult.snapshotId,
        localPath: cloneResult.localPath,
        commitSha: cloneResult.commitSha,
        cached: false as const,
      };
    });

    // ── 2. index (only if fresh) ────────────────────────────────────────
    // On the cached path the source job already populated files/imports/
    // symbols for this snapshotId — re-indexing would duplicate rows and
    // break the unique-snapshot invariant. Skip outright.
    const indexCounts = snapshot.cached
      ? { fileCount: 0, importCount: 0, symbolCount: 0 }
      : await step.run('index', async () => {
          const jobRepo = new JobRepository(databaseUrl);
          await jobRepo.updateState(parsed.jobId, 'indexing');

          const fileRepo = new FileRepository(databaseUrl);
          const importRepo = new ImportRepository(databaseUrl);
          const symbolRepo = new SymbolRepository(databaseUrl);
          const auditRepo = new AuditEventRepository(databaseUrl);
          const indexer = new Indexer(
            fileRepo,
            importRepo,
            symbolRepo,
            auditRepo,
          );
          const result = await indexer.index({
            snapshotId: snapshot.snapshotId,
            localPath: snapshot.localPath,
            jobId: parsed.jobId,
          });

          await jobRepo.updateState(parsed.jobId, 'indexed');
          return result;
        });

    // ── 3. ask ───────────────────────────────────────────────────────────
    // QaService retrieves candidate files, calls the LLM with cited context,
    // validates the response with Zod + retry-with-feedback, enriches
    // citations with sha values from our retrieval set, signs the transcript
    // with ed25519, and persists. Reuses 'planning'/'planned' states from
    // the migrate/refactor state machine — adding new states would require
    // a Wave-1 schema change.
    const askResult = await step.run('ask', async () => {
      const jobRepo = new JobRepository(databaseUrl);
      await jobRepo.updateState(parsed.jobId, 'planning');

      const router = new LlmRouter();
      const fileRepo = new FileRepository(databaseUrl);
      const kgRepo = new KnowledgeGraphRepository(databaseUrl);
      const transcriptRepo = new QaTranscriptRepository(databaseUrl);
      const signingKeyRepo = new SigningKeyRepository(databaseUrl);
      const auditRepo = new AuditEventRepository(databaseUrl);

      const service = new QaService(
        router,
        fileRepo,
        kgRepo,
        transcriptRepo,
        signingKeyRepo,
        auditRepo,
      );

      const result = await service.ask({
        jobId: parsed.jobId,
        snapshotId: snapshot.snapshotId,
        localPath: snapshot.localPath,
        question: parsed.question,
      });

      await jobRepo.updateState(parsed.jobId, 'planned');
      return {
        transcriptId: result.transcriptId,
        citationCount: result.citations.length,
        llmProvider: result.llmProvider,
        llmLatencyMs: result.llmLatencyMs,
        signature: result.signature,
      };
    });

    // ── 4. finalize ──────────────────────────────────────────────────────
    const summary = await step.run('finalize', async () => {
      const jobRepo = new JobRepository(databaseUrl);
      const auditRepo = new AuditEventRepository(databaseUrl);

      const result = {
        jobId: parsed.jobId,
        snapshotId: snapshot.snapshotId,
        commitSha: snapshot.commitSha,
        cached: snapshot.cached,
        filesIndexed: indexCounts.fileCount,
        importsIndexed: indexCounts.importCount,
        symbolsIndexed: indexCounts.symbolCount,
        transcriptId: askResult.transcriptId,
        citationCount: askResult.citationCount,
        llmProvider: askResult.llmProvider,
        llmLatencyMs: askResult.llmLatencyMs,
        signature: askResult.signature,
      };

      await emitAuditEvent(auditRepo, {
        jobId: parsed.jobId,
        agentKind: 'orchestrator',
        eventType: 'workflow_completed',
        payload: { summary: result },
      });

      await jobRepo.markCompleted(parsed.jobId);
      return result;
    });

    return summary;
  },
);

/**
 * Tiny helper — throws with a clear message when an env var is missing.
 * Inngest will surface this as a step failure and retry per the function's
 * `retries: 2` budget.
 */
function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is required`);
  return v;
}
