import {
  AuditEventRepository,
  BreakingChangeMapRepository,
  FileRepository,
  ImportRepository,
  JobRepository,
  KnowledgeGraphRepository,
  PatchRepository,
  SigningKeyRepository,
  SnapshotRepository,
  SymbolRepository,
  TestRepository,
} from '@renatus/db';
import { LlmRouter } from '@renatus/llm';
import { AuditorService } from '../auditor/index.js';
import { Cartographer } from '../cartographer/index.js';
import { ExaminerService } from '../examiner/index.js';
import { GitHubAdapter } from '../github/index.js';
import { Indexer } from '../indexer/index.js';
import { RetrievalService } from '../retrieval/index.js';
import { SurgeonService } from '../surgeon/index.js';
import { emitAuditEvent } from '../audit-events/emit.js';
import { mapPatchRowToPatch } from './patch-mapper.js';
import { type MigrateRepositoryEvent } from './migrate-repository.js';

/**
 * Direct (non-Inngest) pipeline runner for migrate jobs.
 * Runs all steps sequentially in the same process — used when Inngest cloud
 * is not wired up (e.g. fresh Vercel deploy without the Inngest integration).
 * Called via Next.js `after()` so it runs after the 202 response is sent.
 */
export async function runMigrateDirect(
  parsed: MigrateRepositoryEvent,
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
        repoUrl: parsed.repoUrl,
        ref: parsed.ref,
        ecosystem: parsed.ecosystem,
        fromVersion: parsed.fromVersion,
        toVersion: parsed.toVersion,
        agentKind: parsed.agentKind,
        ruleSource: parsed.ruleSource.kind,
      },
    });
  }

  // 1. clone
  const jobRepo = new JobRepository(databaseUrl);
  await jobRepo.updateState(parsed.jobId, 'cloning');
  const snapshotRepo = new SnapshotRepository(databaseUrl);
  const cloneAuditRepo = new AuditEventRepository(databaseUrl);
  const adapter = new GitHubAdapter(snapshotRepo, cloneAuditRepo);
  const clone = await adapter.clone({
    jobId: parsed.jobId,
    repoUrl: parsed.repoUrl,
    ref: parsed.ref,
  });
  await jobRepo.updateState(parsed.jobId, 'cloned');

  // 2. index
  await jobRepo.updateState(parsed.jobId, 'indexing');
  const fileRepo = new FileRepository(databaseUrl);
  const importRepo = new ImportRepository(databaseUrl);
  const symbolRepo = new SymbolRepository(databaseUrl);
  const indexAuditRepo = new AuditEventRepository(databaseUrl);
  const indexer = new Indexer(fileRepo, importRepo, symbolRepo, indexAuditRepo);
  const index = await indexer.index({
    snapshotId: clone.snapshotId,
    localPath: clone.localPath,
    jobId: parsed.jobId,
  });
  await jobRepo.updateState(parsed.jobId, 'indexed');

  // 3. cartograph
  await jobRepo.updateState(parsed.jobId, 'planning');
  const router = new LlmRouter();
  const cacheRepo = new BreakingChangeMapRepository(databaseUrl);
  const cartAuditRepo = new AuditEventRepository(databaseUrl);
  const cartographer = new Cartographer(router, cacheRepo, cartAuditRepo);
  const plan =
    parsed.ruleSource.kind === 'pack'
      ? await cartographer.planFromPack({
          agentKind: parsed.agentKind,
          ecosystem: parsed.ecosystem,
          fromVersion: parsed.fromVersion,
          toVersion: parsed.toVersion,
          jobId: parsed.jobId,
        })
      : await cartographer.planFromSource({
          agentKind: parsed.agentKind,
          sourceKind: parsed.ruleSource.kind,
          sourceText: parsed.ruleSource.sourceText,
          ecosystem: parsed.ecosystem,
          fromVersion: parsed.fromVersion,
          toVersion: parsed.toVersion,
          jobId: parsed.jobId,
        });
  await jobRepo.updateState(parsed.jobId, 'planned');

  // 4. retrieve
  const retFileRepo = new FileRepository(databaseUrl);
  const kgRepo = new KnowledgeGraphRepository(databaseUrl);
  const retAuditRepo = new AuditEventRepository(databaseUrl);
  const retrieval_svc = new RetrievalService(retFileRepo, kgRepo, retAuditRepo);
  const retrieval = await retrieval_svc.retrieve({
    snapshotId: clone.snapshotId,
    localPath: clone.localPath,
    rules: plan.rules,
    jobId: parsed.jobId,
  });

  // 5. patch
  await jobRepo.updateState(parsed.jobId, 'patching');
  const batchResults = await Promise.all(
    retrieval.batches.map(async (batch) => {
      const batchRouter = new LlmRouter();
      const patchRepo = new PatchRepository(databaseUrl);
      const patchAuditRepo = new AuditEventRepository(databaseUrl);
      const surgeon = new SurgeonService(batchRouter, patchRepo, patchAuditRepo);
      const rulesForBatch = plan.rules.filter((r) => batch.ruleIds.includes(r.id));
      const result = await surgeon.migrateBatch({
        jobId: parsed.jobId,
        batch,
        rules: rulesForBatch,
        agentKind: parsed.agentKind,
      });
      if (result.patches.length > 0) {
        await surgeon.persistPatches(result.patches);
      }
      return {
        batchId: batch.id,
        patchCount: result.patches.length,
        unresolvedFileCount: result.unresolvedFileIds.length,
        llmAttempts: result.llmAttempts,
        llmLatencyMs: result.llmLatencyMs,
        llmProvider: result.llmProvider,
      };
    }),
  );

  // 6. finalize
  const totalPatches = batchResults.reduce((s, b) => s + b.patchCount, 0);
  const totalUnresolved = batchResults.reduce((s, b) => s + b.unresolvedFileCount, 0);
  await jobRepo.updateState(parsed.jobId, 'patched');
  const summary = {
    jobId: parsed.jobId,
    snapshotId: clone.snapshotId,
    commitSha: clone.commitSha,
    filesIndexed: index.fileCount,
    importsIndexed: index.importCount,
    symbolsIndexed: index.symbolCount,
    rulesPlanned: plan.rules.length,
    cartographerCached: plan.cached,
    cartographerSource: plan.sourceKind,
    batchCount: retrieval.batches.length,
    patchCount: totalPatches,
    unresolvedFileCount: totalUnresolved,
    unmatchedRuleIds: retrieval.unmatchedRuleIds,
  };
  const finalAuditRepo = new AuditEventRepository(databaseUrl);
  await emitAuditEvent(finalAuditRepo, {
    jobId: parsed.jobId,
    agentKind: 'orchestrator',
    eventType: 'workflow_completed',
    payload: { summary },
  });

  // 7. examine
  await jobRepo.updateState(parsed.jobId, 'testing');
  const examPatchRepo = new PatchRepository(databaseUrl);
  const allPatches = await examPatchRepo.getByJob(parsed.jobId);
  const candidatePatches = allPatches.filter(
    (p) => p.status === 'proposed' || p.status === 'applied',
  );
  if (candidatePatches.length > 0) {
    const examRouter = new LlmRouter();
    const testRepo = new TestRepository(databaseUrl);
    const examAuditRepo = new AuditEventRepository(databaseUrl);
    const examiner = new ExaminerService(examRouter, testRepo, examAuditRepo);
    const examResult = await examiner.examineBatch({
      jobId: parsed.jobId,
      snapshotId: clone.snapshotId,
      localPath: clone.localPath,
      patches: candidatePatches.map(mapPatchRowToPatch),
      agentKind: parsed.agentKind,
    });
    if (examResult.tests.length > 0) {
      await examiner.persistTests(examResult.tests);
    }
  }
  await jobRepo.updateState(parsed.jobId, 'tested');

  // 8. audit
  await jobRepo.updateState(parsed.jobId, 'auditing');
  const auditEventRepo2 = new AuditEventRepository(databaseUrl);
  const signingKeyRepo = new SigningKeyRepository(databaseUrl);
  const auditor = new AuditorService(auditEventRepo2, signingKeyRepo);
  await auditor.audit({ jobId: parsed.jobId, snapshotId: clone.snapshotId });
  await jobRepo.updateState(parsed.jobId, 'audited');
  await jobRepo.markCompleted(parsed.jobId);
}
