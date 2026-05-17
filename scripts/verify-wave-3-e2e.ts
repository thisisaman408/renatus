#!/usr/bin/env tsx
/**
 * Wave 3 end-to-end verifier — runs the full migrate pipeline against the
 * fixture, then exercises Examiner + Auditor + signature roundtrip, then
 * asserts the Wave 3 tables (audit_events, generated_tests, signing_keys)
 * actually received rows.
 *
 * Requires DATABASE_URL + GROQ_API_KEY. If either is missing, prints
 * SKIPPED and exits 0 (matches Wave 2 e2e convention so a fresh checkout
 * doesn't blow up).
 *
 * Pipeline (mirrors the Inngest migrate_workflow, in-process):
 *   GitHubAdapter.clone  →  Indexer.index  →  Cartographer.planFromPack
 *   →  RetrievalService.retrieve  →  SurgeonService.migrateBatch
 *   →  ExaminerService.examineBatch  →  AuditorService.audit
 *   →  AuditorService.verifySignature
 *   →  assert audit_events.count >= 1 ∧ generated_tests.count >= 0
 *      ∧ signing_keys[jobId] exists
 *
 * Run via `pnpm verify:wave-3:e2e`.
 */
import "./_load-env.js"; // must be first — populates process.env from .env
import { randomUUID } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  AuditorService,
  Cartographer,
  ExaminerService,
  GitHubAdapter,
  Indexer,
  RetrievalService,
  SurgeonService,
} from "@renatus/agents";
import {
  AuditEventRepository,
  BreakingChangeMapRepository,
  FileRepository,
  ImportRepository,
  JobRepository,
  KnowledgeGraphRepository,
  McpSessionRepository,
  PatchRepository,
  SigningKeyRepository,
  SnapshotRepository,
  SymbolRepository,
  TestRepository,
} from "@renatus/db";
import { LlmRouter } from "@renatus/llm";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const FIXTURE_ROOT = path.join(REPO_ROOT, "test-repos", "fixture-react-18");

function requireEnv(name: string): string | null {
  const v = process.env[name];
  if (!v || v.length === 0) {
    console.log(`SKIPPED: ${name} not set — wave-3 e2e cannot run.`);
    console.log("Set the env var and re-run with `pnpm verify:wave-3:e2e`.");
    return null;
  }
  return v;
}

async function main(): Promise<void> {
  const databaseUrl = requireEnv("DATABASE_URL");
  if (!databaseUrl) {
    process.exit(0);
  }
  // Accept ANY configured LLM provider — the LlmRouter picks per its own
  // priority (watsonx > Gemini > Groq). Forcing GROQ_API_KEY here was a
  // pre-multi-provider artifact.
  const hasAnyLlmKey =
    !!process.env.GROQ_API_KEY ||
    !!process.env.GEMINI_API_KEY ||
    (!!process.env.WATSONX_API_KEY && !!process.env.WATSONX_PROJECT_ID) ||
    (!!process.env.VERCEL_AI_GATEWAY_URL && !!process.env.VERCEL_AI_GATEWAY_API_KEY);
  if (!hasAnyLlmKey) {
    console.log(
      "SKIPPED: no LLM provider configured (set one of GROQ_API_KEY, GEMINI_API_KEY, WATSONX_API_KEY+WATSONX_PROJECT_ID, or VERCEL_AI_GATEWAY_URL+VERCEL_AI_GATEWAY_API_KEY).",
    );
    process.exit(0);
  }

  console.log("Renatus Wave 3 — end-to-end verification");
  console.log(`Fixture: ${FIXTURE_ROOT}\n`);

  const fixtureUrl = `file://${FIXTURE_ROOT}`;

  // 0. Session + job. The migrate_repository tool creates these in
  //    production; bypassing MCP keeps the verifier in-process.
  const sessionRepo = new McpSessionRepository(databaseUrl);
  const session = await sessionRepo.upsertSession(
    `verify-wave3-${randomUUID()}`,
    "stdio",
  );
  if (!session) {
    throw new Error("McpSessionRepository.upsertSession returned undefined");
  }

  const jobRepo = new JobRepository(databaseUrl);
  const job = await jobRepo.create({
    sessionId: session.id,
    repoUrl: fixtureUrl,
    sourceVersion: "18.0.0",
    targetVersion: "19.0.0",
    ecosystem: "npm",
    agentKind: "migrate",
  });
  console.log(`[step 0] jobId=${job.id}`);

  // Wire audit-event repo through every agent — that's what produces
  // the audit_events rows the Auditor later signs.
  const auditEventRepo = new AuditEventRepository(databaseUrl);

  // 1. Clone.
  const snapshotRepo = new SnapshotRepository(databaseUrl);
  const adapter = new GitHubAdapter(snapshotRepo, auditEventRepo);
  const clone = await adapter.clone({ jobId: job.id, repoUrl: fixtureUrl });
  console.log(
    `[step 1] snapshotId=${clone.snapshotId} sha=${clone.commitSha} files=${clone.filesCount}`,
  );

  // 2. Index.
  const fileRepo = new FileRepository(databaseUrl);
  const importRepo = new ImportRepository(databaseUrl);
  const symbolRepo = new SymbolRepository(databaseUrl);
  const indexer = new Indexer(fileRepo, importRepo, symbolRepo, auditEventRepo);
  const index = await indexer.index({
    jobId: job.id,
    snapshotId: clone.snapshotId,
    localPath: clone.localPath,
  });
  console.log(
    `[step 2] files=${index.fileCount} imports=${index.importCount} symbols=${index.symbolCount}`,
  );

  // 3. Cartograph (Path A — bundled pack).
  const cacheRepo = new BreakingChangeMapRepository(databaseUrl);
  const router = new LlmRouter();
  const cartographer = new Cartographer(router, cacheRepo, auditEventRepo);
  const plan = await cartographer.planFromPack({
    agentKind: "migrate",
    ecosystem: "npm",
    fromVersion: "18.0.0",
    toVersion: "19.0.0",
    jobId: job.id,
  });
  console.log(
    `[step 3] planned ${plan.rules.length} rules (cached=${plan.cached})`,
  );

  // 4. Retrieve.
  const kgRepo = new KnowledgeGraphRepository(databaseUrl);
  const retrievalSvc = new RetrievalService(fileRepo, kgRepo, auditEventRepo);
  const retrieval = await retrievalSvc.retrieve({
    jobId: job.id,
    snapshotId: clone.snapshotId,
    localPath: clone.localPath,
    rules: plan.rules,
  });
  console.log(
    `[step 4] batches=${retrieval.batches.length} unmatchedFiles=${retrieval.unmatchedFileCount} unmatchedRules=${retrieval.unmatchedRuleIds.length}`,
  );
  const firstBatch = retrieval.batches[0];
  if (!firstBatch) {
    console.error("FAIL: retrieval produced zero batches against the fixture");
    process.exit(1);
  }

  // 5. Surgeon.
  const patchRepo = new PatchRepository(databaseUrl);
  const surgeon = new SurgeonService(router, patchRepo, auditEventRepo);
  const batchRules = plan.rules.filter((r) =>
    firstBatch.ruleIds.includes(r.id),
  );
  const surgeonResult = await surgeon.migrateBatch({
    jobId: job.id,
    batch: firstBatch,
    rules: batchRules,
    agentKind: "migrate",
  });
  if (surgeonResult.patches.length > 0) {
    await surgeon.persistPatches(surgeonResult.patches);
  }
  console.log(
    `[step 5] patches=${surgeonResult.patches.length} unresolved=${surgeonResult.unresolvedFileIds.length}`,
  );

  const proposedPatches = surgeonResult.patches.filter(
    (p) => p.status === "proposed",
  );
  if (
    proposedPatches.length === 0 &&
    surgeonResult.unresolvedFileIds.length === firstBatch.files.length
  ) {
    console.error("\nFAIL: zero proposed patches and all files unresolved");
    process.exit(1);
  }

  // 6. Examine — only run when there are patches with after-text.
  const testRepo = new TestRepository(databaseUrl);
  let testCount = 0;
  let framework = "unknown";
  if (surgeonResult.patches.length > 0) {
    const examiner = new ExaminerService(router, testRepo, auditEventRepo);
    const examineResult = await examiner.examineBatch({
      jobId: job.id,
      snapshotId: clone.snapshotId,
      localPath: clone.localPath,
      patches: surgeonResult.patches,
      agentKind: "migrate",
    });
    if (examineResult.tests.length > 0) {
      await examiner.persistTests(examineResult.tests);
    }
    testCount = examineResult.tests.length;
    framework = examineResult.framework;
    console.log(
      `[step 6] Examiner produced ${testCount} test(s); framework=${framework} errors=${examineResult.errors.length}`,
    );
  } else {
    console.log("[step 6] Examiner skipped — no patches with after-text");
  }

  // 7. Audit + sign.
  const signingKeyRepo = new SigningKeyRepository(databaseUrl);
  const auditor = new AuditorService(auditEventRepo, signingKeyRepo);
  const auditResult = await auditor.audit({
    jobId: job.id,
    snapshotId: clone.snapshotId,
  });
  console.log(
    `[step 7] Auditor signed report over ${auditResult.auditReport.summary.totalEvents} events`,
  );

  // 8. Verify signature.
  const verified = AuditorService.verifySignature(
    auditResult.auditReport,
    auditResult.signature,
  );
  if (!verified) {
    console.error("FAIL: Auditor signature did not verify");
    process.exit(1);
  }
  console.log("[step 8] Signature verified");

  // 9. Assert Wave 3 persistence side-effects.
  const auditEventRows = await auditEventRepo.findByJobId(job.id);
  if (auditEventRows.length === 0) {
    console.error(
      "FAIL: audit_events table received zero rows — Task 11 instrumentation regressed",
    );
    process.exit(1);
  }
  console.log(`[step 9a] audit_events rows for job: ${auditEventRows.length}`);

  const signingRow = await signingKeyRepo.getByJobId(job.id, "ed25519");
  if (!signingRow) {
    console.error(
      "FAIL: signing_keys missing the ed25519 keypair for the job — Task 12 regressed",
    );
    process.exit(1);
  }
  console.log(
    `[step 9b] signing_keys row present (algo=${signingRow.algorithm})`,
  );

  // generated_tests is allowed to be empty when the patch list is empty,
  // but if Examiner produced tests they must persist. Reading by job
  // requires the helper used in Task 10's TestRepository.
  const testRows = await testRepo.getByJob(job.id);
  if (testCount > 0 && testRows.length === 0) {
    console.error(
      "FAIL: Examiner produced tests in-memory but generated_tests is empty — persistTests regressed",
    );
    process.exit(1);
  }
  console.log(
    `[step 9c] generated_tests rows for job: ${testRows.length} (expected ≥ ${testCount})`,
  );

  // 10. Mark job done.
  await jobRepo.markCompleted(job.id);

  // 11. Structured summary.
  console.log(
    JSON.stringify(
      {
        jobId: job.id,
        snapshotId: clone.snapshotId,
        commitSha: clone.commitSha,
        filesIndexed: index.fileCount,
        importsIndexed: index.importCount,
        symbolsIndexed: index.symbolCount,
        rulesPlanned: plan.rules.length,
        batchCount: retrieval.batches.length,
        firstBatchSize: firstBatch.files.length,
        patchCount: surgeonResult.patches.length,
        proposedPatchCount: proposedPatches.length,
        unresolvedFileCount: surgeonResult.unresolvedFileIds.length,
        llmAttempts: surgeonResult.llmAttempts,
        llmLatencyMs: surgeonResult.llmLatencyMs,
        llmProvider: surgeonResult.llmProvider,
        testCount,
        framework,
        auditTotalEvents: auditResult.auditReport.summary.totalEvents,
        auditEventRowsPersisted: auditEventRows.length,
        generatedTestRowsPersisted: testRows.length,
        signatureAlgorithm: auditResult.signature.algorithm,
      },
      null,
      2,
    ),
  );

  console.log("\nPASS: Wave 3 end-to-end pipeline verified.");
  console.log(`  - jobId:                 ${job.id}`);
  console.log(`  - snapshotId:            ${clone.snapshotId}`);
  console.log(`  - patches:               ${surgeonResult.patches.length}`);
  console.log(`  - tests (in-memory):     ${testCount}`);
  console.log(`  - tests (persisted):     ${testRows.length}`);
  console.log(`  - audit_events rows:     ${auditEventRows.length}`);
  console.log(
    `  - signature:             ${auditResult.signature.value.slice(0, 16)}…`,
  );
  console.log(
    `  - publicKey:             ${auditResult.signature.publicKey.slice(0, 16)}…`,
  );
}

main().catch((err) => {
  console.error("Wave 3 e2e verifier failed:", err);
  process.exit(1);
});
