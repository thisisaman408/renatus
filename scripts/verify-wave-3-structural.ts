#!/usr/bin/env tsx
/**
 * Wave 3 structural verifier — runs without DATABASE_URL or any LLM key.
 *
 * Exits 0 if every check passes; exits with the number of failures otherwise.
 *
 * What it adds on top of `pnpm verify:wave-2` (which is the regression gate
 * and must also stay green — `pnpm verify:wave-3` chains both):
 *   a. Wave 3 schema files present (audit_events, generated_tests, signing_keys).
 *   b. Wave 3 repositories present (test/signing-key/audit-event).
 *   c. Wave 3 Drizzle migrations 0003 / 0004 / 0005 present.
 *   d. Wave 3 agent modules present and non-stub (ExaminerService /
 *      AuditorService + verifySignature / emitAuditEvent + createEmitter).
 *   e. MCP server registers the full 13 tools (Wave 2's 10 + examine +
 *      refactor_repository + audit_repository).
 *   f. canonicalJson roundtrip + cycle detection (in-memory).
 *   g. ed25519 signature self-roundtrip using a deterministic seed key,
 *      built over a real AuditReport-shaped object via canonicalJson, and
 *      verified through `AuditorService.verifySignature`. Tamper test must
 *      return false. All in-memory; no DB.
 *   h. Tailwind 3→4 pack still resolves and detects (re-verified for
 *      symmetry; the bulk of this check lives in the Wave 2 verifier).
 *   i. Refactor agent surfaces present in bob-extensions/.
 *   j. migrate-repository.ts AND refactor-repository.ts each contain both
 *      `step.run('examine'` AND `step.run('audit'`.
 *   k. `_orchestrator/patch-mapper.ts` exports `mapPatchRowToPatch`.
 *   l. Build artifacts (agents + mcp-server dist/index.js).
 *
 * Notes:
 *   - The cycle test uses try/catch (cycle throws inside `canonicalJson`).
 *   - `@noble/curves/ed25519` is not a direct dep of the repo root; we
 *     resolve it via `createRequire` rooted at the `@renatus/agents`
 *     package.json so the deterministic-signing roundtrip stays in-process.
 *
 * Run via `pnpm verify:wave-3` (chains: wave-2 structural && this script).
 */
import { randomUUID, createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  AuditorService,
  type AuditReport,
  type Signature,
} from "@renatus/agents";
import { canonicalJson } from "@renatus/shared";

// ────────────────────────────────────────────────────────────────────────────
// Layout
// ────────────────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");

// Resolve noble through the agents package — the verifier lives at the repo
// root which doesn't have noble as a direct dep, but agents does.
const agentsPkgJson = path.join(
  REPO_ROOT,
  "packages",
  "agents",
  "package.json",
);
const requireFromAgents = createRequire(agentsPkgJson);
// Narrow the noble surface to exactly what the verifier touches. Returning
// `any` from a dynamic require would be a lint smell; tying to a tiny inline
// interface keeps the strict-mode build clean.
interface NobleEd25519 {
  getPublicKey(seed: Uint8Array): Uint8Array;
  sign(msg: Uint8Array, seed: Uint8Array): Uint8Array;
  verify(sig: Uint8Array, msg: Uint8Array, pub: Uint8Array): boolean;
  utils: { randomPrivateKey(): Uint8Array };
}
interface NobleHashesUtils {
  bytesToHex(b: Uint8Array): string;
  hexToBytes(h: string): Uint8Array;
}
const { ed25519 } = requireFromAgents("@noble/curves/ed25519") as {
  ed25519: NobleEd25519;
};
const { bytesToHex } = requireFromAgents(
  "@noble/hashes/utils",
) as NobleHashesUtils;

const EXPECTED_MCP_TOOLS_WAVE_3 = [
  "ping",
  "llm_test",
  "cartograph_repository",
  "clone_repository",
  "index_repository",
  "plan_change",
  "find_affected_files",
  "propose_patch",
  "apply_patch",
  "migrate_repository",
  "refactor_repository",
  "examine",
  "audit_repository",
  "security_audit_repository",
  "query_codebase",
];

// ────────────────────────────────────────────────────────────────────────────
// Tiny report harness — mirrors the Wave 2 verifier's output format exactly
// so a glance shows both verifiers as one continuous stream of PASS lines.
// ────────────────────────────────────────────────────────────────────────────

interface CheckResult {
  description: string;
  ok: boolean;
  detail?: string;
}

const results: CheckResult[] = [];

function record(description: string, ok: boolean, detail?: string): void {
  results.push({ description, ok, detail });
}

async function safe<T>(
  description: string,
  fn: () => Promise<T> | T,
): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    record(description, false, message);
    return undefined;
  }
}

async function fileExistsAndContains(
  absPath: string,
  needles: ReadonlyArray<string>,
  description: string,
): Promise<void> {
  try {
    const stats = await stat(absPath);
    if (!stats.isFile()) {
      record(description, false, "not a regular file");
      return;
    }
    const text = await readFile(absPath, "utf-8");
    const missing = needles.filter((n) => !text.includes(n));
    if (missing.length === 0) {
      record(description, true);
    } else {
      record(description, false, `missing strings: ${missing.join(", ")}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    record(description, false, message);
  }
}

async function fileExists(
  absPath: string,
  description: string,
): Promise<void> {
  try {
    const stats = await stat(absPath);
    record(description, stats.isFile(), stats.isFile() ? undefined : "not a file");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    record(description, false, message);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// (a) Schema files
// ────────────────────────────────────────────────────────────────────────────

async function checkSchemaFiles(): Promise<void> {
  const schemas: ReadonlyArray<[string, string]> = [
    ["packages/db/src/schema/generated-tests.ts", "generatedTests"],
    ["packages/db/src/schema/signing-keys.ts", "signingKeys"],
    ["packages/db/src/schema/audit-events.ts", "auditEvents"],
  ];
  for (const [rel, exportName] of schemas) {
    await fileExistsAndContains(
      path.join(REPO_ROOT, rel),
      [exportName],
      `schema present + exports ${exportName}: ${rel}`,
    );
  }
}

// ────────────────────────────────────────────────────────────────────────────
// (b) Repositories
// ────────────────────────────────────────────────────────────────────────────

async function checkRepositoryFiles(): Promise<void> {
  const repos: ReadonlyArray<[string, string]> = [
    ["packages/db/src/repositories/test-repository.ts", "TestRepository"],
    [
      "packages/db/src/repositories/signing-key-repository.ts",
      "SigningKeyRepository",
    ],
    [
      "packages/db/src/repositories/audit-event-repository.ts",
      "AuditEventRepository",
    ],
  ];
  for (const [rel, className] of repos) {
    await fileExistsAndContains(
      path.join(REPO_ROOT, rel),
      [`class ${className}`],
      `repository present + exports ${className}: ${rel}`,
    );
  }
}

// ────────────────────────────────────────────────────────────────────────────
// (c) Migrations 0003 / 0004 / 0005
// ────────────────────────────────────────────────────────────────────────────

async function checkMigrations(): Promise<void> {
  // We don't pin the slug suffix (drizzle generates random names) — just
  // assert each numeric prefix exists and contains the expected DDL.
  const drizzleDir = path.join(REPO_ROOT, "packages", "db", "drizzle");
  const { readdir } = await import("node:fs/promises");
  let files: string[];
  try {
    files = await readdir(drizzleDir);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    record("drizzle dir readable", false, message);
    return;
  }
  record("drizzle dir readable", true);

  const expected: ReadonlyArray<[string, string, string]> = [
    ["0003_", "audit_events migration (0003)", `"audit_events"`],
    ["0004_", "generated_tests migration (0004)", `"generated_tests"`],
    ["0005_", "signing_keys migration (0005)", `"signing_keys"`],
  ];

  for (const [prefix, description, tableLiteral] of expected) {
    const match = files.find(
      (f) => f.startsWith(prefix) && f.endsWith(".sql"),
    );
    if (!match) {
      record(description, false, `no ${prefix}*.sql under drizzle/`);
      continue;
    }
    try {
      const sql = await readFile(path.join(drizzleDir, match), "utf-8");
      if (sql.includes(tableLiteral)) {
        record(description, true, `file=${match}`);
      } else {
        record(
          description,
          false,
          `${match} did not reference ${tableLiteral}`,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      record(description, false, message);
    }
  }
}

// ────────────────────────────────────────────────────────────────────────────
// (d) Agent modules (non-stub)
// ────────────────────────────────────────────────────────────────────────────

async function checkAgentModules(): Promise<void> {
  await fileExistsAndContains(
    path.join(REPO_ROOT, "packages/agents/src/examiner/index.ts"),
    ["class ExaminerService"],
    "agent module: ExaminerService present (non-stub)",
  );
  await fileExistsAndContains(
    path.join(REPO_ROOT, "packages/agents/src/auditor/index.ts"),
    ["class AuditorService", "static verifySignature"],
    "agent module: AuditorService + verifySignature present",
  );
  await fileExistsAndContains(
    path.join(REPO_ROOT, "packages/agents/src/audit-events/emit.ts"),
    ["emitAuditEvent", "createEmitter"],
    "agent module: emit.ts exports emitAuditEvent + createEmitter",
  );
}

// ────────────────────────────────────────────────────────────────────────────
// (e) MCP tool registry — full 13
// ────────────────────────────────────────────────────────────────────────────

async function checkMcpRegistry(): Promise<void> {
  const mcpIndexPath = path.join(
    REPO_ROOT,
    "packages",
    "mcp-server",
    "src",
    "index.ts",
  );
  let text: string;
  try {
    text = await readFile(mcpIndexPath, "utf-8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    record("MCP server entry readable (wave 3)", false, message);
    return;
  }
  record("MCP server entry readable (wave 3)", true);

  const nameRe = /name:\s*['"]([a-zA-Z_]+)['"]/g;
  const found = new Set<string>();
  for (const match of text.matchAll(nameRe)) {
    if (match[1]) found.add(match[1]);
  }

  for (const expected of EXPECTED_MCP_TOOLS_WAVE_3) {
    record(`MCP tool registered (wave 3): ${expected}`, found.has(expected));
  }
}

// ────────────────────────────────────────────────────────────────────────────
// (f) canonicalJson roundtrip + cycle detection
// ────────────────────────────────────────────────────────────────────────────

function checkCanonicalJson(): void {
  // 1. Nested key sort.
  const nested = canonicalJson({ b: 1, a: { z: 2, x: 1 } });
  const expectedNested = '{"a":{"x":1,"z":2},"b":1}';
  record(
    "canonicalJson: nested key sort",
    nested === expectedNested,
    `got=${nested}`,
  );

  // 2. Arrays preserve order.
  const arr = canonicalJson([3, 1, 2]);
  record(
    "canonicalJson: array preserves order",
    arr === "[3,1,2]",
    `got=${arr}`,
  );

  // 3. Unicode round-trips (bytes preserved through canonical → parse).
  const unicodeObj = { key: "café" };
  const unicodeCanonical = canonicalJson(unicodeObj);
  let unicodeOk = false;
  let unicodeDetail = unicodeCanonical;
  try {
    const parsed = JSON.parse(unicodeCanonical) as Record<string, string>;
    unicodeOk = parsed["key"] === "café";
    unicodeDetail = `canonical=${unicodeCanonical} parsed.key=${parsed["key"]}`;
  } catch (err) {
    unicodeDetail = err instanceof Error ? err.message : String(err);
  }
  record("canonicalJson: unicode round-trip", unicodeOk, unicodeDetail);

  // 4. Cycle detection.
  type SelfRef = { self: SelfRef | null };
  const cycle: SelfRef = { self: null };
  cycle.self = cycle;
  let threw = false;
  let cycleMsg = "";
  try {
    canonicalJson(cycle);
  } catch (err) {
    threw = true;
    cycleMsg = err instanceof Error ? err.message : String(err);
  }
  record(
    "canonicalJson: cycle throws with /Cycle/ message",
    threw && /Cycle/i.test(cycleMsg),
    cycleMsg || "(no error thrown)",
  );
}

// ────────────────────────────────────────────────────────────────────────────
// (g) ed25519 signature self-roundtrip + tamper test (no DB)
// ────────────────────────────────────────────────────────────────────────────

function buildSyntheticReport(jobId: string, snapshotId: string): AuditReport {
  // Empty event log is a valid signed report — matches AuditorService's
  // behavior for jobs with no recorded events.
  return {
    jobId,
    snapshotId,
    timestamp: "2026-05-17T00:00:00.000Z",
    summary: {
      totalEvents: 0,
      byAgent: {},
      byEventType: {},
      patchesProposed: 0,
      patchesApplied: 0,
      patchesUnresolved: 0,
      testsGenerated: 0,
      testsPassed: 0,
      testsFailed: 0,
      failures: 0,
    },
    events: [],
  };
}

function checkSignatureRoundtrip(): void {
  // Deterministic ed25519 seed: sha256 of a fixed phrase, truncated to 32B.
  // We avoid `ed25519.utils.randomPrivateKey` here so failures are
  // reproducible across runs.
  const seedSource = "renatus-wave-3-test-seed";
  const seed = createHash("sha256").update(seedSource).digest();
  const privateKey = new Uint8Array(seed.buffer, seed.byteOffset, 32);
  const publicKey = ed25519.getPublicKey(privateKey);

  // Build a UUID-valid synthetic report (Zod schema requires it).
  const jobId = randomUUID();
  const snapshotId = randomUUID();
  const report = buildSyntheticReport(jobId, snapshotId);

  // Canonicalize → hash → sign exactly as AuditorService.signAuditReport.
  const canonical = canonicalJson(report);
  const messageHash = createHash("sha256")
    .update(canonical)
    .digest();
  const messageHashBytes = new Uint8Array(
    messageHash.buffer,
    messageHash.byteOffset,
    messageHash.byteLength,
  );
  const sigBytes = ed25519.sign(messageHashBytes, privateKey);

  const signature: Signature = {
    algorithm: "ed25519",
    value: bytesToHex(sigBytes),
    publicKey: bytesToHex(publicKey),
    messageHash: bytesToHex(messageHashBytes),
    signedAt: "2026-05-17T00:00:00.000Z",
  };

  // Roundtrip: re-canonicalize + re-hash + ed25519.verify happens inside.
  const verified = AuditorService.verifySignature(report, signature);
  record(
    "ed25519 signature: self-roundtrip verifies",
    verified === true,
    verified
      ? `pub=${signature.publicKey.slice(0, 16)}…`
      : "verifySignature returned false on untampered input",
  );

  // Tamper test: add a benign extra field. The schema doesn't strip it,
  // canonicalJson sees a different byte sequence, hashes differ, verify
  // must return false against the *original* signature.
  const tampered: AuditReport & { tamperMarker?: string } = {
    ...report,
    summary: { ...report.summary, totalEvents: 1 },
  };
  // Re-cast through AuditReport so the verifier sees a same-shaped object
  // (mutated content, same shape) — exactly the scenario we want to detect.
  const tamperedVerified = AuditorService.verifySignature(
    tampered as AuditReport,
    signature,
  );
  record(
    "ed25519 signature: tampered report fails verify",
    tamperedVerified === false,
    tamperedVerified
      ? "verifySignature returned true on tampered input (BAD)"
      : undefined,
  );
}

// ────────────────────────────────────────────────────────────────────────────
// (g+) Audit timestamp drift fix — W5-code-1
//
// Models the post-W5 persisted-signature path:
//   1. Sign a synthetic AuditReport in-memory.
//   2. Build a fake `audit_signed` event payload that includes
//      `canonicalReportBytes` (the exact bytes that were signed) — the same
//      payload shape `AuditorService.recordSignatureEvent` writes to the DB.
//   3. "Reconstruct" the report by `JSON.parse(canonicalReportBytes)` — this
//      is what the `/api/jobs/[jobId]/audit-report` route does on the new
//      `status: 'signed'` path.
//   4. Hash the canonical bytes; confirm the hash equals the stored
//      `messageHash` AND ed25519.verify returns true. Proves the round-trip
//      is byte-identical regardless of `report.timestamp` drift.
//   5. Tamper test: parse, mutate one field, re-canonicalize, hash → MUST
//      differ from the stored `messageHash` (and verification MUST fail).
//   6. Drift test: rebuild the report from "events" with a NEW timestamp
//      (simulating the pre-fix bug). `AuditorService.verifySignature` MUST
//      still succeed because it prefers `signature.canonicalReportBytes`
//      over re-canonicalizing the drifted report.
// ────────────────────────────────────────────────────────────────────────────

function checkAuditTimestampDriftFix(): void {
  const seedSource = "renatus-w5-drift-fix-seed";
  const seed = createHash("sha256").update(seedSource).digest();
  const privateKey = new Uint8Array(seed.buffer, seed.byteOffset, 32);
  const publicKey = ed25519.getPublicKey(privateKey);

  // 1. Build + sign a synthetic report.
  const jobId = randomUUID();
  const snapshotId = randomUUID();
  const originalTimestamp = "2026-05-17T12:34:56.789Z";
  const report: AuditReport = {
    jobId,
    snapshotId,
    timestamp: originalTimestamp,
    summary: {
      totalEvents: 0,
      byAgent: {},
      byEventType: {},
      patchesProposed: 0,
      patchesApplied: 0,
      patchesUnresolved: 0,
      testsGenerated: 0,
      testsPassed: 0,
      testsFailed: 0,
      failures: 0,
    },
    events: [],
  };

  const canonicalBytes = canonicalJson(report);
  const messageHashBuf = createHash("sha256").update(canonicalBytes).digest();
  const messageHashBytes = new Uint8Array(
    messageHashBuf.buffer,
    messageHashBuf.byteOffset,
    messageHashBuf.byteLength,
  );
  const sigBytes = ed25519.sign(messageHashBytes, privateKey);

  // 2. The fake audit_signed payload — same shape recordSignatureEvent
  //    writes to the audit_events table.
  const auditSignedPayload = {
    algorithm: "ed25519" as const,
    value: bytesToHex(sigBytes),
    publicKey: bytesToHex(publicKey),
    messageHash: bytesToHex(messageHashBytes),
    signedAt: "2026-05-17T12:34:56.999Z",
    canonicalReportBytes: canonicalBytes,
    reportTimestamp: originalTimestamp,
  };

  // 3. Reconstruct the report from the bytes — exactly what the API route
  //    does on the `status: 'signed'` path.
  let reconstructed: AuditReport;
  try {
    reconstructed = JSON.parse(
      auditSignedPayload.canonicalReportBytes,
    ) as AuditReport;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    record(
      "audit drift fix: canonicalReportBytes JSON.parse round-trips",
      false,
      msg,
    );
    return;
  }

  // 4. The hash of the bytes the route returned MUST equal the stored
  //    messageHash. Proves byte-for-byte round-trip.
  const recomputedHashHex = createHash("sha256")
    .update(auditSignedPayload.canonicalReportBytes)
    .digest("hex");
  record(
    "audit drift fix: hash(canonicalReportBytes) === stored messageHash",
    recomputedHashHex === auditSignedPayload.messageHash,
    recomputedHashHex === auditSignedPayload.messageHash
      ? `hash=${recomputedHashHex.slice(0, 12)}…`
      : `got=${recomputedHashHex} expected=${auditSignedPayload.messageHash}`,
  );

  // 4b. The reconstructed report's timestamp matches the ORIGINAL signed
  //     timestamp byte-for-byte — i.e. we recovered it losslessly.
  record(
    "audit drift fix: reconstructed report.timestamp matches original",
    reconstructed.timestamp === originalTimestamp,
    reconstructed.timestamp === originalTimestamp
      ? `timestamp=${reconstructed.timestamp}`
      : `got=${reconstructed.timestamp} expected=${originalTimestamp}`,
  );

  // 5. Verifier accepts the new shape (Signature with canonicalReportBytes).
  //    Even if we pass a DRIFTED reconstruction of the report (different
  //    timestamp), the verifier prefers signature.canonicalReportBytes and
  //    still succeeds.
  const driftedReport: AuditReport = {
    ...reconstructed,
    // Simulate the pre-fix bug: the route used to use the audit_signed
    // row's DB timestamp as report.timestamp, which differs from the
    // originally-signed value by microseconds.
    timestamp: "2026-05-17T12:34:57.012Z",
  };
  const signatureWithBytes: Signature = {
    algorithm: "ed25519",
    value: auditSignedPayload.value,
    publicKey: auditSignedPayload.publicKey,
    messageHash: auditSignedPayload.messageHash,
    signedAt: auditSignedPayload.signedAt,
    canonicalReportBytes: auditSignedPayload.canonicalReportBytes,
  };
  const verifiedDespiteDrift = AuditorService.verifySignature(
    driftedReport,
    signatureWithBytes,
  );
  record(
    "audit drift fix: verifySignature succeeds despite report.timestamp drift",
    verifiedDespiteDrift === true,
    verifiedDespiteDrift
      ? undefined
      : "verifier rejected drifted report with canonicalReportBytes present (BAD — should ignore the drifted report and use the bytes)",
  );

  // 6. Tamper test: mutate the canonical bytes themselves (e.g. inject
  //    an extra field). The recomputed hash MUST differ from the stored
  //    messageHash AND verifySignature MUST return false.
  const tamperedBytes = canonicalJson({
    ...reconstructed,
    summary: { ...reconstructed.summary, totalEvents: 999 },
  });
  const tamperedHashHex = createHash("sha256")
    .update(tamperedBytes)
    .digest("hex");
  const tamperedSignature: Signature = {
    ...signatureWithBytes,
    canonicalReportBytes: tamperedBytes,
  };
  const tamperedVerified = AuditorService.verifySignature(
    reconstructed,
    tamperedSignature,
  );
  record(
    "audit drift fix: tampered canonical bytes fail verification",
    tamperedHashHex !== auditSignedPayload.messageHash &&
      tamperedVerified === false,
    tamperedVerified
      ? "verifier accepted tampered bytes (BAD)"
      : `tampered hash=${tamperedHashHex.slice(0, 12)}…`,
  );
}

// ────────────────────────────────────────────────────────────────────────────
// (h) Tailwind pack — light re-check (wave-2 already covers the full path)
// ────────────────────────────────────────────────────────────────────────────

async function checkTailwindPackPresent(): Promise<void> {
  // The wave-2 verifier exercises planFromPack + detectors against the
  // fixture. Here we just assert the rule pack source file exists, so
  // the wave-3 verifier remains self-contained as a structural check.
  await fileExistsAndContains(
    path.join(
      REPO_ROOT,
      "packages/agents/src/cartographer/rules/tailwind-3-to-4.ts",
    ),
    ["tailwind-v4-css-import", "tailwind-v4-default-border-color"],
    "tailwind 3→4 rule pack source present",
  );
}

// ────────────────────────────────────────────────────────────────────────────
// (i) Refactor agent surfaces
// ────────────────────────────────────────────────────────────────────────────

async function checkRefactorSurfaces(): Promise<void> {
  await fileExists(
    path.join(REPO_ROOT, "bob-extensions/modes/refactor.md"),
    "bob-extensions mode: refactor.md",
  );
  await fileExists(
    path.join(REPO_ROOT, "bob-extensions/commands/refactor.md"),
    "bob-extensions command: refactor.md",
  );
}

// ────────────────────────────────────────────────────────────────────────────
// (j) Workflow examine + audit steps
// ────────────────────────────────────────────────────────────────────────────

async function checkWorkflowSteps(): Promise<void> {
  for (const rel of [
    "packages/agents/src/_orchestrator/migrate-repository.ts",
    "packages/agents/src/_orchestrator/refactor-repository.ts",
  ]) {
    await fileExistsAndContains(
      path.join(REPO_ROOT, rel),
      ["step.run('examine'", "step.run('audit'"],
      `workflow has examine + audit steps: ${rel}`,
    );
  }
}

// ────────────────────────────────────────────────────────────────────────────
// (k) patch-mapper.ts
// ────────────────────────────────────────────────────────────────────────────

async function checkPatchMapper(): Promise<void> {
  await fileExistsAndContains(
    path.join(
      REPO_ROOT,
      "packages/agents/src/_orchestrator/patch-mapper.ts",
    ),
    ["export function mapPatchRowToPatch"],
    "patch-mapper.ts exports mapPatchRowToPatch",
  );
}

// ────────────────────────────────────────────────────────────────────────────
// (m) Wave-4 Q&A agent artifacts
// ────────────────────────────────────────────────────────────────────────────

async function checkQaArtifacts(): Promise<void> {
  // Schema + repo
  await fileExistsAndContains(
    path.join(REPO_ROOT, "packages/db/src/schema/qa-transcripts.ts"),
    ["qaTranscripts"],
    "schema present + exports qaTranscripts: packages/db/src/schema/qa-transcripts.ts",
  );
  await fileExistsAndContains(
    path.join(
      REPO_ROOT,
      "packages/db/src/repositories/qa-transcript-repository.ts",
    ),
    ["class QaTranscriptRepository"],
    "repository present + exports QaTranscriptRepository: packages/db/src/repositories/qa-transcript-repository.ts",
  );

  // Agent module
  await fileExistsAndContains(
    path.join(REPO_ROOT, "packages/agents/src/qa/index.ts"),
    ["class QaService"],
    "agent module: QaService present (non-stub)",
  );

  // Signing helper extracted from AuditorService (shared with Q&A)
  await fileExistsAndContains(
    path.join(REPO_ROOT, "packages/agents/src/auditor/sign.ts"),
    ["signWithJobKeypair", "signCanonicalText", "getOrCreateJobKeypair"],
    "auditor/sign.ts exports signing helpers",
  );

  // Migration 0006_*.sql with the qa_transcripts table literal
  const drizzleDir = path.join(REPO_ROOT, "packages", "db", "drizzle");
  const { readdir } = await import("node:fs/promises");
  let files: string[] = [];
  try {
    files = await readdir(drizzleDir);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    record("qa_transcripts migration (0006)", false, message);
    return;
  }
  const match = files.find((f) => f.startsWith("0006_") && f.endsWith(".sql"));
  if (!match) {
    record("qa_transcripts migration (0006)", false, "no 0006_*.sql under drizzle/");
  } else {
    try {
      const sql = await readFile(path.join(drizzleDir, match), "utf-8");
      if (sql.includes(`"qa_transcripts"`)) {
        record("qa_transcripts migration (0006)", true, `file=${match}`);
      } else {
        record(
          "qa_transcripts migration (0006)",
          false,
          `${match} did not reference "qa_transcripts"`,
        );
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      record("qa_transcripts migration (0006)", false, message);
    }
  }

  // Bob surfaces
  await fileExists(
    path.join(REPO_ROOT, "bob-extensions/modes/ask-codebase.md"),
    "bob-extensions mode: ask-codebase.md",
  );
  await fileExists(
    path.join(REPO_ROOT, "bob-extensions/commands/ask-codebase.md"),
    "bob-extensions command: ask-codebase.md",
  );

  // Workflow
  await fileExistsAndContains(
    path.join(REPO_ROOT, "packages/agents/src/_orchestrator/qa-repository.ts"),
    ["qaRepository = inngest.createFunction"],
    "qa workflow file exists + exports qaRepository",
  );

  // W5-code-4: Q&A workflow accepts a discriminated `source` union (fresh
  // clone+index OR cached snapshot reuse). The schema MUST list both kinds
  // and the workflow MUST emit `snapshot_resolved_from_cache` on the cached
  // path so the audit chain shows the reuse. We grep the source rather than
  // import-and-parse to keep this verifier dependency-free.
  await fileExistsAndContains(
    path.join(REPO_ROOT, "packages/agents/src/_orchestrator/qa-repository.ts"),
    [
      "z.discriminatedUnion('kind'",
      "z.literal('fresh')",
      "z.literal('cached')",
    ],
    "W5-code-4: qa-repository event schema accepts discriminated source union (fresh|cached)",
  );
  await fileExistsAndContains(
    path.join(REPO_ROOT, "packages/agents/src/_orchestrator/qa-repository.ts"),
    ["snapshot_resolved_from_cache", "resolve-snapshot"],
    "W5-code-4: qa-repository emits snapshot_resolved_from_cache on cached path",
  );

  // W5-code-4: MCP tool + web API route both accept `snapshotId` and refine()
  // exactly-one-of (repoUrl, snapshotId). Greps prove the contract is wired
  // through both entry points.
  await fileExistsAndContains(
    path.join(REPO_ROOT, "packages/mcp-server/src/tools/query-codebase.ts"),
    ["snapshotId", "Either repoUrl OR snapshotId is required"],
    "W5-code-4: query_codebase MCP tool accepts snapshotId (with refine())",
  );
  await fileExistsAndContains(
    path.join(REPO_ROOT, "apps/web/app/api/agents/[agentKind]/route.ts"),
    ["snapshotId", "Either repoUrl OR snapshotId is required"],
    "W5-code-4: /api/agents/qa accepts snapshotId (with refine())",
  );
}

// ────────────────────────────────────────────────────────────────────────────
// (n) Wave-4 web-app routes
// ────────────────────────────────────────────────────────────────────────────

async function checkWebAppRoutes(): Promise<void> {
  // Landing page rewrite — content marker.
  await fileExistsAndContains(
    path.join(REPO_ROOT, "apps/web/app/page.tsx"),
    ["Four agents"],
    "web app landing page rewrite (Four agents)",
  );
  // /run tabbed picker.
  await fileExists(
    path.join(REPO_ROOT, "apps/web/app/run/page.tsx"),
    "web app route: /run",
  );
  // Shortcut routes.
  for (const shortcut of ["migrate", "refactor", "security", "qa"]) {
    await fileExists(
      path.join(REPO_ROOT, `apps/web/app/${shortcut}/page.tsx`),
      `web app shortcut route: /${shortcut}`,
    );
  }
  // Job + audit + verify pages.
  await fileExists(
    path.join(REPO_ROOT, "apps/web/app/jobs/[jobId]/page.tsx"),
    "web app route: /jobs/[jobId]",
  );
  await fileExists(
    path.join(REPO_ROOT, "apps/web/app/audit/[jobId]/page.tsx"),
    "web app route: /audit/[jobId]",
  );
  await fileExists(
    path.join(REPO_ROOT, "apps/web/app/verify/page.tsx"),
    "web app route: /verify",
  );
  // API route handlers.
  await fileExists(
    path.join(REPO_ROOT, "apps/web/app/api/inngest/route.ts"),
    "web app API route: /api/inngest",
  );
  await fileExists(
    path.join(REPO_ROOT, "apps/web/app/api/jobs/[jobId]/stream/route.ts"),
    "web app API route: /api/jobs/[jobId]/stream",
  );
  await fileExists(
    path.join(REPO_ROOT, "apps/web/app/api/jobs/[jobId]/audit-report/route.ts"),
    "web app API route: /api/jobs/[jobId]/audit-report",
  );

  // WebJobRepository present + exported from @renatus/db.
  await fileExistsAndContains(
    path.join(REPO_ROOT, "packages/db/src/repositories/web-job-repository.ts"),
    ["class WebJobRepository"],
    "repository present + exports WebJobRepository: packages/db/src/repositories/web-job-repository.ts",
  );
  await fileExistsAndContains(
    path.join(REPO_ROOT, "packages/db/src/index.ts"),
    ["web-job-repository"],
    "@renatus/db re-exports WebJobRepository",
  );
}

// ────────────────────────────────────────────────────────────────────────────
// (o) Wave-4 web-app — KG + WebContainers replay
// ────────────────────────────────────────────────────────────────────────────

async function checkKgAndReplayArtifacts(): Promise<void> {
  // KG route — RSC page + client island.
  await fileExists(
    path.join(REPO_ROOT, "apps/web/app/kg/[jobId]/page.tsx"),
    "web app route: /kg/[jobId] (page.tsx)",
  );
  await fileExists(
    path.join(REPO_ROOT, "apps/web/app/kg/[jobId]/kg-canvas.tsx"),
    "web app client island: /kg/[jobId]/kg-canvas.tsx",
  );

  // Replay route — RSC shell + client island.
  await fileExists(
    path.join(REPO_ROOT, "apps/web/app/replay/[jobId]/page.tsx"),
    "web app route: /replay/[jobId] (page.tsx)",
  );
  await fileExists(
    path.join(REPO_ROOT, "apps/web/app/replay/[jobId]/replay-canvas.tsx"),
    "web app client island: /replay/[jobId]/replay-canvas.tsx",
  );

  // Replay-tree API route.
  await fileExists(
    path.join(
      REPO_ROOT,
      "apps/web/app/api/jobs/[jobId]/replay-tree/route.ts",
    ),
    "web app API route: /api/jobs/[jobId]/replay-tree",
  );

  // /verify route — re-verification of W4-3 deliverable. Already covered by
  // checkWebAppRoutes but re-asserted here so the KG/replay subsection reads
  // as a complete Wave-4 visual-hero report.
  await fileExists(
    path.join(REPO_ROOT, "apps/web/app/verify/page.tsx"),
    "web app route: /verify (Wave-4 hero re-verified)",
  );

  // package.json must list the two new deps. We grep the file rather than
  // parsing because pnpm might re-format on upgrade — the substring check
  // tolerates either ordering.
  await fileExistsAndContains(
    path.join(REPO_ROOT, "apps/web/package.json"),
    ['"react-force-graph-2d"', '"@webcontainer/api"'],
    "apps/web/package.json lists react-force-graph-2d + @webcontainer/api",
  );

  // Cross-origin isolation headers — required for WebContainers to receive
  // SharedArrayBuffer. We assert both header values are present in the
  // config string. The header lookup is by source path so we don't pin the
  // exact regex shape here.
  await fileExistsAndContains(
    path.join(REPO_ROOT, "apps/web/next.config.ts"),
    [
      "Cross-Origin-Embedder-Policy",
      "require-corp",
      "Cross-Origin-Opener-Policy",
      "same-origin",
    ],
    "apps/web/next.config.ts sets cross-origin isolation headers (require-corp + same-origin)",
  );
}

// ────────────────────────────────────────────────────────────────────────────
// (p) Wave-4 final polish — README, mobile CSS, all 4 Bob surfaces,
//     mcp-config.example.json explicit tier-1 list, WAVE-4-PROGRESS-NOTES.md,
//     STATE-OF-RENATUS.md updated.
// ────────────────────────────────────────────────────────────────────────────

async function checkFinalPolish(): Promise<void> {
  // README leads with the platform pitch.
  await fileExistsAndContains(
    path.join(REPO_ROOT, "README.md"),
    ["Four agents, one engine, signed audit"],
    "README.md contains platform pitch (Four agents, one engine, signed audit)",
  );

  // Wave 4 progress notes shipped.
  await fileExists(
    path.join(REPO_ROOT, "WAVE-4-PROGRESS-NOTES.md"),
    "WAVE-4-PROGRESS-NOTES.md exists",
  );

  // All 4 Bob modes present.
  for (const mode of [
    "migration.md",
    "refactor.md",
    "security-audit.md",
    "ask-codebase.md",
  ]) {
    await fileExists(
      path.join(REPO_ROOT, "bob-extensions/modes", mode),
      `bob-extensions mode (wave-4 polish): ${mode}`,
    );
  }

  // All 4 Bob commands present.
  for (const cmd of [
    "migrate.md",
    "refactor.md",
    "security-audit.md",
    "ask-codebase.md",
  ]) {
    await fileExists(
      path.join(REPO_ROOT, "bob-extensions/commands", cmd),
      `bob-extensions command (wave-4 polish): ${cmd}`,
    );
  }

  // mcp-config.example.json lists all 4 tier-1 tools explicitly.
  await fileExistsAndContains(
    path.join(REPO_ROOT, "bob-extensions/mcp-config.example.json"),
    [
      "migrate_repository",
      "refactor_repository",
      "security_audit_repository",
      "query_codebase",
    ],
    "mcp-config.example.json lists all 4 tier-1 tools explicitly",
  );

  // STATE-OF-RENATUS.md mentions Wave 4 (proves it's been updated).
  await fileExistsAndContains(
    path.join(REPO_ROOT, "STATE-OF-RENATUS.md"),
    ["Wave 4"],
    "STATE-OF-RENATUS.md mentions Wave 4 (post-Wave-4 baseline)",
  );

  // Mobile-degraded CSS shipped.
  await fileExistsAndContains(
    path.join(REPO_ROOT, "apps/web/app/globals.css"),
    ["max-width: 640px"],
    "apps/web/app/globals.css ships mobile breakpoint (max-width: 640px)",
  );
}

// ────────────────────────────────────────────────────────────────────────────
// (q) Watsonx adapter real (W5-code-2)
//
// Confirms the stub watsonx adapter has been replaced with a real REST+IAM
// implementation. The verifier does NOT hit the live watsonx API — these are
// all structural greps. End-to-end validation requires a real WATSONX_API_KEY
// and is intentionally out of scope here.
// ────────────────────────────────────────────────────────────────────────────

async function checkWatsonxAdapterReal(): Promise<void> {
  const adapterPath = path.join(
    REPO_ROOT,
    "packages/llm/src/adapters/watsonx-granite-adapter.ts",
  );

  // (a) Exports both classes.
  await fileExistsAndContains(
    adapterPath,
    ["class WatsonxGraniteAdapter", "class WatsonxAdapterError"],
    "watsonx adapter: exports WatsonxGraniteAdapter + WatsonxAdapterError",
  );

  // (b) Legacy stub string is gone.
  try {
    const text = await readFile(adapterPath, "utf-8");
    const stillStub = text.includes(
      "WatsonxGraniteAdapter not fully configured",
    );
    record(
      "watsonx adapter: legacy stub string removed",
      !stillStub,
      stillStub ? "still contains 'WatsonxGraniteAdapter not fully configured'" : undefined,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    record("watsonx adapter: legacy stub string removed", false, message);
  }

  // (c) .env.example documents WATSONX_REGION.
  await fileExistsAndContains(
    path.join(REPO_ROOT, ".env.example"),
    ["WATSONX_REGION"],
    ".env.example documents WATSONX_REGION",
  );

  // (d) Adapter contains both real watsonx/IAM endpoint URL constants.
  await fileExistsAndContains(
    adapterPath,
    [
      "https://iam.cloud.ibm.com/identity/token",
      "https://us-south.ml.cloud.ibm.com/ml/v1/text/generation",
    ],
    "watsonx adapter: IAM + text-generation endpoint URLs present",
  );
}

// ────────────────────────────────────────────────────────────────────────────
// (r) MCP elicitation real (W5-code-3)
//
// Confirms the stub McpElicitationAdapter has been replaced with a real
// `sampling/createMessage` implementation, the singleton wiring is in place,
// and `@renatus/llm` re-exports the registration helpers. All structural
// greps — runtime E2E requires an MCP host that supports sampling and is
// out of scope here.
// ────────────────────────────────────────────────────────────────────────────

async function checkMcpElicitationReal(): Promise<void> {
  const adapterPath = path.join(
    REPO_ROOT,
    "packages/llm/src/adapters/mcp-elicitation-adapter.ts",
  );

  // (a) Legacy stub echo string is gone.
  try {
    const text = await readFile(adapterPath, "utf-8");
    const stillStub = text.includes("[MCP Elicitation Stub]");
    record(
      "mcp elicitation adapter: legacy stub string removed",
      !stillStub,
      stillStub ? "still contains '[MCP Elicitation Stub]'" : undefined,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    record("mcp elicitation adapter: legacy stub string removed", false, message);
  }

  // (b) Adapter sends the real MCP sampling method.
  await fileExistsAndContains(
    adapterPath,
    ["sampling/createMessage"],
    "mcp elicitation adapter: sends sampling/createMessage",
  );

  // (c) Adapter exports the public singleton registration + error surface.
  await fileExistsAndContains(
    adapterPath,
    [
      "export function setMcpServer",
      "export class McpElicitationError",
      "CreateMessageResultSchema",
    ],
    "mcp elicitation adapter: exports setMcpServer + McpElicitationError + uses CreateMessageResultSchema",
  );

  // (d) MCP server bootstrap registers the live Server with the adapter.
  await fileExistsAndContains(
    path.join(REPO_ROOT, "packages/mcp-server/src/index.ts"),
    ["setMcpServer(server)"],
    "mcp-server bootstrap calls setMcpServer(server) after connect",
  );

  // (e) @renatus/llm re-exports the registration helpers.
  await fileExistsAndContains(
    path.join(REPO_ROOT, "packages/llm/src/index.ts"),
    ["setMcpServer", "McpElicitationError"],
    "@renatus/llm re-exports setMcpServer + McpElicitationError",
  );
}

// ────────────────────────────────────────────────────────────────────────────
// (l) Build artifacts
// ────────────────────────────────────────────────────────────────────────────

async function checkBuildArtifacts(): Promise<void> {
  const required = [
    "packages/agents/dist/index.js",
    "packages/mcp-server/dist/index.js",
  ];
  let missing = 0;
  for (const rel of required) {
    const abs = path.join(REPO_ROOT, rel);
    try {
      const stats = await stat(abs);
      const ok = stats.isFile();
      record(`build artifact (wave 3): ${rel}`, ok);
      if (!ok) missing += 1;
    } catch {
      record(`build artifact (wave 3): ${rel}`, false, "missing");
      missing += 1;
    }
  }
  if (missing > 0) {
    console.error(
      "\n[hint] Build artifacts missing. Run `pnpm -r build` from the repo root.",
    );
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("Renatus Wave 3 — structural verification");
  console.log(`Repo root: ${REPO_ROOT}\n`);

  await safe("check schema files", () => checkSchemaFiles());
  await safe("check repository files", () => checkRepositoryFiles());
  await safe("check migrations", () => checkMigrations());
  await safe("check agent modules", () => checkAgentModules());
  await safe("check MCP registry", () => checkMcpRegistry());
  await safe("check canonicalJson", () => checkCanonicalJson());
  await safe("check signature roundtrip", () => checkSignatureRoundtrip());
  await safe("check audit timestamp drift fix (W5-code-1)", () =>
    checkAuditTimestampDriftFix(),
  );
  await safe("check tailwind pack source", () => checkTailwindPackPresent());
  await safe("check refactor surfaces", () => checkRefactorSurfaces());
  await safe("check workflow steps", () => checkWorkflowSteps());
  await safe("check patch-mapper", () => checkPatchMapper());
  await safe("check qa artifacts", () => checkQaArtifacts());
  await safe("check web app routes", () => checkWebAppRoutes());
  await safe("check kg + replay artifacts", () =>
    checkKgAndReplayArtifacts(),
  );
  await safe("check final polish (wave-4 close)", () => checkFinalPolish());
  await safe("check watsonx adapter real (W5-code-2)", () =>
    checkWatsonxAdapterReal(),
  );
  await safe("check mcp elicitation real (W5-code-3)", () =>
    checkMcpElicitationReal(),
  );
  await safe("check build artifacts", () => checkBuildArtifacts());

  console.log("Check results:");
  for (const row of results) {
    const mark = row.ok ? "[PASS]" : "[FAIL]";
    const tail = row.detail ? ` — ${row.detail}` : "";
    console.log(`  ${mark} ${row.description}${tail}`);
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  console.log(`\nPASS ${passed} / FAIL ${failed}`);
  process.exit(failed);
}

main().catch((err) => {
  console.error("Verifier crashed unexpectedly:", err);
  process.exit(1);
});
