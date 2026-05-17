# Wave 4 — Plan + first Bob prompt

**Updated:** 2026-05-17
**Roadmap source:** `IMPLEMENTATION-ROADMAP.md` § Wave 4 (Hour 26-37).
**State:** `STATE-OF-RENATUS.md` (read first if you haven't).

This document maps Wave 4 work into concrete Bob tasks. It is the playbook for
the next ~11 hours. The first task is fully briefed at the bottom — copy-paste
to Bob to start.

---

## 1. Wave 4 goal (one paragraph)

Two more agents land (**Security Audit**, **Codebase Q&A**) using the same
engine — the engine is ready. The standalone **web app** comes alive: 4 agent
forms on `/run`, signed audit page at `/audit/[jobId]`, in-browser test replay
at `/replay/[jobId]` via **WebContainers**, and a 2D **knowledge graph** at
`/kg/[jobId]` whose animation order = actual patch-batch order from the Surgeon
run. All 4 Bob extension surfaces (modes + commands + skill) ship. By the end
of Wave 4, every claim the demo arc makes is clickable.

---

## 2. Wave 4 breakdown (5 tasks, ~11 hours total)

| #              | Task                                                                                                                                                                                                                                                                                                                  | Roadmap hours | Why it matters                                                                                                   |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------- |
| **W4-1** | **Security Audit agent** — `security_audit_workflow` + `security_audit_repository` tier-1 MCP tool + Bob surfaces + (optional) NVD fetch for CVE ids                                                                                                                                                       | H26-28 (~2h)  | Completes the "four shipping agents" claim. Pure reuse — Cartographer Path B already supports `cve-advisory`. |
| **W4-2** | **Codebase Q&A agent** — `qa_workflow` (read-only: clone → index → retrieve → answer → sign-transcript) + `query_codebase` tier-1 MCP tool + `qa_transcripts` table + Bob surfaces                                                                                                                   | H28-29 (~1h)  | The free side-quest. Every piece of infrastructure already exists. Adds the 4th agent at minimal cost.           |
| **W4-3** | **Web app — 4 agent forms + audit page** — `/run` (tabbed agent picker), `/migrate`, `/refactor`, `/security`, `/qa` (pre-tuned routes), `/audit/[jobId]` (signed report + verification widget), `/jobs/[jobId]` (SSE live progress feed)                                                       | H29-32 (~3h)  | The standalone product surface. Judges without Bob run agents here.                                              |
| **W4-4** | **2D knowledge graph + WebContainers replay** — `/kg/[jobId]` (react-force-graph-2d driven by actual patch-batch order from the Surgeon run), `/replay/[jobId]` (StackBlitz WebContainers boots the patched workspace + runs `pnpm test` in-browser), `/verify` (paste a report + key, verify locally) | H32-36 (~4h)  | The visual hero of the demo. Judges watch tests go green in their own browser.                                   |
| **W4-5** | **Polish + final Bob surfaces** — Lighthouse pass, mobile-degraded layouts, all 4 modes + 4 commands + extended skill markdown, mcp-config.example.json updated, landing page rewrite ("four agents, one engine, signed audit")                                                                                | H36-37 (~1h)  | Last 5% — demo readiness.                                                                                       |

### Priorities (drop order under time pressure)

Per the roadmap's fallback matrix:

1. **NEVER cut Refactor.** Already shipped — safe.
2. **Q&A is the first thing to cut** if Wave 4 slips (saves ~1h).
3. **Security agent stays** because it's a "wow" demo beat and only ~2h of code.
4. **WebContainers replay** has a video-fallback path if the SDK fails in
   a visitor's browser — pre-record a `<video>` of the same flow.
5. **2D KG** falls back to a static `<svg>` of the same data if canvas perf
   is broken on the demo machine.

---

## 3. The first Bob task — copy-paste the prompt below

The very next prompt to send Bob. **W4-1 (Security Audit agent).** Self-contained.
Will land in ~2 hours of Bob's clock. Same engine reuse pattern as Refactor.

After Bob ships this and you've reviewed + corrected (using the Auditor task as
the reference for what to look for), the next prompt for **W4-2 (Q&A agent)**
will follow. Don't queue them — review one at a time.

---

## 4. Bob prompt for W4-1 (Security Audit agent)

Copy from `<<< START >>>` to `<<< END >>>` and paste into Bob as a new task.<<< START — Wave 4 Task 1: Security Audit agent >>>

```

# Renatus — read this before you touch anything

You are the engineer on Renatus, an audit-grade platform for LLM-driven code
changes. Hackathon submission for IBM Bob, deadline 17 May 2026.

## Read these files first, IN THIS ORDER

1. `STATE-OF-RENATUS.md` — authoritative snapshot of what's built. Read
   sections 2 (inventory) and 6 (quality bar) carefully. Skim the rest.
2. `WAVE-3-PROGRESS-NOTES.md` — the most recent completion record. Skim.
3. `IMPLEMENTATION-ROADMAP.md` — Wave 4 section (Hour 26-37). Read the
   "Hour 26-28: Security Audit agent" block carefully — that IS this task.
4. `packages/agents/src/_orchestrator/refactor-repository.ts` — the canonical
   pattern you'll mirror. Refactor was the last new agent shipped; same
   engine reuse, different rule source. Security Audit follows the SAME
   pattern. Read it end-to-end before writing a line.
5. `packages/mcp-server/src/tools/refactor-repository.ts` — the canonical
   tier-1 MCP tool pattern.
6. `bob-extensions/modes/refactor.md` + `bob-extensions/commands/refactor.md`
   — the canonical Bob surface pattern.

Do NOT touch `bob_sessions/`. Export your completed task to
`bob_sessions/task_N_security_audit_agent/` (markdown + screenshot) ONLY at
the end.

## What's already done (you do not rebuild any of this)

- Cartographer Path B (`Cartographer.planFromSource`) already supports
  `sourceKind: 'cve-advisory'` and `agentKind: 'security_audit'` — see
  `packages/agents/src/cartographer/index.ts` and
  `packages/agents/src/cartographer/prompts.ts`. The security-audit system
  prompt teaches the LLM to emit `MitigationRule[]` (kind: 'mitigation',
  category enum input-validation|output-encoding|access-control|crypto|sensitive-data|other,
  optional cveId / cweId). It works today via the existing `plan_change`
  MCP tool with `mode: 'source', sourceKind: 'cve-advisory'`.
- Surgeon already handles any `agentKind` — it just uses a different system
  prompt per agent.
- Examiner already supports `strategy: 'cve-replay'` when called with
  `agentKind: 'security_audit'` — it emits exploit-replay tests that should
  NOT trigger after the patch. See `packages/agents/src/examiner/prompts.ts`.
- Auditor agent-kind-agnostic — works for security_audit jobs out of the box.
- All 12 DB tables exist; no schema changes needed for this task.

## What you MUST build (zero new agent code; just orchestration)

### 1. `packages/agents/src/_orchestrator/security-audit-repository.ts`

Mirror `packages/agents/src/_orchestrator/refactor-repository.ts` exactly.
Differences:

- Inngest event name: `renatus/security-audit.requested`.
- Event payload schema:
  ```typescript
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
```

- Function id: `'security-audit-repository'`, name `'Security Audit Repository'`.
- All 6 step.run boundaries identical to refactor: workflow_started → clone
  → index → cartograph → retrieve → patch fan-out → finalize → examine → audit.
- The `cartograph` step calls `cartographer.planFromSource({ agentKind: 'security_audit', sourceKind: 'cve-advisory', sourceText: <fetched-or-pasted-advisory-text>, jobId, })`.
- **CVE id resolution (if `cveSource.kind === 'cve-id'`)**: fetch the advisory
  from NVD's public API:
  `https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=${cveId}`. Use
  `fetch` (Node 20+ has it built-in — no new dep). On 200 OK, extract the
  English description from
  `response.vulnerabilities[0].cve.descriptions.find(d => d.lang === 'en').value`
  and concatenate references, CWE list, CVSS score into a single advisory
  text block. On non-200 or network error, throw a clear error — DO NOT
  silently fall back to the bare CVE id (that defeats the point).

  Cache the NVD fetch result in `breaking_change_maps` automatically via
  Cartographer's existing sha256 cache key (the fetched advisory text is the
  sourceText). No new caching code needed.

  Implementation note: do the NVD fetch INSIDE the `cartograph` step.run so
  Inngest retries the network call on failure.
- `agentKind: 'security_audit'` passed to Surgeon and Examiner.
- The job row's `sourceVersion` / `targetVersion` columns get sentinels
  `'security'` (the schema requires non-null; matching how refactor uses
  `'refactor'`).

Export `securityAuditRepository` and `SecurityAuditRepositoryEvent` type.

### 2. Update `packages/agents/src/_orchestrator/functions.ts`

```typescript
import { migrateRepository } from './migrate-repository.js';
import { refactorRepository } from './refactor-repository.js';
import { securityAuditRepository } from './security-audit-repository.js';
export const functions = [migrateRepository, refactorRepository, securityAuditRepository];
```

### 3. Re-export from `packages/agents/src/index.ts`

Add `securityAuditRepository` + `SecurityAuditRepositoryEventSchema` + the
inferred type.

### 4. `packages/mcp-server/src/tools/security-audit-repository.ts`

Mirror `packages/mcp-server/src/tools/refactor-repository.ts` exactly. Tier-1.
Input schema matches the Inngest event payload (plus optional `sessionId`,
`bobTaskId`). Output: `{ jobId, eventId, sseUrl, status: 'queued' }`.

Job creation: `agentKind: 'security_audit'`. `sourceVersion: 'security'`,
`targetVersion: 'security'`. Metadata: `{ ref, cveSource }`.

### 5. Register `security_audit_repository` in `packages/mcp-server/src/index.ts`

Canonical 3-touchpoint pattern (import + ListTools entry + CallTool dispatch

+ withAudit wrap). Tool name: `'security_audit_repository'`. Use a flat JSON
  Schema with the discriminator on `cveSource.kind` expressed as `oneOf`
  (matching how `migrate_repository` handles `ruleSource`).

### 6. Bob extension surfaces

Create:

- `bob-extensions/modes/security-audit.md` (~40 lines)
- `bob-extensions/commands/security-audit.md` (~40 lines)

Match the tone and structure of the existing `migration.md` + `refactor.md` /
`migrate.md` + `refactor.md` files. The command supports two invocation forms:

- `/security-audit CVE-2024-XXXXX` — looks up advisory from NVD
- `/security-audit "<paste advisory text>"` — uses the text directly

### 7. Extend `bob-extensions/skills/migrate-codebase.md`

Currently scoped to migration. Rename or extend so it references all 4 agents
(migrate, refactor, security_audit, qa) — the skill teaches Bob's planner when
to pick each. The roadmap calls this single skill `renatus-code-changes`. You
can either rename the file or update its content to broaden scope without
renaming. Either way, the front-matter / description must reference Renatus's
four agents on one engine.

### 8. Update verifier — add `security_audit_repository` to expected MCP tools

Edit `scripts/verify-wave-2-structural.ts`: add `'security_audit_repository'` to
`EXPECTED_MCP_TOOLS`. The verifier total goes from 57 → 58. Update accompanying
"X tools" comments.

Also extend `scripts/verify-wave-3-structural.ts` parallel section so its
`MCP tool registered (wave 3)` checks include `security_audit_repository` too.

### 9. NO new agent class needed

You do NOT touch:

- Cartographer (its security_audit system prompt already exists)
- Surgeon (agent-kind-agnostic)
- Examiner (cve-replay strategy already implemented)
- Auditor (agent-kind-agnostic)
- Indexer / Retrieval / GitHubAdapter

This is workflow + tool + Bob surfaces only. Same as Refactor.

## Constraints (read twice)

1. **No commits.** Leave git state alone. Just save the files.
2. **No new dependencies.** Node 20+ has `fetch` built in for NVD.
3. **TypeScript strict.** No `any` without `// rationale: ...`.
4. **Pure ESM.** Async only.
5. **Match the canonical MCP tool pattern from `propose-patch.ts`.** Do NOT
   invent a new tool shape — that's how the original Auditor work needed
   rework. Tier-1 tool shape lives in `tools/migrate-repository.ts` /
   `tools/refactor-repository.ts`.
6. **The NVD fetch error must be loud.** If the fetch fails or returns no
   English description, throw `SecurityAuditAdvisoryFetchError` (define
   alongside the workflow in a sibling errors file). Inngest's retry budget
   handles transient failures.
7. **No stubs, no TODO comments.** If you can't ship a piece, leave it out
   and call it out in your task summary — do NOT ship a `// TODO: implement`.
8. **Sanity-check your work against the regression gates before declaring done:**

```bash
pnpm -r type-check     # all 7 packages clean
pnpm -r build          # all 7 packages clean
pnpm verify:wave-2     # MUST stay at 57+1 = 58/58 PASS (your new tool registration)
pnpm verify:wave-3     # MUST stay at 98+? PASS (new tool registration in the wave-3 section too)
```

## Smoke test (after build)

If you have a Postgres URL + Groq key configured, exercise the new path:

```bash
DATABASE_URL=... GROQ_API_KEY=... pnpm verify:wave-3:e2e
# (existing e2e exercises migrate; for security_audit, write a small smoke
#  script that fires the Inngest event with a known CVE and asserts ≥1
#  patch row + ≥1 audit_events row + a non-null signature)
```

Skip the smoke test if no keys — the structural verifier catches the wiring.

## What to write in your task export

When you finish, create `bob_sessions/task_<N>_security_audit_agent/` with:

1. The Bob task markdown export.
2. A summary listing every file added/modified, the verifier totals before
   and after, and any deviation from the spec (if any — there shouldn't be).

If you hit a real blocker, DO NOT ship a stub. Stop, document the blocker in
the export, and ask the user.

<<< END — Wave 4 Task 1 >>>

```

---

## 5. After Bob ships W4-1

The review loop:

1. **Run the verifier myself**: `pnpm verify:wave-3`. Confirm new tool count.
2. **Read every changed file** against the quality bar in
   `STATE-OF-RENATUS.md` §6. The most common Bob misses (from the Auditor
   task review):
   - `any` typing without `// rationale:` comments.
   - TODO stubs in production code.
   - Inconsistent MCP tool pattern.
   - Forgetting to update the verifier to include the new tool.
   - Forgetting to instrument audit events (this one Bob already learned in
     Task 11; should not recur).
3. **Spot-check the Bob surfaces** for tone consistency with the existing
   refactor surfaces.
4. **If anything fails the bar**, write a hardening task for Bob the same way
   we did for the Auditor (Task 12). Otherwise → move on to W4-2 (Q&A agent).

---

## 6. Wave 4 task queue (after W4-1)

| # | Task | When to send |
|---|---|---|
| W4-1 | Security Audit agent | NOW (prompt above) |
| W4-2 | Codebase Q&A agent | After W4-1 lands cleanly |
| W4-3 | Web app — `/run` + `/audit/[jobId]` + `/jobs/[jobId]` SSE | After W4-2 |
| W4-4 | 2D KG + WebContainers replay + `/verify` | After W4-3 |
| W4-5 | Polish + landing page rewrite + all 4 Bob surfaces complete | Final |

Each task gets its own brief, just like W4-1. Don't queue them.

---

*End of Wave 4 plan.*
```
