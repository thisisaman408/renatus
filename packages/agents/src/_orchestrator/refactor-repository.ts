import { z } from 'zod';
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
import { EcosystemSchema } from '@renatus/shared';
import { AuditorService } from '../auditor/index.js';
import { Cartographer } from '../cartographer/index.js';
import { ExaminerService } from '../examiner/index.js';
import { GitHubAdapter } from '../github/index.js';
import { Indexer } from '../indexer/index.js';
import { RetrievalService } from '../retrieval/index.js';
import { SurgeonService } from '../surgeon/index.js';
import { emitAuditEvent } from '../audit-events/emit.js';
import { inngest } from './client.js';
import { mapPatchRowToPatch } from './patch-mapper.js';

/**
 * Inngest event payload for `renatus/refactor.requested`. Mirrors the Tier-1
 * `refactor_repository` MCP tool — refactor agents are always source-driven
 * (LLM synthesizes Rule[] from a free-form natural-language intent), so there
 * is no `ruleSource` discriminator and no `fromVersion`/`toVersion`. The
 * intent string is the sole rule source.
 */
export const RefactorRepositoryEventSchema = z.object({
  jobId: z.string().uuid(),
  repoUrl: z.string().min(1),
  ref: z.string().optional(),
  ecosystem: EcosystemSchema.default('npm'),
  intent: z.string().min(1),
});

export type RefactorRepositoryEvent = z.infer<
  typeof RefactorRepositoryEventSchema
>;

/**
 * refactorRepository — production-grade Inngest workflow that drives the full
 * Renatus refactor pipeline: clone → index → cartograph → retrieve → patch
 * (fan-out) → finalize → examine → audit. Identical engine to
 * `migrateRepository`; the only differences are (a) the Cartographer always
 * runs Path B with sourceKind='refactor-intent', and (b) the surgeon +
 * examiner receive agentKind 'refactor'. Each phase is its own atomic
 * `step.run` so Inngest retries granularly on transient failures rather
 * than re-running the whole job.
 *
 * State-machine progression (seven transitions, identical to migrate):
 *   patching → patched → testing → tested → auditing → audited → done
 *
 * Idempotency notes:
 *   - `clone` wipes any prior working-tree state for the same jobId before
 *     re-cloning, so retries are safe.
 *   - `index` uses bulk insert; on duplicate-snapshot retry this surfaces as a
 *     unique-constraint failure that Inngest will keep retrying. Acceptable
 *     for Wave 2.
 *   - `cartograph` is cache-keyed; identical intent strings hit the
 *     breaking_change_maps cache and bypass the LLM entirely.
 *   - Each `patch-batch-N` step is its own retry domain — one bad batch
 *     doesn't poison the others.
 *   - `finalize` flips job state to 'patched' (intermediate, preserved for
 *     SSE subscribers) and is idempotent at the DB level.
 *   - `examine` filters to status ∈ {'proposed', 'applied'}; unresolved
 *     stubs (after===before) are skipped. `persistTests` throws on
 *     duplicate ids if retried after a successful insert — Inngest surfaces.
 *   - `audit` uses get-or-create keypair, so retries re-sign deterministically.
 *
 * Heavy clients (repos, adapters, LLM router) are instantiated INSIDE each
 * step.run rather than outside the function body. Inngest serializes each
 * step's output and may re-run individual steps on a fresh process — closing
 * over outer state would couple step replays to wall-clock identity, which
 * Inngest does not guarantee.
 */
export const refactorRepository = inngest.createFunction(
  { id: 'refactor-repository', name: 'Refactor Repository', retries: 2 },
  { event: 'renatus/refactor.requested' },
  async ({ event, step }) => {
    const parsed = RefactorRepositoryEventSchema.parse(event.data);
    const databaseUrl = requireEnv('DATABASE_URL');

    // ── 0. workflow_started ──────────────────────────────────────────────
    await step.run('workflow_started', async () => {
      const auditRepo = new AuditEventRepository(databaseUrl);
      await emitAuditEvent(auditRepo, {
        jobId: parsed.jobId,
        agentKind: 'orchestrator',
        eventType: 'workflow_started',
        payload: {
          repoUrl: parsed.repoUrl,
          ref: parsed.ref,
          ecosystem: parsed.ecosystem,
          agentKind: 'refactor',
          intent: parsed.intent,
        },
      });
      return { emitted: true };
    });

    // ── 1. clone ─────────────────────────────────────────────────────────
    const clone = await step.run('clone', async () => {
      const jobRepo = new JobRepository(databaseUrl);
      await jobRepo.updateState(parsed.jobId, 'cloning');

      const snapshotRepo = new SnapshotRepository(databaseUrl);
      const auditRepo = new AuditEventRepository(databaseUrl);
      const adapter = new GitHubAdapter(snapshotRepo, auditRepo);
      const result = await adapter.clone({
        jobId: parsed.jobId,
        repoUrl: parsed.repoUrl,
        ref: parsed.ref,
      });

      await jobRepo.updateState(parsed.jobId, 'cloned');
      return result;
    });

    // ── 2. index ─────────────────────────────────────────────────────────
    const index = await step.run('index', async () => {
      const jobRepo = new JobRepository(databaseUrl);
      await jobRepo.updateState(parsed.jobId, 'indexing');

      const fileRepo = new FileRepository(databaseUrl);
      const importRepo = new ImportRepository(databaseUrl);
      const symbolRepo = new SymbolRepository(databaseUrl);
      const auditRepo = new AuditEventRepository(databaseUrl);
      const indexer = new Indexer(fileRepo, importRepo, symbolRepo, auditRepo);
      const result = await indexer.index({
        snapshotId: clone.snapshotId,
        localPath: clone.localPath,
        jobId: parsed.jobId,
      });

      await jobRepo.updateState(parsed.jobId, 'indexed');
      return result;
    });

    // ── 3. cartograph ────────────────────────────────────────────────────
    // Refactor always uses Path B (planFromSource) with
    // sourceKind='refactor-intent'. There is no bundled-pack branch — the
    // intent is the spec.
    const plan = await step.run('cartograph', async () => {
      const jobRepo = new JobRepository(databaseUrl);
      await jobRepo.updateState(parsed.jobId, 'planning');

      const router = new LlmRouter();
      const cacheRepo = new BreakingChangeMapRepository(databaseUrl);
      const auditRepo = new AuditEventRepository(databaseUrl);
      const cartographer = new Cartographer(router, cacheRepo, auditRepo);

      const planResult = await cartographer.planFromSource({
        agentKind: 'refactor',
        sourceKind: 'refactor-intent',
        sourceText: parsed.intent,
        ecosystem: parsed.ecosystem,
        jobId: parsed.jobId,
      });

      await jobRepo.updateState(parsed.jobId, 'planned');
      return planResult;
    });

    // ── 4. retrieve ──────────────────────────────────────────────────────
    const retrieval = await step.run('retrieve', async () => {
      const fileRepo = new FileRepository(databaseUrl);
      const kgRepo = new KnowledgeGraphRepository(databaseUrl);
      const auditRepo = new AuditEventRepository(databaseUrl);
      const service = new RetrievalService(fileRepo, kgRepo, auditRepo);
      return service.retrieve({
        snapshotId: clone.snapshotId,
        localPath: clone.localPath,
        rules: plan.rules,
        jobId: parsed.jobId,
      });
    });

    // ── 5. patch (fan-out per batch) ─────────────────────────────────────
    // Inngest pattern: parallel `step.run` via Promise.all. Each step is its
    // own retry boundary, so a flaky LLM call on one batch doesn't roll back
    // already-persisted patches from another.
    await step.run('mark-patching', async () => {
      const jobRepo = new JobRepository(databaseUrl);
      await jobRepo.updateState(parsed.jobId, 'patching');
    });

    const batchResults = await Promise.all(
      retrieval.batches.map((batch, idx) =>
        step.run(`patch-batch-${idx}`, async () => {
          const router = new LlmRouter();
          const patchRepo = new PatchRepository(databaseUrl);
          const auditRepo = new AuditEventRepository(databaseUrl);
          const surgeon = new SurgeonService(router, patchRepo, auditRepo);
          const rulesForBatch = plan.rules.filter((r) =>
            batch.ruleIds.includes(r.id),
          );
          const result = await surgeon.migrateBatch({
            jobId: parsed.jobId,
            batch,
            rules: rulesForBatch,
            agentKind: 'refactor',
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
      ),
    );

    // ── 6. finalize ──────────────────────────────────────────────────────
    const summary = await step.run('finalize', async () => {
      const jobRepo = new JobRepository(databaseUrl);
      const auditRepo = new AuditEventRepository(databaseUrl);
      const totalPatches = batchResults.reduce((s, b) => s + b.patchCount, 0);
      const totalUnresolved = batchResults.reduce(
        (s, b) => s + b.unresolvedFileCount,
        0,
      );
      await jobRepo.updateState(parsed.jobId, 'patched');
      const result = {
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
      await emitAuditEvent(auditRepo, {
        jobId: parsed.jobId,
        agentKind: 'orchestrator',
        eventType: 'workflow_completed',
        payload: { summary: result },
      });
      return result;
    });

    // ── 7. examine ──────────────────────────────────────────────────────
    // Generate regression tests. Pre-filter to status ∈ {'proposed', 'applied'}
    // so unresolved stubs don't produce vacuous tests. Refactor workflows
    // always run the Examiner with agentKind='refactor', which picks the
    // 'snapshot' test strategy.
    const examineResult = await step.run('examine', async () => {
      const jobRepo = new JobRepository(databaseUrl);
      await jobRepo.updateState(parsed.jobId, 'testing');

      const patchRepo = new PatchRepository(databaseUrl);
      const allPatches = await patchRepo.getByJob(parsed.jobId);
      const candidatePatches = allPatches.filter(
        (p) => p.status === 'proposed' || p.status === 'applied',
      );

      if (candidatePatches.length === 0) {
        await jobRepo.updateState(parsed.jobId, 'tested');
        return {
          testCount: 0,
          errorCount: 0,
          framework: 'unknown' as const,
          llmAttempts: 0,
          llmLatencyMs: 0,
          llmProvider: 'none',
        };
      }

      const router = new LlmRouter();
      const testRepo = new TestRepository(databaseUrl);
      const auditRepo = new AuditEventRepository(databaseUrl);
      const examiner = new ExaminerService(router, testRepo, auditRepo);

      const result = await examiner.examineBatch({
        jobId: parsed.jobId,
        snapshotId: clone.snapshotId,
        localPath: clone.localPath,
        patches: candidatePatches.map(mapPatchRowToPatch),
        agentKind: 'refactor',
      });

      if (result.tests.length > 0) {
        await examiner.persistTests(result.tests);
      }

      await jobRepo.updateState(parsed.jobId, 'tested');
      return {
        testCount: result.tests.length,
        errorCount: result.errors.length,
        framework: result.framework,
        llmAttempts: result.llmAttempts,
        llmLatencyMs: result.llmLatencyMs,
        llmProvider: result.llmProvider,
      };
    });

    // ── 8. audit ────────────────────────────────────────────────────────
    // Cryptographically sign the audit-event log. Empty audits are valid.
    // get-or-create keypair makes retries idempotent.
    const auditResult = await step.run('audit', async () => {
      const jobRepo = new JobRepository(databaseUrl);
      await jobRepo.updateState(parsed.jobId, 'auditing');

      const auditEventRepo = new AuditEventRepository(databaseUrl);
      const signingKeyRepo = new SigningKeyRepository(databaseUrl);
      const auditor = new AuditorService(auditEventRepo, signingKeyRepo);

      const result = await auditor.audit({
        jobId: parsed.jobId,
        snapshotId: clone.snapshotId,
      });

      await jobRepo.updateState(parsed.jobId, 'audited');
      await jobRepo.markCompleted(parsed.jobId);

      return {
        signature: result.signature,
        auditUrl: result.auditUrl,
        summaryTotalEvents: result.auditReport.summary.totalEvents,
      };
    });

    return {
      ...summary,
      testCount: examineResult.testCount,
      framework: examineResult.framework,
      signature: auditResult.signature,
      auditUrl: auditResult.auditUrl,
    };
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

// Made with Bob
