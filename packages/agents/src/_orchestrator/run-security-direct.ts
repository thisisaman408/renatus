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
import { type SecurityAuditRepositoryEvent } from './security-audit-repository.js';

/**
 * Direct (non-Inngest) pipeline runner for security audit jobs.
 * Runs all steps sequentially in the same process — used when Inngest cloud
 * is not wired up (e.g. fresh Vercel deploy without the Inngest integration).
 * Called via Next.js `after()` so it runs after the 202 response is sent.
 */
export async function runSecurityDirect(
  parsed: SecurityAuditRepositoryEvent,
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
        agentKind: 'security_audit',
        cveSource: parsed.cveSource,
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

  // 3. cartograph — resolve advisory text then planFromSource with sourceKind='cve-advisory'
  await jobRepo.updateState(parsed.jobId, 'planning');
  let advisoryText: string;
  if (parsed.cveSource.kind === 'cve-id') {
    advisoryText = await fetchNvdAdvisory(parsed.cveSource.cveId);
  } else {
    advisoryText = parsed.cveSource.advisoryText;
  }
  const router = new LlmRouter();
  const cacheRepo = new BreakingChangeMapRepository(databaseUrl);
  const cartAuditRepo = new AuditEventRepository(databaseUrl);
  const cartographer = new Cartographer(router, cacheRepo, cartAuditRepo);
  const plan = await cartographer.planFromSource({
    agentKind: 'security_audit',
    sourceKind: 'cve-advisory',
    sourceText: advisoryText,
    ecosystem: parsed.ecosystem,
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
      agentKind: 'security_audit',
    });
    if (examResult.tests.length > 0) {
      await examiner.persistTests(examResult.tests);
    }
  }
  await jobRepo.updateState(parsed.jobId, 'tested');

  // 8. audit
  await jobRepo.updateState(parsed.jobId, 'auditing');
  const auditEventRepo = new AuditEventRepository(databaseUrl);
  const signingKeyRepo = new SigningKeyRepository(databaseUrl);
  const auditor = new AuditorService(auditEventRepo, signingKeyRepo);
  await auditor.audit({ jobId: parsed.jobId, snapshotId: clone.snapshotId });
  await jobRepo.updateState(parsed.jobId, 'audited');
  await jobRepo.markCompleted(parsed.jobId);
}

/**
 * Fetch a CVE advisory from NVD's public API. Throws on network failure or
 * non-200 response.
 */
async function fetchNvdAdvisory(cveId: string): Promise<string> {
  const url = `https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=${cveId}`;

  let response: Response;
  try {
    response = await fetch(url);
  } catch (error) {
    throw new Error(
      `Network error fetching CVE ${cveId} from NVD: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  if (!response.ok) {
    throw new Error(`NVD API returned ${response.status} for CVE ${cveId}`);
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let data: any;
  try {
    data = await response.json();
  } catch (error) {
    throw new Error(
      `Failed to parse NVD response for CVE ${cveId}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  const vulnerabilities = data?.vulnerabilities;
  if (!Array.isArray(vulnerabilities) || vulnerabilities.length === 0) {
    throw new Error(`No vulnerabilities found in NVD response for CVE ${cveId}`);
  }

  const cve = vulnerabilities[0]?.cve;
  if (!cve) {
    throw new Error(`Malformed NVD response for CVE ${cveId}: missing cve object`);
  }

  const descriptions = cve.descriptions;
  if (!Array.isArray(descriptions)) {
    throw new Error(
      `Malformed NVD response for CVE ${cveId}: missing descriptions array`,
    );
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const englishDesc = descriptions.find((d: any) => d.lang === 'en');
  if (!englishDesc?.value) {
    throw new Error(`No English description found in NVD response for CVE ${cveId}`);
  }

  const parts: string[] = [];
  parts.push(`CVE ID: ${cveId}`);
  parts.push(`\nDescription: ${englishDesc.value}`);

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

  const weaknesses = cve.weaknesses;
  if (Array.isArray(weaknesses) && weaknesses.length > 0) {
    const cweIds = weaknesses
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .flatMap((w: any) => w.description || [])
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((d: any) => d.lang === 'en')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((d: any) => d.value)
      .filter(Boolean);
    if (cweIds.length > 0) {
      parts.push(`\nCWE: ${cweIds.join(', ')}`);
    }
  }

  const references = cve.references;
  if (Array.isArray(references) && references.length > 0) {
    parts.push('\nReferences:');
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    references.slice(0, 5).forEach((ref: any) => {
      if (ref.url) {
        parts.push(`  - ${ref.url}`);
      }
    });
  }

  return parts.join('\n');
}
