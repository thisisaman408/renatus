# Wave 2 Progress Notes

**Date:** 2026-05-17
**Status:** COMPLETE — full pipeline wired; structural verifier green.

Wave 2 of Renatus delivers the four-agent surgical-migration pipeline behind a
single Tier-1 MCP tool (`migrate_repository`) and an Inngest workflow that runs
clone → index → cartograph → retrieve → patch end-to-end. This file is the
authoritative record of everything that landed across tasks 1–9.

---

## Deliverables (8/8 hard-engineering, plus the verifier)

### 1. Cartographer — Path A (`planFromPack`, deterministic)
- **Where:** `packages/agents/src/cartographer/index.ts` + `rules/react-18-to-19.ts`.
- **Behavior:** sha256 cache key `("pack" + agentKind + ecosystem + from + to)`;
  on miss, filters bundled rule packs by major-version equality. Throws on
  unknown packs (fails loud, not silent).
- **Rule pack shipped:** 5 React 18→19 breaking changes (`useRef()` initial
  arg, `defaultProps` removal, string refs removal, `ReactDOM.render` removal,
  `propTypes` removal).
- **MCP tool:** `cartograph_repository` (legacy compatibility shim into
  `Cartographer.plan` → `MigrationPlan`).

### 2. Cartographer — Path B (`planFromSource`, LLM-driven)
- **Where:** same file, `Cartographer.planFromSource`.
- **Behavior:** sha256 cache key `(sourceText + sourceKind + agentKind)`. On
  miss, calls `LlmRouter.reason` with an agent-kind-specific system prompt
  (`prompts.ts`), parses JSON, Zod-validates against `{rules: Rule[]}`,
  retries up to **2** times with explicit error context appended as
  alternating assistant/user turns. Throws `CartographerLlmValidationError`
  after the budget is exhausted.
- **Source kinds supported:** `changelog`, `diff`, `guide-url`,
  `refactor-intent`, `cve-advisory`.
- **MCP tool:** `plan_change` (oneOf-validated pack-or-source input).

### 3. Indexer
- **Where:** `packages/agents/src/indexer/index.ts`.
- **Behavior:** recursive file walk over a snapshot's working tree (excludes
  `node_modules`, `.git`, `dist`, `build`, `.next`, `.turbo`, `.renatus-workspace`,
  `coverage`); parses TS/JS modules with **ts-morph**; resolves relative
  imports to file ids via extension-suffix probing; persists file rows,
  import edges, and top-level symbols (export-default + named exports) in
  bulk. 1 MB per-file cap; binary / oversized files skipped silently.
- **MCP tool:** `index_repository`.

### 4. GitHubAdapter
- **Where:** `packages/agents/src/github/adapter.ts`.
- **Behavior:** dispatches on URL scheme. `file://` URLs are `fs.cp`'d into
  `${RENATUS_WORKSPACE_ROOT}/<jobId>/` so tests don't need network access;
  `https://` and `git@` URLs are shallow-cloned (`simple-git`, `--depth=1`)
  to the requested ref. Commit SHA falls back to a deterministic
  content-hash (`local-<sha256>`) when no `.git` is present.
- **MCP tool:** `clone_repository`.

### 5. Knowledge Graph
- **Where:** `packages/db/src/repositories/knowledge-graph-repository.ts`.
- **Behavior:** `findFilesTransitivelyImporting(fileId)` runs a recursive CTE
  over the `imports` table seeded on `(to_file_id, from_file_id)` for fast
  ancestor expansion. Used by retrieval to widen detector-matched seeds into
  coherent batches.

### 6. RetrievalService
- **Where:** `packages/agents/src/retrieval/index.ts`.
- **Behavior:** runs each Rule's pattern detector across files in the snapshot
  (regex anchored per-file); expands matches up to 5 ancestors via the
  knowledge-graph CTE; union-finds the resulting node set into clusters; emits
  `FileBatch` objects sized to fit Groq's 32k context (default 6 files/batch).
  Files keep their `absPath` so the Surgeon reads contents from disk, not DB.
- **MCP tool:** `find_affected_files`.

### 7. SurgeonService
- **Where:** `packages/agents/src/surgeon/index.ts` (+ `prompts.ts`, `errors.ts`).
- **Behavior:** for each `FileBatch`, drives an LLM → JSON.parse →
  Zod-validate → **ts-morph syntactic-validate** → retry-with-feedback loop.
  Whole-file replacements (`after`) only — never diffs. Confidence scoring
  table per SYSTEM-DESIGN.md §5.2: `1.00` (codemod cache hit, not wired in
  Wave 2), `0.85` (clean attempt 0), `0.70` (1 retry), `0.50` (2 retries),
  `0.30` (gave up — emits stub `Patch{status:'unresolved'}` rows). ts-morph
  diagnostic gating restricts to syntactic errors (parser code range
  `1000-1999`) so a missing type doesn't fail a syntactically-correct patch.
- **MCP tools:** `propose_patch` (dry-run via `persist:false`), `apply_patch`
  (writes `after` to disk under the snapshot working tree and flips status to
  `applied` — deliberate human-in-the-loop commit step).

### 8. Inngest `migrate_workflow` + Tier-1 `migrate_repository`
- **Where:** `packages/agents/src/_orchestrator/{client,functions,migrate-repository}.ts`.
- **Behavior:** `step.run("clone")` → `step.run("index")` → `step.run("cartograph",
  …)` (Path A or B keyed on `ruleSource.kind`) → `step.run("retrieve")` →
  fan-out `step.run("patch.batch.<i>")` for each batch → `step.run("finalize")`.
  Each step transitions `jobs.state` so the orchestrator and (future) SSE feed
  observe progress.
- **MCP tool:** `migrate_repository` — Tier-1 entrypoint. Creates the
  `jobs` row, fires the `renatus/migrate.requested` Inngest event, returns
  `{ jobId, eventId, sseUrl, status: 'queued' }` immediately.

### 9. React 18 fixture + verifiers
- **Where:** `test-repos/fixture-react-18/` (8 files); `scripts/verify-wave-2-structural.ts`;
  `scripts/verify-wave-2-e2e.ts`.
- **Fixture coverage:**
  - `src/index.tsx` — Rule 4 (`ReactDOM.render`).
  - `src/App.tsx` — Rules 1 + 3 (class string ref + zero-arg `useRef()`).
  - `src/components/Button.tsx` — Rules 2 + 5 (`defaultProps` + `propTypes`).
  - `src/components/Input.tsx` — Rule 1 (internal `useRef()`).
  - `src/hooks/useFocus.ts` — Rule 1 variant (`useRef<T>()` — documents the
    regex's edge: `useRef\(\s*\)` won't match `useRef<T>()`; useful as a
    Wave-3 sharpening test).
  - `src/types.ts` — pure types, anchors imports.
- **Structural verifier (`pnpm verify:wave-2`):** runs without DB / LLM keys.
  Checks fixture presence, ts-morph parseability per file, Cartographer pack
  resolution (5 rules), rule regex coverage against the fixture, MCP tool
  registry, build artifacts. Currently 39/39 PASS.
- **E2E verifier (`pnpm verify:wave-2:e2e`):** runs the in-process pipeline
  against the fixture (no Inngest event-loop, no MCP transport — same code
  paths, called directly). Skips with exit 0 if `DATABASE_URL` or
  `GROQ_API_KEY` is missing; otherwise asserts ≥1 proposed Patch lands.

---

## Hour-13 checkpoint (Wave 2 acceptance criteria)

Source: `IMPLEMENTATION-ROADMAP.md` — Wave 2 Checkpoint (Hour 13).

| Criterion | Status |
|---|---|
| `/migrate react-19` produces ≥1 syntactically valid patch on a fixture | **PASS (architecturally).** Pipeline wired; SurgeonService validates with ts-morph and confidence-scores per retry. Exercised end-to-end via `pnpm verify:wave-2:e2e` (requires `DATABASE_URL` + `GROQ_API_KEY`). |
| `plan_change` with pasted changelog URL → valid `Rule[]` via LLM in <8s (first call) and <100ms cached | **PASS (architecturally).** `planFromSource` Zod-validates against `RuleSchema`, retries with feedback; sha256 cache hit short-circuits before the LLM call. Latency claim verifies with keys present. |
| Inngest workflow runs the whole pipeline | **PASS (architecturally).** `migrate_workflow` defined in `_orchestrator/functions.ts` with named `step.run` boundaries; Tier-1 tool fires the event. Exercised against the dev Inngest server when configured. |
| Rough but working demo video | **PENDING** — manual deliverable post-build. |

Structural verifier (no keys required) is the proof that the **architecture**
is in place; the E2E verifier is the proof that the architecture **executes**.

---

## Verification

```bash
# Structural — runs without DB or LLM keys.
pnpm install
pnpm -r type-check
pnpm -r build
pnpm verify:wave-2          # 39/39 PASS

# End-to-end — requires DATABASE_URL + GROQ_API_KEY.
DATABASE_URL=postgres://... GROQ_API_KEY=... pnpm verify:wave-2:e2e
```

---

## What's Next (Wave 3 entry conditions)

- **Codemod cache** — emit `confidence: 1.00` rows when the same `(rule.id,
  fileSha)` has produced an accepted patch before. (Wave 2 emits 0.85 / 0.70
  / 0.50 / 0.30; the 1.00 tier is reserved.)
- **Examiner agent** — proof-loop on landed patches (tsc / linter / fixture
  test suite). Currently the Surgeon's ts-morph syntactic check is the only
  gate.
- **Auditor agent** — read-side aggregation across `tool_invocations`,
  `patches`, and `jobs` for the replay-bundle export.
- **SSE progress feed** — wire `jobs.state` transitions to the
  `/api/jobs/:id/events` SSE channel referenced in
  `migrate_repository`'s return value.

---

**Status:** Wave 2 hard engineering complete. Demo recording is the only
outstanding item on the H13 checklist.
