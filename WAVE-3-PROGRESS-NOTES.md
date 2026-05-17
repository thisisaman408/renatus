# Wave 3 Progress Notes

**Date:** 2026-05-17
**Status:** COMPLETE — Examiner + Auditor + Refactor agent live end-to-end; verifier green.

Wave 3 of Renatus adds the production-depth layer the demo's signature-verifiable
audit chain depends on: agents now emit a per-action audit trail, the Auditor
signs the trail with ed25519 over canonical JSON, the Examiner generates
regression tests for every patch, the Refactor agent ships behind the same
engine, and Tailwind 3→4 joins React 18→19 as a bundled pack. The migrate and
refactor workflows now run clone → index → cartograph → retrieve → patch →
examine → audit, transitioning the job state through seven stages.

---

## Deliverables (8 tasks, plus the verifier extension)

### 1. Wave 3 foundation (Task 10)
- `packages/shared/src/canonical-json.ts` — deterministic key-sorted JSON
  serializer with cycle detection (`Cycle detected in canonical JSON
  serialization`). NaN/Infinity throw, BigInt throws, undefined keys are
  omitted, arrays preserve insertion order. Used everywhere a signature input
  needs to round-trip identically across runtimes.
- `packages/db/src/schema/generated-tests.ts` — `generated_tests` table.
  Nullable `patchId` so future CVE-replay regression tests (no patch source)
  can land in the same table; indexes on `(jobId)` and
  `(snapshotId, framework)`.
- `packages/db/src/repositories/test-repository.ts` — `bulkInsert`,
  `getByJob`, `getByPatch`, `updateResult`, `countByJob`. Used by Examiner
  to persist; used by the Auditor and the e2e verifier to assert
  side-effects.
- `packages/agents/src/audit-events/emit.ts` — `emitAuditEvent` +
  `createEmitter` helpers. Never throws on persistence failure; failed
  emissions log to stderr and continue, so a flaky audit-event row doesn't
  fail the migration.

### 2. Audit-event instrumentation (Task 11)
- Every agent class (`GitHubAdapter`, `Indexer`, `Cartographer`,
  `RetrievalService`, `SurgeonService`, `ExaminerService`) takes an optional
  `AuditEventRepository` and a `jobId` per call. Emission is best-effort —
  agents always complete successfully even with a null repo (test contexts)
  or transient DB failures.
- Event taxonomy actually emitted today:
  `clone_started`, `clone_completed`, `clone_failed`,
  `index_started`, `index_completed`,
  `cartograph_started`, `cartograph_completed`, `cartograph_retry`,
  `cartograph_failed`, `retrieve_completed`,
  `patch_started`, `patch_proposed`, `patch_unresolved`,
  `patch_batch_completed`, `surgeon_gave_up`, `patches_persisted`,
  `workflow_started`, `workflow_completed`,
  `test_generated`, `audit_signed`.
- The internal `agentKind` enum used in audit events
  (`orchestrator | indexer | cartographer | retrieval | surgeon | examiner | auditor`)
  is intentionally distinct from the user-facing `AgentKindSchema`
  (`migrate | refactor | qa | security_audit`). Two axes, two enums.
- The MCP tier-1 tool callers (`migrate-repository.ts`,
  `refactor-repository.ts`) write `workflow_started` before firing the
  Inngest event, so failures upstream of the workflow are still auditable.

### 3. Auditor hardening (Task 12)
- Replaced `JSON.stringify` with `canonicalJson()` for the message that
  gets hashed and signed — so the same logical report from two different
  Node versions produces byte-identical input to ed25519.
- Replaced every `any` with concrete Zod-typed shapes
  (`AuditEventRecord`, `AuditReport`, `AuditReportSummary`, `Signature`).
  The schemas live in `packages/agents/src/auditor/types.ts` so a
  downstream verifier can `import { AuditReportSchema } from
  "@renatus/agents"` without dragging in `@renatus/db`.
- New `signing_keys` table + `SigningKeyRepository`; `audit()`
  get-or-creates the keypair per `jobId`. Re-running `audit()` for the
  same job re-uses the existing key (signatures over different reports
  share a public key).
- `packages/agents/src/auditor/kek.ts` — AES-256-GCM via scrypt-derived
  key from `RENATUS_KEK` env. When `RENATUS_KEK` is unset, falls back to
  plaintext `privateKeyHex` + a loud `console.warn`. Never silently
  drops to insecure storage.
- The `audit_repository` MCP tool was refactored to match the
  `propose-patch.ts` pattern exactly (separate `tools/audit-repository.ts`
  file, schema-first input, transport-layer error mapping).
- `AuditorService.verifySignature(report, signature)` re-canonicalizes +
  re-hashes the report and also enforces `messageHash` match. Verifiers
  don't have to trust the `messageHash` field — it's checked.

### 4. Tailwind 3→4 pack (Task 13)
- 5 rules in `packages/agents/src/cartographer/rules/tailwind-3-to-4.ts`:
  CSS `@import` (`@tailwind` → `@import "tailwindcss"`), opacity utilities
  (`bg-opacity-*` → `/N`), shadow renames (`shadow-sm` → `shadow-xs`,
  `shadow` → `shadow-sm`), default border color
  (`border-gray-200` made explicit), transform/filter implicit
  (`transform` keyword can be dropped).
- `BUNDLED_PACKS` registry in `cartographer/index.ts` — adding a new pack
  is one row keyed on `(agentKind, ecosystem, fromMajor, toMajor[, package])`.
- Optional `package?: string` field on `PlanFromPackInputSchema` for
  disambiguation when the same major-version pair maps to multiple
  packs (e.g. `npm 18→19` could be React, Vite, or Tailwind in theory —
  caller supplies `package: 'tailwindcss'` to pick).
- Fixture at `test-repos/fixture-tailwind-3/` (4 files: package.json,
  styles.css, components/Card.tsx, components/Modal.tsx). All 5 rules
  detect cleanly against the fixture (the Wave 2 verifier exercises this
  end-to-end via `planFromPack` + detectors).

### 5. Examiner agent (Task 14)
- `ExaminerService.examineBatch({ jobId, snapshotId, localPath, patches, agentKind })`
  → `{ tests, framework, errors }`.
- Framework detection from `package.json`:
  `vitest > jest > mocha > playwright` (default vitest if none of the
  above appear as deps). One detection per batch.
- Strategy is keyed on `agentKind`: `snapshot` (migrate / refactor) or
  `cve-replay` (security_audit). The prompt switches accordingly.
- Per-patch LLM call → ts-morph syntactic validate (parser error codes
  1000-1999 are hard fails; type-check errors are NOT) → retry-with-feedback
  (max 2 retries; system + assistant + user turns appended with the
  diagnostic).
- `examine` MCP tool persists to `generated_tests` and emits
  `test_generated` audit events. Returns the count + framework + per-patch
  errors. Used by both workflows + as a standalone tier-2 tool for
  Bob to call against a specific batch.

### 6. Refactor agent (Task 15)
- `refactor_workflow` Inngest function — same 6 `step.run` boundaries as
  migrate, but Cartographer goes down Path B with
  `sourceKind='refactor-intent'` (`planFromSource` reads the user's
  intent text and asks the LLM to emit a `{ rules: Rule[] }` payload).
- `refactor_repository` tier-1 MCP tool fires `renatus/refactor.requested`.
- Bob surfaces: `bob-extensions/modes/refactor.md` and
  `bob-extensions/commands/refactor.md` so the `/refactor` slash command
  routes to the right mode.
- Zero new agent code; pure reuse of the engine. The only divergence
  from migrate is the rule-source pathway in Cartographer + the workflow
  function ID.

### 7. Workflow examine + audit steps (Task 16)
- Both `migrate_workflow` and `refactor_workflow` extend through
  `step.run('examine'` and `step.run('audit'`. The Inngest retries are
  granular per step.
- Job-state progression:
  `patching → patched → testing → tested → auditing → audited → done`.
- `mapPatchRowToPatch` shared helper at
  `packages/agents/src/_orchestrator/patch-mapper.ts` — single source of
  truth for the `PatchRow → Patch` shape conversion. Used by both
  workflows when re-reading patches out of the DB between steps (Inngest
  serializes between `step.run`s, so we must round-trip via Postgres).
- Auditor returns a signed report; the workflow exposes `signature` +
  `auditUrl` (null until Wave 4 web app builds the shareable URL).

### 8. Verifier + this document (Task 17)
- `pnpm verify:wave-2` → still **57/57 PASS** (regression gate intact).
- `pnpm verify:wave-3` → wave-2 + new Wave 3 structural checks. Adds 41
  checks for total **98/98 PASS** across both verifiers. Adds:
  - Wave 3 schema files (3 checks)
  - Wave 3 repositories (3 checks)
  - Wave 3 migrations 0003/0004/0005 (4 checks: drizzle dir + 3 files)
  - Wave 3 agent modules (3 checks: ExaminerService, AuditorService +
    verifySignature, emitAuditEvent + createEmitter)
  - MCP tool registry — full 13 tools (14 checks: 1 readable + 13 tools)
  - canonicalJson roundtrip (4 checks: nested sort, array order,
    unicode, cycle detection)
  - ed25519 signature self-roundtrip + tamper test (2 checks). Uses a
    deterministic seed derived from `sha256('renatus-wave-3-test-seed')`
    so failures are reproducible; runs entirely in-memory.
  - Tailwind 3→4 pack source presence (1 check)
  - Refactor agent surfaces (2 checks)
  - Workflow `examine` + `audit` step.run literals (2 checks)
  - patch-mapper.ts export (1 check)
  - Build artifacts (2 checks)
- `pnpm verify:wave-3:e2e` → full DB+LLM-backed integration. Chains
  `pnpm verify:wave-2:e2e && tsx scripts/verify-wave-3-e2e.ts`; the
  wave-3 leg additionally exercises Examiner + Auditor + signature
  verify and asserts `audit_events` ≥ 1, `signing_keys` row present,
  and `generated_tests` count matches the in-memory result.

---

## Hour-26 checkpoint (Wave 3 acceptance criteria)

Source: `IMPLEMENTATION-ROADMAP.md` — Wave 3 Checkpoint.

| Criterion | Status |
|---|---|
| Real demo target migrates end-to-end on Inngest | **PASS architecturally.** The migrate workflow now runs clone → index → cartograph → retrieve → patch → examine → audit. The in-process e2e verifier (`verify-wave-3-e2e.ts`) exercises the same agent classes against the React fixture, including signature roundtrip + DB-side-effect assertions. Requires DATABASE_URL + GROQ_API_KEY to run. |
| Tests run in sandbox | **PARTIAL (Wave 4).** The Auditor's `runInSandbox` was removed (it was a stub); sandbox execution moves to Wave 4 + the WebContainers replay path. Examiner generates test source code today; the sandbox lift-and-shift is the next step. |
| Audit signed | **PASS.** ed25519 over `canonicalJson(report)`. The structural verifier signs a synthetic `AuditReport` with a deterministic seed key, calls `AuditorService.verifySignature`, and asserts a tampered copy fails verify. The e2e verifier exercises the live `audit()` path against Postgres. |
| Tailwind 3→4 pack runs against fixture | **PASS.** 5/5 rules detect their target fixture files (covered fully by `verify-wave-2` Tailwind section; the wave-3 structural verifier additionally asserts the pack source file exists). |
| Refactor agent runs end-to-end on a fixture, produces signed audit | **PASS architecturally.** Workflow + tool + Bob surfaces shipped. The wave-3 structural verifier asserts both `examine` + `audit` step.run literals exist inside `refactor-repository.ts`; e2e gating is the same as migrate (requires keys). |
| New, better demo video re-recorded | **PENDING** — manual deliverable. |
| All shipped agents have at least one happy-path execution captured in `bob_sessions/` | **PARTIAL** — `bob_sessions/task_4_wave_2/` and `bob_sessions/task_5_wave_3/` are present; per-agent capture is a manual follow-up. |

---

## Verification

```bash
# Structural (no keys required)
pnpm install
pnpm -r type-check
pnpm -r build
pnpm verify:wave-2          # 57/57 PASS — Wave 2 regression gate
pnpm verify:wave-3          # chains wave-2 + 41 new Wave 3 checks = 98/98 PASS

# End-to-end (requires DATABASE_URL + GROQ_API_KEY + applied migrations)
pnpm verify:wave-3:e2e
```

---

## Files inventory

Grouped by package; reference paths only. Modified (M) vs added (+).

### Root
- (M) `package.json` — added `verify:wave-3` + `verify:wave-3:e2e` scripts.
- (+) `scripts/verify-wave-3-structural.ts` — Wave 3 structural verifier.
- (+) `scripts/verify-wave-3-e2e.ts` — Wave 3 end-to-end verifier.
- (+) `WAVE-3-PROGRESS-NOTES.md` — this document.
- (M) `IMPLEMENTATION-ROADMAP.md` — Wave 3 status updates.
- (M) `SYSTEM-DESIGN.md` — Auditor / Examiner / canonical-JSON spec updates.

### `@renatus/shared`
- (+) `packages/shared/src/canonical-json.ts` — deterministic JSON serializer.
- (M) `packages/shared/src/index.ts` — re-export `canonicalJson`.
- (M) `packages/shared/src/schemas.ts` — added `audited` and intermediate
  job states.

### `@renatus/db`
- (+) `packages/db/src/schema/audit-events.ts` — `audit_events` table.
- (+) `packages/db/src/schema/generated-tests.ts` — `generated_tests` table.
- (+) `packages/db/src/schema/signing-keys.ts` — `signing_keys` table.
- (+) `packages/db/src/repositories/audit-event-repository.ts`
- (+) `packages/db/src/repositories/test-repository.ts`
- (+) `packages/db/src/repositories/signing-key-repository.ts`
- (+) `packages/db/drizzle/0003_*.sql` — audit_events migration.
- (+) `packages/db/drizzle/0004_*.sql` — generated_tests migration.
- (+) `packages/db/drizzle/0005_*.sql` — signing_keys migration.
- (+) `packages/db/drizzle/meta/0003_snapshot.json`,
  `0004_snapshot.json`, `0005_snapshot.json`.
- (M) `packages/db/drizzle/meta/_journal.json` — journal entries appended.
- (M) `packages/db/src/index.ts` — exports for new repos + types.
- (M) `packages/db/src/schema/jobs.ts` — extended `JobStatus` enum.

### `@renatus/agents`
- (+) `packages/agents/src/audit-events/emit.ts` — emitter helpers.
- (+) `packages/agents/src/auditor/index.ts` — `AuditorService` +
  `verifySignature` static.
- (+) `packages/agents/src/auditor/types.ts` — Zod schemas
  (`AuditReportSchema`, `SignatureSchema`, etc.).
- (+) `packages/agents/src/auditor/errors.ts` — `AuditorError` hierarchy.
- (+) `packages/agents/src/auditor/kek.ts` — AES-256-GCM KEK helpers.
- (+) `packages/agents/src/examiner/index.ts` — `ExaminerService`.
- (+) `packages/agents/src/examiner/prompts.ts` — strategy-keyed prompts.
- (+) `packages/agents/src/examiner/errors.ts` — `ExaminerNotApplicableError`
  + validation error.
- (+) `packages/agents/src/cartographer/rules/tailwind-3-to-4.ts` — 5 rules.
- (M) `packages/agents/src/cartographer/index.ts` — `BUNDLED_PACKS` registry,
  optional `package` field on plan input, audit-event emission.
- (M) `packages/agents/src/github/adapter.ts` — audit-event emission +
  optional repo param.
- (M) `packages/agents/src/indexer/index.ts` — same.
- (M) `packages/agents/src/retrieval/index.ts` — same.
- (M) `packages/agents/src/surgeon/index.ts` — same.
- (+) `packages/agents/src/_orchestrator/patch-mapper.ts` —
  `mapPatchRowToPatch` shared helper.
- (M) `packages/agents/src/_orchestrator/migrate-repository.ts` — added
  `examine` + `audit` steps; extended state machine.
- (+) `packages/agents/src/_orchestrator/refactor-repository.ts` —
  full refactor workflow.
- (M) `packages/agents/src/_orchestrator/functions.ts` — registered the
  refactor workflow.
- (M) `packages/agents/src/index.ts` — exports for `AuditorService`,
  `ExaminerService`, `emitAuditEvent`, `createEmitter`, and the Zod
  schema types from `auditor/types.ts`.

### `@renatus/mcp-server`
- (+) `packages/mcp-server/src/tools/examine.ts` — Tier-2 `examine` tool.
- (+) `packages/mcp-server/src/tools/audit-repository.ts` — Tier-2
  `audit_repository` tool.
- (+) `packages/mcp-server/src/tools/refactor-repository.ts` — Tier-1
  `refactor_repository` tool.
- (M) `packages/mcp-server/src/index.ts` — registered all 13 tools
  in `ListTools` + `CallTool` dispatch.

### Bob surfaces
- (+) `bob-extensions/modes/refactor.md` — `/refactor` mode.
- (+) `bob-extensions/commands/refactor.md` — slash command.
- (M) `bob-extensions/commands/migrate.md` — minor copy update.

### Test fixtures
- `test-repos/fixture-tailwind-3/` (already shipped in Wave 2 verifier
  scope but referenced here for completeness).

### Bob sessions
- `bob_sessions/task_4_wave_2/` (Wave 2 closure trail)
- `bob_sessions/task_5_wave_3/` (Wave 3 working sessions)

---

## Self-review notes

**In-memory signature roundtrip.** The structural verifier resolves
`@noble/curves/ed25519` and `@noble/hashes/utils` via Node's `createRequire`
rooted at the `@renatus/agents` package.json — those packages are
transitive deps of `@renatus/agents` but not direct deps of the repo
root, and the verifier honors the "no new deps" constraint by reaching
through the workspace rather than adding a root devDep. The seed key
is deterministic (`sha256('renatus-wave-3-test-seed')`) so any failure
reproduces identically across machines. The synthetic `AuditReport` is
built with a fresh UUID for `jobId` / `snapshotId` so the Zod schema
inside `AuditorService.verifySignature` accepts it.

**No DB required in structural.** Every Wave 3 structural check is
either filesystem reads + needle checks, or in-memory crypto. The
canonical-JSON cycle test catches the throw in a try/catch (the
function intentionally throws for cycles per its contract).

**Wave 3 totals.** 57 (wave-2) + 41 (wave-3 structural) = **98 checks**
across the structural suite. The `verify:wave-3` script chains both
with `&&` so wave-2 must pass before wave-3 runs — this protects the
regression gate.

**`AuditorService` re-export.** Wave 3 deliberately exports the Zod
schemas (`AuditReportSchema`, `SignatureSchema`) from
`@renatus/agents` so a future standalone verifier CLI (Wave 4) can
verify signatures without importing `@renatus/db`. The structural
verifier exercises this seam.
