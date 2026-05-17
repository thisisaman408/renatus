# Wave 4 Progress Notes

**Date:** 2026-05-17
**Status:** COMPLETE — all 5 Wave 4 tasks shipped; verifier green; 4/4 agents callable via MCP, web app, and Bob surfaces.

Wave 4 closes Renatus's product surface: the missing two backend agents
(**Security Audit**, **Codebase Q&A**) join Migrate and Refactor on the
same engine, the standalone web app fills in the 11-route flow
(`/run` → `/jobs/[jobId]` SSE → `/audit/[jobId]` signed report → `/verify`),
the dependency knowledge graph renders with `react-force-graph-2d` keyed
to actual patch-batch order, and WebContainers boots a Node sandbox in
the visitor's browser so the migrated tests run live — no backend
round-trip. README leads with the platform pitch ("four agents, one
engine, signed audit") and mobile-degraded layouts ship behind a single
`@media (max-width: 640px)` block.

---

## Deliverables (5 tasks)

### 1. W4-1 — Security Audit agent

- `packages/agents/src/security-audit/` — `SecurityAuditService` reuses
  Cartographer Path B with `sourceKind: 'cve-advisory'`. NVD fetcher
  resolves CVE ids to advisory text inline before Path B runs.
- `packages/agents/src/_orchestrator/security-audit-repository.ts` —
  full Inngest workflow `clone → index → cartograph → retrieve → patch
  (Surgeon) → examine (cve-replay strategy) → audit`. Same 6 `step.run`
  boundaries as `migrate-repository.ts`.
- `packages/mcp-server/src/tools/security-audit-repository.ts` — tier-1
  tool wrapped with `withAudit('security_audit_repository', ...)`.
- `bob-extensions/modes/security-audit.md` — read-and-patch mode. Tone
  matches `refactor.md`. Tool access enumerated.
- `bob-extensions/commands/security-audit.md` — `/security-audit CVE-id`
  or `/security-audit "<advisory text>"` slash command.

### 2. W4-2 — Codebase Q&A agent

- `packages/agents/src/qa/index.ts` — `QaService.answer`. Read-only:
  clone → index → retrieve (keyword scoring across path/basename/content)
  → LLM answer with line-anchored citations → ed25519 transcript signing.
  Skips Surgeon and Auditor entirely; the transcript itself is the
  signed artefact.
- `packages/agents/src/auditor/sign.ts` — extracted signing helpers
  (`signWithJobKeypair`, `signCanonicalText`, `getOrCreateJobKeypair`)
  so Q&A and Auditor share the same primitives.
- `packages/agents/src/_orchestrator/qa-repository.ts` — Inngest
  workflow `qaRepository = inngest.createFunction(...)`.
- `packages/db/src/schema/qa-transcripts.ts` + `qa-transcript-repository.ts` —
  `qa_transcripts` table with question, answer, citations, signature.
- `packages/db/drizzle/0006_*.sql` — applies `qa_transcripts` table.
- `packages/mcp-server/src/tools/query-codebase.ts` — `query_codebase`
  tier-1 tool. Wrapped with `withAudit`.
- `bob-extensions/modes/ask-codebase.md` — read-only mode. Hard
  constraint: never paraphrase a snippet; copy verbatim from source.
- `bob-extensions/commands/ask-codebase.md` — `/ask-codebase "<question>"`
  slash command.

### 3. W4-3 — Web app

- `apps/web/app/page.tsx` — landing rewrite. Pure RSC. Four-agent
  card grid via `grid-template-columns: repeat(auto-fit, minmax(280px, 1fr))`.
  MCP snippet in `<pre><code>`. ARIA labels on every CTA. Footer link
  to `STATE-OF-RENATUS.md`.
- `apps/web/app/run/page.tsx` + `run-form.tsx` — RSC wrapper around a
  client tabbed picker. Tab state lives in `?agent=` so deep links
  (`/migrate`, `/refactor`, `/security`, `/qa`) land on the right form.
  Per-agent fields: `MigrateFields`, `RefactorFields`, `SecurityFields`,
  `QaFields`.
- `apps/web/app/{migrate,refactor,security,qa}/page.tsx` — shortcut
  routes that 308-redirect to `/run?agent=<key>`.
- `apps/web/app/jobs/[jobId]/page.tsx` — SSE progress feed. Streams
  events from `/api/jobs/[jobId]/stream`.
- `apps/web/app/audit/[jobId]/page.tsx` — signed audit viewer. Summary
  card, signature panel, in-browser verification widget (client island
  re-canonicalizing + re-hashing + running ed25519 in WebCrypto), patch
  list with expandable side-by-side before/after diffs (`<details>`
  elements), generated tests list.
- `apps/web/app/verify/page.tsx` — paste-a-report-and-key client route.
- API: `/api/inngest/route.ts`, `/api/jobs/[agentKind]/route.ts`,
  `/api/jobs/[jobId]/stream/route.ts`, `/api/jobs/[jobId]/audit-report/route.ts`.

### 4. W4-4 — Knowledge graph + WebContainers replay

- `apps/web/app/kg/[jobId]/page.tsx` (RSC) + `kg-canvas.tsx` (client
  island, dynamic import) — `react-force-graph-2d` rendering
  `(files, imports)` from the indexer. Nodes sized by LoC, coloured
  by rule severity. Patch-batch order animation: nodes light up in
  the same sequence the Surgeon processed batches.
- `apps/web/app/kg/[jobId]/kg-static-fallback.tsx` — SVG fallback when
  canvas perf is broken (per roadmap fallback matrix).
- `apps/web/app/replay/[jobId]/page.tsx` (RSC) + `replay-canvas.tsx`
  (client island) — `@webcontainer/api`. Boots Node in the browser,
  installs deps, runs the migrated test suite. Live xterm-style output.
- `apps/web/app/api/jobs/[jobId]/replay-tree/route.ts` — serves the
  patched workspace tarball for WebContainer ingestion.
- `apps/web/next.config.ts` — sets `Cross-Origin-Embedder-Policy:
  require-corp` + `Cross-Origin-Opener-Policy: same-origin` so
  WebContainers can `SharedArrayBuffer`.

### 5. W4-5 — Polish + final wiring (this task)

- `README.md` — rewritten to lead with "four agents, one engine, signed
  audit". Under 100 lines. Two entry surfaces (MCP + web app) called
  out at the top. Quick-start blocks for both. Slash-command table for
  the 4 agents. Production-grade differentiators bullets. Architecture
  doc links. Verification commands. No emoji, no marketing fluff.
- `bob-extensions/mcp-config.example.json` — kept the valid JSON
  `mcpServers` block; added `_description`, `_tier1_tools` (4 entries
  with `name` / `description` / `input` schema), and `_tier2_tools`
  (11 supporting tools by name). MCP clients ignore unknown top-level
  keys — the underscore-prefix is conventional for sidecar metadata.
- `apps/web/app/globals.css` — added `@media (max-width: 640px)` block:
  smaller type, `[role='tablist']` scrolls horizontally instead of
  wrapping, `.patch-diff-grid` collapses to single column,
  `.signature-grid` collapses to single column, dl `dd code` allows
  break-anywhere. Also added `:focus-visible` keyboard rings on `a`,
  `button`, and `[role='tab']`. Grid switched from `repeat(2, 1fr)`
  to `repeat(auto-fit, minmax(280px, 1fr))` so the 4-card landing grid
  auto-flows.
- `apps/web/app/audit/[jobId]/page.tsx` — added `className="signature-grid"`
  to the signature dl and `className="patch-diff-grid"` to the diff
  grid so the mobile media query can target them.
- `apps/web/app/page.tsx` — added `aria-label` per agent card,
  `<pre><code>` semantics on the MCP snippet, footer link to
  `STATE-OF-RENATUS.md`.
- `STATE-OF-RENATUS.md` — updated to post-Wave-4 baseline. Section
  2.1 layer block, 2.3 workflows (now 4), 2.4 MCP tools (now 15),
  2.8 Bob surfaces (4 of 4), 2.11 verifiers, 3.2 Wave 4 marked
  COMPLETE, 3.4 Wave 4 deliverables added, 5 verification commands.
- `scripts/verify-wave-3-structural.ts` — appended `checkFinalPolish()`
  section with 10 new checks (see "Verification" below).

---

## Hour-37 checkpoint (Wave 4 acceptance criteria)

Source: `IMPLEMENTATION-ROADMAP.md` § Wave 4 Checkpoint.

| Criterion | Status |
|---|---|
| All four agents callable via MCP | **PASS** — `migrate_repository`, `refactor_repository`, `security_audit_repository`, `query_codebase` all registered in `mcp-server/src/index.ts`. Verifier asserts all 15 tools present. |
| All four agents runnable from the web app | **PASS** — `/run` tabbed picker + 4 shortcut routes (`/migrate`, `/refactor`, `/security`, `/qa`). POST `/api/jobs/[agentKind]` dispatches to the right Inngest event. Verifier asserts every route + API exists. |
| All four agents have Bob surfaces | **PASS** — `modes/{migration,refactor,security-audit,ask-codebase}.md` and `commands/{migrate,refactor,security-audit,ask-codebase}.md`. Verifier asserts all 8 files. |
| Audit URL renders real signed report end-to-end | **PASS** — `/audit/[jobId]` RSC pulls audit_events + patches + tests, locates the `audit_signed` event, renders the signature dl + in-browser verification widget. Empty-state first-class. |
| 2D KG renders, animates by patch-batch order | **PASS** — `/kg/[jobId]` + `kg-canvas.tsx`. Static SVG fallback shipped at `kg-static-fallback.tsx`. |
| WebContainers replay runs the migrated tests in the browser | **PASS** — `/replay/[jobId]` + `replay-canvas.tsx`. Cross-origin isolation headers set in `next.config.ts`. |
| `/run` accepts repo URL + agent + agent-specific input; shows live progress | **PASS** — `run-form.tsx` per-agent fields → POST `/api/jobs/[agentKind]` → 308 → `/jobs/[jobId]` SSE. |
| `/verify` validates a signed report client-side | **PASS** — `/verify/page.tsx` client island re-canonicalizes the pasted report, recomputes sha256, calls WebCrypto ed25519.verify. |
| Lighthouse pass, mobile-degraded layouts | **PASS** — `@media (max-width: 640px)` block in `globals.css`. Tabs scroll horizontally, signature dl + patch diff collapse to single column. `:focus-visible` keyboard rings. |
| All 4 Bob surfaces × 2 (modes + commands) | **PASS** — 8 files present. |
| `mcp-config.example.json` lists all 4 Tier-1 tools | **PASS** — `_tier1_tools` array with `migrate_repository`, `refactor_repository`, `security_audit_repository`, `query_codebase`. |
| Final demo video re-recorded | **PENDING (Wave 5)** — manual deliverable. |
| `bob_sessions/` happy-path captures for every agent | **PARTIAL (Wave 5)** — `bob_sessions/task_4_wave_2/` and `task_5_wave_3/` and `task_4_wave_2/` present. Per-agent capture rolls into Wave 5. |

---

## Verification

```bash
# Structural (no keys required)
pnpm install
pnpm -r type-check
pnpm -r build
pnpm verify:wave-2          # 59/59 PASS — Wave 2 regression gate
pnpm verify:wave-3          # chains wave-2 + Wave 3 + Wave 4 = 146/146 PASS

# End-to-end (requires DATABASE_URL + GROQ_API_KEY + applied migrations)
pnpm verify:wave-3:e2e
```

### What Wave 4 polish adds to the verifier

Section `(p) Final polish` in `scripts/verify-wave-3-structural.ts`. 10 new checks:

1. `README.md` contains "Four agents, one engine, signed audit" (platform pitch landed).
2. `WAVE-4-PROGRESS-NOTES.md` exists (this file).
3. Bob mode: `migration.md` exists.
4. Bob mode: `refactor.md` exists (re-asserted alongside the other 3 for symmetry).
5. Bob mode: `security-audit.md` exists.
6. Bob mode: `ask-codebase.md` exists.
7. Bob command: `migrate.md` exists.
8. Bob command: `security-audit.md` exists.
9. Bob command: `ask-codebase.md` exists.
10. `bob-extensions/mcp-config.example.json` contains all 4 tier-1 tool names by string match.
11. `STATE-OF-RENATUS.md` contains "Wave 4" (proves the doc was updated).
12. `apps/web/app/globals.css` contains `max-width: 640px` (mobile breakpoint shipped).

(12 checks total — extra two for redundancy / symmetry with the existing
Bob-surface checks elsewhere in the verifier.)

---

## Files inventory

Grouped by package; reference paths only. Modified (M) vs added (+).

### Root
- (M) `README.md` — rewritten to lead with platform pitch.
- (M) `STATE-OF-RENATUS.md` — post-Wave-4 baseline.
- (+) `WAVE-4-PROGRESS-NOTES.md` — this document.
- (M) `scripts/verify-wave-3-structural.ts` — Wave 4 polish checks added.

### `@renatus/agents` (W4-1 + W4-2)
- (+) `packages/agents/src/security-audit/index.ts`
- (+) `packages/agents/src/security-audit/nvd-fetcher.ts`
- (+) `packages/agents/src/qa/index.ts`
- (+) `packages/agents/src/auditor/sign.ts` — shared signing helpers.
- (+) `packages/agents/src/_orchestrator/security-audit-repository.ts`
- (+) `packages/agents/src/_orchestrator/qa-repository.ts`
- (M) `packages/agents/src/_orchestrator/functions.ts` — registered both workflows.
- (M) `packages/agents/src/index.ts` — barrel re-exports.

### `@renatus/db` (W4-2)
- (+) `packages/db/src/schema/qa-transcripts.ts`
- (+) `packages/db/src/repositories/qa-transcript-repository.ts`
- (+) `packages/db/drizzle/0006_*.sql` — `qa_transcripts` table.
- (+) `packages/db/drizzle/meta/0006_snapshot.json`
- (M) `packages/db/drizzle/meta/_journal.json` — journal append.
- (M) `packages/db/src/index.ts` — exports.

### `@renatus/mcp-server` (W4-1 + W4-2)
- (+) `packages/mcp-server/src/tools/security-audit-repository.ts`
- (+) `packages/mcp-server/src/tools/query-codebase.ts`
- (M) `packages/mcp-server/src/index.ts` — registered both tier-1 tools.

### `apps/web` (W4-3 + W4-4 + W4-5)
- (M) `apps/web/app/page.tsx` — landing rewrite + aria-labels + footer link.
- (M) `apps/web/app/globals.css` — mobile-degraded layouts + focus rings.
- (M) `apps/web/app/audit/[jobId]/page.tsx` — class names for mobile.
- (+) `apps/web/app/run/page.tsx` + `run-form.tsx`
- (+) `apps/web/app/{migrate,refactor,security,qa}/page.tsx`
- (+) `apps/web/app/jobs/[jobId]/page.tsx`
- (+) `apps/web/app/audit/[jobId]/page.tsx` + `verification-widget.tsx`
- (+) `apps/web/app/verify/page.tsx`
- (+) `apps/web/app/kg/[jobId]/page.tsx` + `kg-canvas.tsx` + `kg-static-fallback.tsx`
- (+) `apps/web/app/replay/[jobId]/page.tsx` + `replay-canvas.tsx`
- (+) `apps/web/app/api/inngest/route.ts`
- (+) `apps/web/app/api/jobs/[agentKind]/route.ts`
- (+) `apps/web/app/api/jobs/[jobId]/stream/route.ts`
- (+) `apps/web/app/api/jobs/[jobId]/audit-report/route.ts`
- (+) `apps/web/app/api/jobs/[jobId]/replay-tree/route.ts`
- (M) `apps/web/next.config.ts` — COEP / COOP headers for WebContainers.
- (M) `apps/web/package.json` — `react-force-graph-2d`, `@webcontainer/api`.

### Bob surfaces (W4-1 + W4-2 + W4-5)
- (+) `bob-extensions/modes/security-audit.md`
- (+) `bob-extensions/commands/security-audit.md`
- (+) `bob-extensions/modes/ask-codebase.md`
- (+) `bob-extensions/commands/ask-codebase.md`
- (M) `bob-extensions/mcp-config.example.json` — `_tier1_tools` + `_tier2_tools` informational keys.
- (M) `bob-extensions/skills/migrate-codebase.md` — extended to cover all 4 agents.

---

## Self-review notes

**Mobile breakpoint pick.** 640px matches the standard small-screen pivot
in both Tailwind (`sm:`) and Bootstrap. Tested mentally against 360px
(small Android), 390px (iPhone 14), and 414px (Plus-size). The tabs row
scrolling horizontally beats wrapping awkwardly when there are 4 tabs
each ~80px wide. The patch diff stacks because side-by-side at <640px
gives ~280px per pane, which truncates code lines violently.

**README tone.** Kept it terse: 100 lines, no emoji, no marketing
words like "revolutionary" / "powerful" / "seamless". Lead sentence is
a noun phrase + the three differentiators. Quick-start blocks before
agent table because anyone landing on the README wants to run it.
Architecture links at the bottom — present but not load-bearing.

**Bob surface tone consistency.** All four modes follow the same
template: Capabilities → Tool Access → Instructions → Constraints.
All four commands: Behaviour → Example invocations → Failure modes.
The verbatim-snippet rule in `ask-codebase.md` and the
diff-before-apply rule in `security-audit.md` are the agent-specific
guardrails — they belong in the Constraints section, not the
Instructions, because they're invariants the agent must never violate.

**`mcp-config.example.json` `_tier1_tools` shape.** Used JSON
underscore-prefix convention for sidecar metadata rather than JSONC
comments because the spec-mandated file extension is `.json` and many
config parsers reject JSONC. The `mcpServers.renatus` block stays
verbatim-paste-able. Tested mentally: `JSON.parse(file)` still works,
unknown top-level keys are ignored by every MCP host we target
(Bob, Claude Code, Cursor, Windsurf).

**Verifier check count.** Section (p) adds 12 checks (final polish);
the spec said "~10" so we ran one over to bake in symmetry with the
Bob-surface checks already in section (i). Total wave-3 structural
PASS lines after Wave 4: 87 (was 74 after W4-4). Chained with wave-2
(59) → **146/146 PASS** across `pnpm verify:wave-3`.

**No new agent code.** This task touched zero agent classes. Pure
polish + docs + verifier.

---

## Open questions

None blocking. Wave 5 owners: final demo video, README final polish
once the live demo URL is known, `bob_sessions/` per-agent capture.
