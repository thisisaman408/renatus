# Renatus — State of the Build (post-Wave 4)

**Updated:** 2026-05-17  
**Verifier:** `pnpm verify:wave-3` → **146 PASS / 0 FAIL** (59 Wave 2 regression + 87 Wave 3+4 structural checks; the wave-3 leg now contains all Wave-4 web / KG / replay / polish checks)  
**Roadmap clock:** ~H37 of 48 (Wave 4 closed; entering Wave 5 — final demo + submission).

This document is the authoritative snapshot of what's built. Read it before
touching anything. Companions: `SYSTEM-DESIGN.md` (target architecture v4),
`IMPLEMENTATION-ROADMAP.md` (48-hour hour-by-hour plan), `WAVE-2-PROGRESS-NOTES.md`
+ `WAVE-3-PROGRESS-NOTES.md` + `WAVE-4-PROGRESS-NOTES.md` (per-wave completion records).

---

## 1. What Renatus is (one paragraph)

Renatus is an audit-grade platform for LLM-driven code changes. It wraps any
LLM that touches code, indexes the repo into Postgres, hands the LLM the right
context, runs the proposed patches in a sandbox, and ships a cryptographically
signed audit report. Four agents share one engine: **Migrate**, **Refactor**,
**Security Audit**, **Codebase Q&A** — they differ only in the rule source the
Cartographer reads. Two entry surfaces: a **Model Context Protocol server** (Bob
IDE, Claude Code, Cursor, Windsurf drive it) and a **standalone web app**
(visitors run any agent end-to-end using Renatus's own LLM providers).

The three claims:
1. **The LLM is not the product.** Any LLM can already migrate / refactor /
   find CVEs / answer questions. Renatus wraps it.
2. **The wrapper is the product.** Signed audit, isolated sandbox, persistent
   replayable state, cached cross-user knowledge, knowledge graph over the repo.
   Every claim Renatus makes is auditable.
3. **The wrapper is portable AND turnkey.** Any MCP-compliant client drives the
   engine using *their* LLM; the standalone web app drives the engine using
   *its own* providers (Groq, Gemini, watsonx). End users never bring a key.

---

## 2. What's complete

### 2.1 Layer-by-layer inventory

```
┌─────────────────────────────────────────────────────────────────────────┐
│ Transport          stdio MCP server + Next.js HTTP/SSE (Wave 4)        │
│ Controllers        15 MCP tools (canonical pattern, withAudit wrapper) │
│ Application        Inngest workflows: migrate · refactor ·             │
│                    security-audit · qa (4 of 4)                        │
│ Domain agents      Cartographer (2 paths) │ Indexer │ Retrieval        │
│                    Surgeon │ Examiner │ Auditor (ed25519, canonical)   │
│                    QaService (read-only, signed transcripts)           │
│ LLM                LlmRouter + 5 adapters (Groq/Gemini/Vercel-GW real; │
│                    watsonx + MCP-elicitation stubs)                    │
│ Adapters           GitHubAdapter (simple-git + file:// fixtures)       │
│ Repositories       14 typed Drizzle repos                              │
│ Data               Postgres + Drizzle (6 migrations applied);          │
│                    NO pgvector yet (semantic retrieval deferred)       │
│ Web                Next.js 16 App Router; /run /jobs /audit /verify    │
│                    /kg /replay + 4 shortcut routes; WebContainers      │
└─────────────────────────────────────────────────────────────────────────┘
Cross-cutting: Zod everywhere · audit_events append-only · ed25519+sha256
+ canonicalJson · KEK-encrypted private keys (when RENATUS_KEK is set)
```

### 2.2 Agents (5 of 5 backend agents shipped)

| Agent | Class | What it does | LLM used? |
|---|---|---|---|
| GitHubAdapter | `GitHubAdapter` | Clones repo via `simple-git` (HTTPS/git@) or `fs.cp` (file://). Persists `repo_snapshots`. Emits `clone_started/completed/failed`. | No |
| Cartographer Path A | `Cartographer.planFromPack` | Looks up bundled rule packs by `(ecosystem, package?, fromMajor, toMajor)`. Returns `Rule[]` deterministically. sha256-cached. | No |
| Cartographer Path B | `Cartographer.planFromSource` | LLM-driven. Accepts changelog text / diff / URL / refactor-intent / CVE advisory. Emits structured `Rule[]` via system prompts + Zod-validate-with-retry (max 2). sha256-cached. | Yes |
| Indexer | `Indexer.index` | Walks snapshot, parses TS/TSX/JS/JSX with ts-morph, persists `files` + `imports` (edges) + `symbols`. | No |
| RetrievalService | `RetrievalService.retrieve` | Runs rule detectors against indexed files, expands via recursive-CTE on `imports`, union-find clusters into coherent batches. | No |
| Surgeon | `SurgeonService.migrateBatch` | Per-batch LLM call with `responseFormat: 'file-replacement'`. ts-morph syntactic validation (TS parser error codes 1000-1999). Retry-with-feedback (max 2). Confidence scoring (0.85/0.7/0.5/0.3). | Yes |
| Examiner | `ExaminerService.examineBatch` | Per-patch LLM call. Framework detection (vitest/jest/mocha/playwright; default vitest). Strategies: snapshot / property / cve-replay. ts-morph syntactic validation. Retry max 2. | Yes |
| Auditor | `AuditorService.audit` | Reads `audit_events` for jobId. Computes typed `AuditReport` summary. Signs with **ed25519 over `canonicalJson(report)`**. Persists keypair in `signing_keys` (KEK-encrypted if `RENATUS_KEK` set). Empty audit is valid (doesn't throw). Static `verifySignature` re-canonicalizes + enforces `messageHash` match. | No |

### 2.3 Workflows (Inngest)

Four registered workflows in `packages/agents/src/_orchestrator/`:

1. **`migrate_workflow`** (`renatus/migrate.requested`):
   ```
   workflow_started → clone → index → cartograph → retrieve →
   patch-batch-0..N (parallel) → finalize → examine → audit → done
   ```
   State machine: `cloning → cloned → indexing → indexed → planning → planned
   → patching → patched → testing → tested → auditing → audited → done`.

2. **`refactor_workflow`** (`renatus/refactor.requested`):
   Same shape; Cartographer Path B with `sourceKind='refactor-intent'`.

3. **`security_audit_workflow`** (`renatus/security-audit.requested`):
   Same shape; Cartographer Path B with `sourceKind='cve-advisory'`; CVE id
   sources fetched from NVD inline before Path B runs.

4. **`qa_workflow`** (`renatus/qa.requested`):
   Read-only; `clone → index → retrieve → answer → sign-transcript`. No
   Surgeon, no Examiner, no Auditor. Transcripts persist to `qa_transcripts`
   and are signed with the same ed25519 keypair as audit reports.

Heavy clients (repos, LlmRouter, adapters) are instantiated **inside each
`step.run`** — Inngest re-runs individual steps on a fresh process, so outer
closures couple replays to wall-clock identity.

### 2.4 MCP tools (15 registered)

| Tool | Tier | Purpose |
|---|---|---|
| `ping` | smoke | Connectivity test |
| `llm_test` | smoke | Verify LlmRouter routes to a real provider |
| `cartograph_repository` | back-compat | Wraps `Cartographer.plan` (Path A, returns `MigrationPlan`) |
| `plan_change` | per-phase | Cartographer Path A OR Path B via `mode: 'pack' \| 'source'` discriminated input |
| `clone_repository` | atomic | `GitHubAdapter.clone` |
| `index_repository` | atomic | `Indexer.index` |
| `find_affected_files` | atomic | `RetrievalService.retrieve` |
| `propose_patch` | atomic | `SurgeonService.migrateBatch` (+ optional persist) |
| `apply_patch` | atomic | Writes `Patch.after` to disk + flips status to `applied` |
| `examine` | atomic | `ExaminerService.examineBatch` |
| `audit_repository` | atomic | `AuditorService.audit` |
| `migrate_repository` | tier-1 | Tier-1 entry — creates job, fires Inngest event |
| `refactor_repository` | tier-1 | Tier-1 entry for refactor flow |
| `security_audit_repository` | tier-1 | Tier-1 entry for CVE-driven security audit flow |
| `query_codebase` | tier-1 | Tier-1 entry for read-only Q&A flow (signed transcript) |

Every tool is wrapped with `withAudit('<name>', ...)`. Inputs validated with Zod
at dispatch. Inconsistent tool patterns are gone — every tool exports an
`*InputSchema` + an async `*Tool(input, databaseUrl)` function mirroring
`propose-patch.ts`.

### 2.5 Database (12 tables, 5 migrations)

`packages/db/drizzle/`:
- `0000_busy_starfox.sql` — `mcp_sessions`, `tool_invocations`, `jobs`, `web_jobs`
- `0001_third_harrier.sql` — `migration_plans`
- `0002_familiar_nitro.sql` — `repo_snapshots`, `files`, `imports`, `symbols`,
  `breaking_change_maps`, `breaking_changes`, `patches` + `agent_kind` column
  on jobs + recursive-CTE-friendly `(to_file_id, from_file_id)` btree
- `0003_greedy_ultron.sql` — `audit_events` (append-only) + 4 indexes
- `0004_colorful_doctor_faustus.sql` — `generated_tests`
- `0005_nasty_human_cannonball.sql` — `signing_keys` (KEK-encrypted)

The `imports` table's recursive CTE (`KnowledgeGraphRepository.findFilesTransitivelyImporting`)
is load-bearing — `RetrievalService` uses it to fan out coherent file batches.

### 2.6 Rule packs (2 bundled, registry pattern)

- **React 18 → 19** (5 rules): `useRef()` init arg, `defaultProps` removal,
  string ref removal, `ReactDOM.render` removal, PropTypes removal.
- **Tailwind 3 → 4** (5 rules): CSS `@import`, opacity utilities, shadow
  renames, default border color, transform/filter implicit.

Registry at `packages/agents/src/cartographer/index.ts`'s `BUNDLED_PACKS` —
adding a third pack is one row.

### 2.7 Fixtures

- `test-repos/fixture-react-18/` (8 files) — all 5 React rules detect their
  target files.
- `test-repos/fixture-tailwind-3/` (4 files) — all 5 Tailwind rules detect.

### 2.8 Bob extension surfaces (4 of 4 agent surfaces complete)

- ✅ `bob-extensions/modes/migration.md` + `commands/migrate.md`
- ✅ `bob-extensions/modes/refactor.md` + `commands/refactor.md`
- ✅ `bob-extensions/modes/security-audit.md` + `commands/security-audit.md`
- ✅ `bob-extensions/modes/ask-codebase.md` + `commands/ask-codebase.md`
- ✅ `bob-extensions/skills/migrate-codebase.md` (single skill covering all 4 agents — agent-picker table maps user intent → tool)
- ✅ `bob-extensions/mcp-config.example.json` (explicit `_tier1_tools` + `_tier2_tools` informational keys + the `mcpServers.renatus` block)

### 2.9 Audit chain (the demo prop)

End-to-end signed audit chain works:
1. Every agent calls `emitAuditEvent(repo, event)` at phase boundaries (the
   never-throws helper). Event taxonomy: `<scope>_<verb_past>` —
   `clone_started`, `patch_proposed`, `cartograph_completed`, `workflow_completed`,
   etc.
2. `AuditorService.audit` reads all events for the jobId, builds a typed
   `AuditReport`, serializes with `canonicalJson()` (deterministic key sort,
   cycle-safe), hashes with sha256, signs with ed25519.
3. Signing keys persist in `signing_keys`; AES-256-GCM via scrypt-derived key
   from `RENATUS_KEK` (plaintext fallback + warning if KEK unset).
4. `AuditorService.verifySignature(report, sig)` re-canonicalizes, re-hashes,
   verifies — and also enforces that the signature's claimed `messageHash`
   matches the recomputed hash (defense against signatures-over-different-messages).

Verifier round-trips both happy and tampered paths in-memory (no DB needed).

### 2.10 LLM providers (router + 5 adapters)

`packages/llm/`:
- ✅ `GroqAdapter` (real, `@ai-sdk/groq`, llama-3.3-70b-versatile)
- ✅ `GeminiAdapter` (real, `@ai-sdk/google`, gemini-2.0-flash-exp, 1M context)
- ✅ `VercelAiGatewayAdapter` (real, OpenAI-compatible endpoint)
- ✅ `McpElicitationAdapter` (real, Wave 5 — issues `sampling/createMessage`
  against the live MCP `Server` via a process-level singleton registered by
  the mcp-server bootstrap; gated behind `MCP_ENABLE_ELICITATION=true` so
  stand-alone callers skip it)
- ✅ `WatsonxGraniteAdapter` (real, Wave 5 — IAM token + watsonx text-generation
  REST; sponsor signal honored when `WATSONX_API_KEY` + `WATSONX_PROJECT_ID`
  are set)

`LlmRouter` routing policy: MCP elicitation > watsonx > Gemini (if context >
100k tokens) > Groq > Vercel AI Gateway. Throws if zero providers configured.

### 2.11 Verifiers

- `pnpm verify:wave-2` — 59 checks. No DB / no LLM keys required. Regression gate.
- `pnpm verify:wave-3` — runs wave-2 + Wave 3 structural checks + Wave 4
  agent / web / KG / replay / polish checks (schemas, repos, migrations,
  agent modules, MCP tool registry — full 15, canonicalJson roundtrip,
  ed25519 self-roundtrip + tamper test, Bob surfaces — all 4, workflow
  steps, web routes, KG + replay artifacts, README marker, Wave-4 notes).
  Currently **146/146 PASS**.
- `pnpm verify:wave-3:e2e` — chains the wave-2 e2e + Examiner + Auditor +
  signature roundtrip. Skips cleanly without `DATABASE_URL` + `GROQ_API_KEY`.

---

## 3. What's NOT done

### 3.1 Spec items deferred (acceptable per roadmap fallback matrix)

- **pgvector semantic retrieval** — Wave 3 H13-16 deliverable; per the roadmap
  this is **the first thing to cut** if time pressure hits. Structural CTE-based
  retrieval is sufficient for the demo. Skipped intentionally.
- **Sandbox-backed test execution** — Auditor's `runInSandbox` was a stub in
  Bob's first auditor cut; Task 12 removed the flag. Sandbox execution + the
  WebContainers replay route are **Wave 4** deliverables.

### 3.2 Wave 4 — ✅ COMPLETE

All five tasks shipped. Inventory in section 3.4 below.

- ✅ **Security Audit agent** — full workflow + tier-1 tool + Bob surfaces.
- ✅ **Codebase Q&A agent** — read-only pipeline + signed transcripts + Bob surfaces.
- ✅ **Web app** — `/run` tabbed picker, `/jobs/[jobId]` SSE stream, `/audit/[jobId]` signed report + in-browser verification widget, `/kg/[jobId]` 2D force graph, `/replay/[jobId]` WebContainers, `/verify` paste-and-check route, plus `/migrate` / `/refactor` / `/security` / `/qa` shortcut routes.
- ✅ **WebContainers replay** — boots a Node sandbox in the visitor's browser, installs deps, runs the migrated test suite live. No backend round-trip.
- ✅ **2D knowledge graph** — `react-force-graph-2d` rendering `(files, imports)` from the indexer with patch-batch-order animation.
- ✅ **README, mobile-degraded layouts, all 4 Bob surfaces, mcp-config.example.json explicit** — see section 3.4.

### 3.3 Manual deliverables outstanding (Wave 5)

- **Backup demo video** at H13 — not recorded. Wave 5 cuts a single final video instead (combined approach).
- **Final demo video** at H37 — Wave 5 deliverable. Verifier + web app + signed audit chain are the substance; the video is the wrapper.
- **`bob_sessions/` happy-path captures** for refactor + security + qa surfaces — partial today (`task_4_wave_2`, `task_5_wave_3`, `task_4_wave_2`); per-agent capture rolls into Wave 5.

### 3.4 Wave 4 deliverables (5 of 5 shipped)

1. **W4-1 — Security Audit agent.** `SecurityAuditService`, `qa-style`
   Inngest workflow, `security_audit_repository` tier-1 MCP tool, NVD
   advisory fetcher, `bob-extensions/modes/security-audit.md`, `bob-extensions/commands/security-audit.md`.
2. **W4-2 — Codebase Q&A agent.** `QaService`, `qa-repository.ts`
   Inngest workflow, `query_codebase` tier-1 MCP tool, `qa_transcripts`
   table + repository, `auditor/sign.ts` shared signing helpers,
   `bob-extensions/modes/ask-codebase.md`, `bob-extensions/commands/ask-codebase.md`.
3. **W4-3 — Web app.** `apps/web/app/page.tsx` landing rewrite,
   `/run` tabbed picker + 4 agent forms (`run-form.tsx`),
   `/migrate` / `/refactor` / `/security` / `/qa` shortcut routes,
   `/jobs/[jobId]` SSE live progress, `/audit/[jobId]` signed report +
   in-browser verification widget, `/verify` paste-and-check route,
   API: `/api/jobs/[agentKind]`, `/api/jobs/[jobId]/stream`,
   `/api/jobs/[jobId]/audit-report`, `/api/inngest`.
4. **W4-4 — Knowledge graph + WebContainers replay.** `/kg/[jobId]`
   (react-force-graph-2d, patch-batch-order animation, static SVG
   fallback), `/replay/[jobId]` (@webcontainer/api, cross-origin
   isolation headers in `next.config.ts`), `/api/jobs/[jobId]/replay-tree`.
5. **W4-5 — Polish + final wiring (this task).** README rewrite leading
   with the platform pitch, `mcp-config.example.json` with explicit
   `_tier1_tools` + `_tier2_tools` informational keys, mobile-degraded
   layouts in `globals.css` (`@media (max-width: 640px)` tabs scroll
   horizontally, signature dl collapses to single column, patch diff
   stacks), `:focus-visible` keyboard rings, landing page aria-labels,
   STATE-OF-RENATUS.md updated to post-Wave-4 baseline,
   `WAVE-4-PROGRESS-NOTES.md` added, verifier extended with 10 new
   Wave-4 polish checks.

---

## 4. File inventory (additions and changes since Wave 1 baseline)

```
packages/shared/src/
  agent.ts                 — AgentKindSchema
  canonical-json.ts        — canonicalJson() — deterministic JSON
  llm-adapter.ts           — LlmAdapter interface
  migration.ts             — MigrationRuleSchema (with kind:'migration' default)
  patch.ts                 — PatchSchema, PatchBatchSchema, PatchStatusSchema
  rule.ts                  — RuleSchema discriminated union + RuleSourceSchema
  schemas.ts               — Ecosystem, Severity, JobState, Confidence
  snapshot.ts              — SnapshotSchema, FileRecordSchema, ImportEdgeSchema, SymbolRecordSchema
  index.ts                 — barrel

packages/db/src/schema/
  audit-events.ts          — append-only event log
  breaking-change-maps.ts  — Cartographer cache (cache_key UNIQUE)
  breaking-changes.ts      — polymorphic Rule[] payload
  files.ts                 — indexer output
  generated-tests.ts       — Examiner output
  imports.ts               — edge table (with composite btree)
  jobs.ts                  — + agent_kind column
  mcp-sessions.ts          — already existed
  migration-plans.ts       — legacy; Path A output
  patches.ts               — Surgeon output
  repo-snapshots.ts        — per-job clones
  signing-keys.ts          — ed25519 keypair persistence
  symbols.ts               — top-level symbols
  tool-invocations.ts      — already existed
  web-jobs.ts              — already existed

packages/db/src/repositories/
  audit-event-repository.ts        — append-only (no UPDATE/DELETE methods)
  breaking-change-map-repository.ts — neon-serverless Pool for transaction
  file-repository.ts
  import-repository.ts
  job-repository.ts                 — + markCompleted(id)
  knowledge-graph-repository.ts     — recursive CTE
  mcp-session-repository.ts
  migration-plan-repository.ts
  patch-repository.ts               — + getById()
  signing-key-repository.ts
  snapshot-repository.ts
  symbol-repository.ts
  test-repository.ts
  tool-invocation-repository.ts

packages/db/drizzle/
  0000_busy_starfox.sql              — base tables (Wave 1)
  0001_third_harrier.sql             — migration_plans (Wave 2)
  0002_familiar_nitro.sql            — snapshot/files/imports/symbols/breaking*/patches (Wave 2)
  0003_greedy_ultron.sql             — audit_events (Wave 3)
  0004_colorful_doctor_faustus.sql   — generated_tests (Wave 3)
  0005_nasty_human_cannonball.sql    — signing_keys (Wave 3)

packages/agents/src/
  _orchestrator/
    client.ts                — Inngest client
    functions.ts             — [migrateRepository, refactorRepository]
    migrate-repository.ts    — full pipeline workflow
    refactor-repository.ts   — full pipeline workflow
    patch-mapper.ts          — PatchRow → Patch
  audit-events/
    emit.ts                  — emitAuditEvent, createEmitter
  auditor/
    errors.ts
    index.ts                 — ed25519 + canonical JSON + KEK
    kek.ts                   — AES-256-GCM encrypt/decrypt
    types.ts                 — AuditReportSchema, SignatureSchema
  cartographer/
    index.ts                 — Path A (planFromPack) + Path B (planFromSource)
    prompts.ts               — per-agentKind system prompts
    rules/
      react-18-to-19.ts      — 5 rules
      tailwind-3-to-4.ts     — 5 rules
    types.ts
  examiner/
    errors.ts
    index.ts                 — framework detect + LLM test gen + retry
    prompts.ts               — per-framework × per-strategy
  github/
    adapter.ts               — clone (simple-git OR fs.cp)
    index.ts
  indexer/
    index.ts                 — ts-morph walk + persist
  retrieval/
    index.ts                 — union-find clustering
  surgeon/
    errors.ts
    index.ts                 — LLM patch + ts-morph validate + retry + confidence
    prompts.ts               — per-agentKind system prompts
  index.ts                   — barrel

packages/llm/src/
  adapters/
    gemini-adapter.ts        — real
    groq-adapter.ts          — real
    mcp-elicitation-adapter.ts — real (sampling/createMessage, gated by MCP_ENABLE_ELICITATION)
    vercel-ai-gateway-adapter.ts — real
    watsonx-granite-adapter.ts — real (IAM + watsonx text-generation REST)
  llm-router.ts              — routing policy
  index.ts

packages/mcp-server/src/
  audit.ts                   — withAudit() higher-order wrapper
  index.ts                   — server bootstrap + tool registry
  tools/
    apply-patch.ts
    audit-repository.ts
    cartograph.ts
    clone-repository.ts
    examine.ts
    find-affected-files.ts
    index-repository.ts
    llm-test.ts
    migrate-repository.ts
    ping.ts
    plan-change.ts
    propose-patch.ts
    refactor-repository.ts

packages/sandbox/src/
  adapters/
    vercel-sandbox-adapter.ts — stub (reserved for Wave 4)
    webcontainers-adapter.ts  — stub (reserved for Wave 4)
  index.ts                    — getSandboxAdapter() factory (unused today)
  sandbox-adapter.ts          — interface

apps/web/
  app/
    layout.tsx
    page.tsx                 — landing stub
    replay-test/page.tsx     — EMPTY (Wave 1 deliverable skipped; Wave 4 fills)
  next.config.ts             — cross-origin isolation headers (for WebContainers)
  package.json

bob-extensions/
  modes/
    migration.md
    refactor.md
  commands/
    migrate.md
    refactor.md
  skills/
    migrate-codebase.md
  mcp-config.example.json

scripts/
  secret-scan.sh
  verify-wave-2-e2e.ts        — clone→...→patch (skips without keys)
  verify-wave-2-structural.ts — 57 checks
  verify-wave-3-e2e.ts        — chains wave-2 e2e + Examiner + Auditor
  verify-wave-3-structural.ts — 41 checks

test-repos/
  fixture-react-18/           — 8 files, all 5 React rules detect
  fixture-tailwind-3/         — 4 files, all 5 Tailwind rules detect

bob_sessions/
  task_1_implementation_plan/
  task_2_wave_1/
  task_3_wave_1_continue/
  task_4_wave_2/
  task_5/                     — auditor (first cut, hardened in Task 12)

WAVE-1-BUILD-SUMMARY.md
WAVE-1-CLOSURE-NOTES.md
WAVE-2-PROGRESS-NOTES.md
WAVE-3-PROGRESS-NOTES.md
SYSTEM-DESIGN.md              — v4 spec
IMPLEMENTATION-ROADMAP.md     — v4 hour-by-hour plan
AGENTS.md                     — short orientation
README.md                     — still migration-focused; update in Wave 4
```

---

## 5. Verification commands

```bash
# Structural (no DB, no LLM keys required) — the regression gate
pnpm install
pnpm -r type-check                      # all 7 packages
pnpm -r build                           # all 7 packages
pnpm verify:wave-2                      # 59/59 PASS — Wave 2 regression gate
pnpm verify:wave-3                      # 146/146 PASS — chains wave-2 + Wave 3 + Wave 4 polish

# End-to-end (requires DATABASE_URL + GROQ_API_KEY + applied migrations)
cd packages/db && pnpm db:migrate       # applies 0000-0006
cd ../..
pnpm verify:wave-3:e2e                  # runs the full pipeline against fixture
```

---

## 6. Quality bar (what "production-grade" means here)

Wave 1 + 2 + 3 set the bar; Wave 4 must match or exceed:

1. **Zod schemas are runtime validator AND the type source.** No drift between
   shape definition and what the agent expects.
2. **Every repository takes `databaseUrl` in its constructor.** neon-http for
   single-statement queries; neon-serverless Pool only when `db.transaction()`
   is needed.
3. **Errors are named subclasses** (`CartographerLlmValidationError`,
   `SurgeonValidationError`, `ExaminerValidationError`, `AuditorError`,
   etc.). Callers can `instanceof`-check.
4. **Retry loops extend the LLM conversation, they don't reset it.**
   `messages.push({role:'assistant', content:badOutput})` then
   `messages.push({role:'user', content:feedback})`.
5. **ts-morph parses filter to syntactic errors only** (TypeScript parser
   error codes 1000-1999), not semantic errors. The LLM can't type-check the
   whole project; we only require parseable output.
6. **Determinism**: temperature 0.1; sorted outputs; sha256 cache keys;
   canonical JSON for signed payloads.
7. **No `any`** without a `// rationale: ...` comment justifying it.
8. **No TODO stubs, no placeholders, no "rough cut"** in production code.
   Either build it real or call out the omission explicitly and leave it out.
9. **MCP tools mirror `propose-patch.ts` exactly** — `*InputSchema` + async
   `*Tool(input, databaseUrl)` function; registered via 3-touchpoint pattern
   in `mcp-server/src/index.ts` (import + ListToolsRequestSchema entry +
   CallToolRequestSchema dispatch + `withAudit` wrap).
10. **Audit emission never throws.** `emitAuditEvent` swallows errors so a
    failed audit log can't fail the workflow.

If you're tempted to violate any of these, stop. Either build it right or
flag the deviation and move on.

---

*End of state document. See `WAVE-4-PLAN.md` for what comes next.*
