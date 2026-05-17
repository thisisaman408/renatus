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
 * Inngest event payload for `renatus/security-audit.requested`. Security audit
 * agents accept either a CVE id (fetched from NVD) or raw advisory text. The
 * Cartographer runs Path B with sourceKind='cve-advisory' to synthesize
 * MitigationRule[] from the advisory content.
 */
export const SecurityAuditRepositoryEventSchema = z.object({
  jobId: z.string().uuid(),
  repoUrl: z.string().min(1),
  ref: z.string().optional(),
  ecosystem: EcosystemSchema.default('npm'),
  // Either a CVE id (we fetch from NVD) OR raw advisory text. NOT both.
  cveSource: z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('cve-id'), cveId: z.string().regex(/^CVE-\d{4}-\d+$/i) }),
    z.object({ kind: z.literal('advisory-text'), advisoryText: z.string().min(1) }),
  ]),
});

export type SecurityAuditRepositoryEvent = z.infer<
  typeof SecurityAuditRepositoryEventSchema
>;

/**
 * securityAuditRepository — production-grade Inngest workflow that drives the
 * full Renatus security audit pipeline: clone → index → cartograph → retrieve
 * → patch (fan-out) → finalize → examine → audit. Identical engine to
 * `migrateRepository` and `refactorRepository`; the only differences are (a)
 * the Cartographer always runs Path B with sourceKind='cve-advisory', (b) the
 * surgeon + examiner receive agentKind 'security_audit', and (c) the CVE id
 * resolution step fetches advisory text from NVD when cveSource.kind='cve-id'.
 *
 * State-machine progression (seven transitions, identical to migrate/refactor):
 *   patching → patched → testing → tested → auditing → audited → done
 *
 * Idempotency notes:
 *   - `clone` wipes any prior working-tree state for the same jobId before
 *     re-cloning, so retries are safe.
 *   - `index` uses bulk insert; on duplicate-snapshot retry this surfaces as a
 *     unique-constraint failure that Inngest will keep retrying. Acceptable
 *     for Wave 4.
 *   - `cartograph` is cache-keyed; identical advisory strings hit the
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
export const securityAuditRepository = inngest.createFunction(
  { id: 'security-audit-repository', name: 'Security Audit Repository', retries: 2 },
  { event: 'renatus/security-audit.requested' },
  async ({ event, step }) => {
    const parsed = SecurityAuditRepositoryEventSchema.parse(event.data);
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
          agentKind: 'security_audit',
          cveSource: parsed.cveSource,
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
    // Security audit always uses Path B (planFromSource) with
    // sourceKind='cve-advisory'. If cveSource.kind='cve-id', fetch the
    // advisory from NVD first. The fetch happens INSIDE this step.run so
    // Inngest retries the network call on failure.
    const plan = await step.run('cartograph', async () => {
      const jobRepo = new JobRepository(databaseUrl);
      await jobRepo.updateState(parsed.jobId, 'planning');

      let advisoryText: string;
      if (parsed.cveSource.kind === 'cve-id') {
        advisoryText = await fetchNvdAdvisory(parsed.cveSource.cveId);
      } else {
        advisoryText = parsed.cveSource.advisoryText;
      }

      const router = new LlmRouter();
      const cacheRepo = new BreakingChangeMapRepository(databaseUrl);
      const auditRepo = new AuditEventRepository(databaseUrl);
      const cartographer = new Cartographer(router, cacheRepo, auditRepo);

      const planResult = await cartographer.planFromSource({
        agentKind: 'security_audit',
        sourceKind: 'cve-advisory',
        sourceText: advisoryText,
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
            agentKind: 'security_audit',
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
    // so unresolved stubs don't produce vacuous tests. Security audit workflows
    // always run the Examiner with agentKind='security_audit', which picks the
    // 'cve-replay' test strategy.
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
        agentKind: 'security_audit',
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
 * Fetch a CVE advisory from NVD's public API. Throws on network failure or
 * non-200 response. The error is loud so Inngest's retry budget handles
 * transient failures.
 */
async function fetchNvdAdvisory(cveId: string): Promise<string> {
  const url = `https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=${cveId}`;
  
  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new SecurityAuditAdvisoryFetchError(
      `Network error fetching CVE ${cveId} from NVD: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!response.ok) {
    throw new SecurityAuditAdvisoryFetchError(
      `NVD API returned ${response.status} for CVE ${cveId}`,
    );
  }

  let data: any; // rationale: NVD API response shape is not typed; validated below
  try {
    data = await response.json();
  } catch (error) {
    throw new SecurityAuditAdvisoryFetchError(
      `Failed to parse NVD response for CVE ${cveId}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  // Extract the English description from the NVD response
  const vulnerabilities = data?.vulnerabilities;
  if (!Array.isArray(vulnerabilities) || vulnerabilities.length === 0) {
    throw new SecurityAuditAdvisoryFetchError(
      `No vulnerabilities found in NVD response for CVE ${cveId}`,
    );
  }

  const cve = vulnerabilities[0]?.cve;
  if (!cve) {
    throw new SecurityAuditAdvisoryFetchError(
      `Malformed NVD response for CVE ${cveId}: missing cve object`,
    );
  }

  const descriptions = cve.descriptions;
  if (!Array.isArray(descriptions)) {
    throw new SecurityAuditAdvisoryFetchError(
      `Malformed NVD response for CVE ${cveId}: missing descriptions array`,
    );
  }

  const englishDesc = descriptions.find((d: any) => d.lang === 'en'); // rationale: NVD API response shape is not typed
  if (!englishDesc?.value) {
    throw new SecurityAuditAdvisoryFetchError(
      `No English description found in NVD response for CVE ${cveId}`,
    );
  }

  // Build a comprehensive advisory text block
  const parts: string[] = [];
  parts.push(`CVE ID: ${cveId}`);
  parts.push(`\nDescription: ${englishDesc.value}`);

  // Add CVSS score if available
  const metrics = cve.metrics;
  if (metrics) {
    const cvssV3 = metrics.cvssMetricV31?.[0]?.cvssData;
    const cvssV2 = metrics.cvssMetricV2?.[0]?.cvssData;
    if (cvssV3) {
      parts.push(`\nCVSS v3.1 Score: ${cvssV3.baseScore} (${cvssV3.baseSeverity})`);
    } else if (cvssV2) {
      parts.push(`\nCVSS v2.0 Score: ${cvssV2.baseScore}`);
    }
  }

  // Add CWE list if available
  const weaknesses = cve.weaknesses;
  if (Array.isArray(weaknesses) && weaknesses.length > 0) {
    const cweIds = weaknesses
      .flatMap((w: any) => w.description || []) // rationale: NVD API response shape is not typed
      .filter((d: any) => d.lang === 'en') // rationale: NVD API response shape is not typed
      .map((d: any) => d.value) // rationale: NVD API response shape is not typed
      .filter(Boolean);
    if (cweIds.length > 0) {
      parts.push(`\nCWE: ${cweIds.join(', ')}`);
    }
  }

  // Add references if available
  const references = cve.references;
  if (Array.isArray(references) && references.length > 0) {
    parts.push('\nReferences:');
    references.slice(0, 5).forEach((ref: any) => { // rationale: NVD API response shape is not typed
      if (ref.url) {
        parts.push(`  - ${ref.url}`);
      }
    });
  }

  return parts.join('\n');
}

/**
 * Error thrown when NVD advisory fetch fails. Inngest will retry per the
 * function's `retries: 2` budget.
 */
class SecurityAuditAdvisoryFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecurityAuditAdvisoryFetchError';
  }
}

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