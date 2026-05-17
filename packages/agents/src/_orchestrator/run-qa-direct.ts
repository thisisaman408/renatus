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
import { AuditorService } from '../auditor/index.js';
import { GitHubAdapter } from '../github/index.js';
import { Indexer } from '../indexer/index.js';
import { QaService } from '../qa/index.js';
import { emitAuditEvent } from '../audit-events/emit.js';
import { type QaRepositoryEvent } from './qa-repository.js';

/**
 * Direct (non-Inngest) pipeline runner for QA jobs.
 * Runs all steps sequentially in the same process — used when Inngest cloud
 * is not wired up (e.g. fresh Vercel deploy without the Inngest integration).
 * Called via Next.js `after()` so it runs after the 202 response is sent.
 */
export async function runQaDirect(
  parsed: QaRepositoryEvent,
  databaseUrl: string,
): Promise<void> {
  // 0. workflow_started
  {
    const auditRepo = new AuditEventRepository(databaseUrl);
    await emitAuditEvent(auditRepo, {
      jobId: parsed.jobId,
      agentKind: 'orchestrator',
      eventType: 'workflow_started',
      payload: {
        agentKind: 'qa',
        questionLength: parsed.question.length,
        source: parsed.source.kind,
        repoUrl: parsed.source.kind === 'fresh' ? parsed.source.repoUrl : null,
        ref: parsed.source.kind === 'fresh' ? (parsed.source.ref ?? null) : null,
        sourceSnapshotId:
          parsed.source.kind === 'cached' ? parsed.source.snapshotId : null,
      },
    });
  }

  const jobRepo = new JobRepository(databaseUrl);

  // 1. resolve snapshot — either clone fresh or load from cache
  let snapshotId: string;
  let localPath: string;
  let commitSha: string;
  let cached: boolean;

  if (parsed.source.kind === 'cached') {
    const snapshotRepo = new SnapshotRepository(databaseUrl);
    const existing = await snapshotRepo.getById(parsed.source.snapshotId);
    if (!existing) {
      throw new Error(
        `Snapshot ${parsed.source.snapshotId} not found — was the source job aborted or deleted?`,
      );
    }
    const auditRepo = new AuditEventRepository(databaseUrl);
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
    await jobRepo.updateState(parsed.jobId, 'indexed');
    snapshotId = existing.id;
    localPath = existing.localPath;
    commitSha = existing.commitSha;
    cached = true;
  } else {
    // Fresh path: clone
    await jobRepo.updateState(parsed.jobId, 'cloning');
    const snapshotRepo = new SnapshotRepository(databaseUrl);
    const cloneAuditRepo = new AuditEventRepository(databaseUrl);
    const adapter = new GitHubAdapter(snapshotRepo, cloneAuditRepo);
    const clone = await adapter.clone({
      jobId: parsed.jobId,
      repoUrl: parsed.source.repoUrl,
      ref: parsed.source.ref,
    });
    await jobRepo.updateState(parsed.jobId, 'cloned');

    // 2. index
    await jobRepo.updateState(parsed.jobId, 'indexing');
    const fileRepo = new FileRepository(databaseUrl);
    const importRepo = new ImportRepository(databaseUrl);
    const symbolRepo = new SymbolRepository(databaseUrl);
    const indexAuditRepo = new AuditEventRepository(databaseUrl);
    const indexer = new Indexer(fileRepo, importRepo, symbolRepo, indexAuditRepo);
    await indexer.index({
      snapshotId: clone.snapshotId,
      localPath: clone.localPath,
      jobId: parsed.jobId,
    });
    await jobRepo.updateState(parsed.jobId, 'indexed');

    snapshotId = clone.snapshotId;
    localPath = clone.localPath;
    commitSha = clone.commitSha;
    cached = false;
  }

  // 3. ask
  await jobRepo.updateState(parsed.jobId, 'planning');
  const router = new LlmRouter();
  const fileRepo = new FileRepository(databaseUrl);
  const kgRepo = new KnowledgeGraphRepository(databaseUrl);
  const transcriptRepo = new QaTranscriptRepository(databaseUrl);
  const signingKeyRepo = new SigningKeyRepository(databaseUrl);
  const askAuditRepo = new AuditEventRepository(databaseUrl);
  const qaService = new QaService(
    router,
    fileRepo,
    kgRepo,
    transcriptRepo,
    signingKeyRepo,
    askAuditRepo,
  );
  const askResult = await qaService.ask({
    jobId: parsed.jobId,
    snapshotId,
    localPath,
    question: parsed.question,
  });
  await jobRepo.updateState(parsed.jobId, 'planned');

  // 4. finalize — emit workflow_completed and mark done
  const summary = {
    jobId: parsed.jobId,
    snapshotId,
    commitSha,
    cached,
    transcriptId: askResult.transcriptId,
    citationCount: askResult.citations.length,
    llmProvider: askResult.llmProvider,
    llmLatencyMs: askResult.llmLatencyMs,
    signature: askResult.signature,
  };
  const finalAuditRepo = new AuditEventRepository(databaseUrl);
  await emitAuditEvent(finalAuditRepo, {
    jobId: parsed.jobId,
    agentKind: 'orchestrator',
    eventType: 'workflow_completed',
    payload: { summary },
  });

  // 5. audit — sign the audit-event log
  await jobRepo.updateState(parsed.jobId, 'auditing');
  const auditEventRepo = new AuditEventRepository(databaseUrl);
  const auditSigningKeyRepo = new SigningKeyRepository(databaseUrl);
  const auditor = new AuditorService(auditEventRepo, auditSigningKeyRepo);
  await auditor.audit({ jobId: parsed.jobId, snapshotId });
  await jobRepo.updateState(parsed.jobId, 'audited');
  await jobRepo.markCompleted(parsed.jobId);
}
