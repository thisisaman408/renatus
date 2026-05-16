# Renatus — 48-Hour Implementation Roadmap

> Hour-by-hour build plan with checkpoints, fallback decisions, and a solo-builder execution model for the IBM Bob Hackathon (May 15–17, 2026).
>
> First-pass authored by Bob; reviewed and corrected by Claude Code in the terminal. Bob's original task export lives in `bob_sessions/task_1_implementation_plan/`.

**Critical Success Factors:**
1. Bob can call a Renatus MCP tool by Hour 4 (non-negotiable).
2. End-to-end migration on a tiny fixture by Hour 13 (pivot point).
3. Backup demo video recorded the moment the first end-to-end migration goes green (not at Hour 38 — earlier is the entire point).
4. Real OSS repo migration by Hour 26.
5. Demo rehearsed 5× by Hour 44.

---

## Quick Navigation

- [Solo execution model](#solo-execution-model)
- [Wave 1: Foundation (Hour 0–5)](#wave-1-foundation-hour-05)
- [Wave 2: Core Pipeline (Hour 5–13)](#wave-2-core-pipeline-hour-513)
- [Wave 3: Production Depth (Hour 13–26)](#wave-3-production-depth-hour-1326)
- [Wave 4: Experience Layer (Hour 26–37)](#wave-4-experience-layer-hour-2637)
- [Wave 5: Polish & Demo (Hour 37–44)](#wave-5-polish--demo-hour-3744)
- [Wave 6: Submission (Hour 44–48)](#wave-6-submission-hour-4448)
- [Agent architecture details](#agent-architecture-details)
- [Fallback decision matrix](#fallback-decision-matrix)
- [Test Crew pivot plan](#test-crew-pivot-plan)
- [Realistic time budget for solo builders](#realistic-time-budget-for-solo-builders)

---

## Solo execution model

The original draft assumed a 3–4 person team with separate Backend / Agent / Frontend leads and parallel work streams. The actual builder is solo. The execution model is three lanes, not four roles:

| Lane | What runs there | When |
| --- | --- | --- |
| **Bob foreground (you in Bob IDE)** | Original code generation. Architecture decisions. Reading repos. Writing the agents, MCP tools, codemods. **Every task in this lane gets its session exported to `bob_sessions/` the moment it ends.** | Whenever an idea needs real intelligence. |
| **Claude Code (terminal in Bob IDE)** | Reviewing Bob's output. Fixing typos, types, lint. Running build/test/lint. Wiring up env vars. Writing commit messages. Pushing to GitHub. Debugging runtime errors. **Never touches `bob_sessions/`**. | Continuously, after each Bob task. |
| **Async services (background)** | Neon Postgres provisioning. Upstash Redis. Neo4j AuraDB. watsonx Cloud account. Vercel deploy. These run while you sleep / build. | Set up in Wave 1; left running. |

**Rule:** Bob does the load-bearing thinking. Claude Code does the plumbing. Every Bob task gets exported when done — that is the hackathon audit chain.

---

## Wave 1: Foundation (Hour 0–5)

**Goal:** Bob can call a Renatus MCP tool. Database is up. Demo repo selected. Web app skeleton deployed. Secret-leak gate active.

**Why 5 hours, not 4:** Bob's draft underestimated provisioning overhead (Neon + Neo4j + Upstash + IBM Cloud watsonx) and missed three setup tasks that turn out to be load-bearing (demo repo selection, web app stub, `.bobignore` pre-push gate). Better to spend 60 extra minutes on foundation than discover at Hour 24 that the demo target doesn't migrate.

### Hour 0–1: Repo skeleton, demo repo selection, async provisioning kicked off

**Tasks:**
- Initialise monorepo with pnpm workspaces. Configure Turbo. Shared strict TypeScript config.
- Workspace structure (logical, not file-path-prescriptive):
  - `packages/mcp-server` — stdio + HTTP transport
  - `packages/shared` — Zod schemas, types
  - `packages/db` — Drizzle schemas, repositories, migrations
  - `packages/agents` — Cartographer / Surgeon / Examiner / Auditor
  - `apps/web` — companion Next.js 16 app
  - `bob-extensions/` — `modes/`, `commands/`, `skills/` markdowns
  - `bob_sessions/` — pre-created; tracked; read-only by convention
- `.bobignore` populated from `SYSTEM-DESIGN.md` §13 — `.env*`, `secrets/`, `*.key`, `config/credentials*`, `**/*.pem`.
- **Demo target repo selected.** Pick one OSS React 18 codebase, ~50 source files, has a working test suite, no exotic build tooling. Clone it to `test-repos/demo-primary/`. **Two backups pre-selected and recorded in a note**, not cloned yet.
- **In parallel, kick off async provisioning** (do not wait for these to finish):
  - Neon Postgres project — copy connection string into `.env.local`.
  - Neo4j AuraDB free tier — copy bolt URI + credentials.
  - Upstash Redis — copy REST URL + token.
  - IBM Cloud watsonx hackathon account (request form on lablab.ai; ~1 hour provisioning) — used later as the optional internal classifier.
  - Vercel project — link `apps/web` for preview deploys.
- First commit: `chore: scaffold monorepo + provision async services`.

**Time:** 60 min active; provisioning continues in background.

### Hour 1–2: MCP server skeleton + Bob talks to it

**Tasks:**
- MCP server stdio transport using `@modelcontextprotocol/sdk`. One no-op tool: `ping`. Zod schemas for input/output.
- `npx @renatus/mcp` (or local invocation) starts the server.
- Create Bob custom mode markdown (`bob-extensions/modes/migration.md`) — role definition, tool access restricted to read + `mcp:renatus:*`, custom instructions tuned for migration reasoning.
- Create Bob slash command (`bob-extensions/commands/migrate.md`) — minimal, just switches to Migration mode and calls `ping` for now.
- Wire Bob IDE to the local MCP server.
- **Critical first export:** open Bob, run `/migrate test`, watch Bob call `ping`, export the session to `bob_sessions/<timestamp>__slash-migrate__hello-world.md` + screenshot.

**Time:** 60 min.
**Fallback:** If MCP SDK is broken, write raw JSON-RPC over stdio. Adds ~2h. Should not be needed.

### Hour 2–3: Database foundation + secret-leak pre-push gate

**Tasks:**
- Drizzle workspace points at Neon. Core schemas in TypeScript: `mcp_sessions`, `tool_invocations`, `jobs`. Generate + apply migrations via `drizzle-kit`.
- Repository layer for the three tables, transaction-aware.
- `ping` tool now logs every call into `tool_invocations` and stamps the Bob task id (read from MCP transport metadata) onto `mcp_sessions`.
- **Pre-push secret-leak gate.** Shell script in `.husky/pre-push` (or `scripts/secret-scan.sh`):
  - Scans `bob_sessions/**.md`, `.env*` (must not be tracked), `apps/**`, `packages/**`.
  - Greps for: `sk-`, `AKIA`, `Bearer `, `eyJ[A-Za-z0-9_-]`, `xoxp-`, `ghp_`, `ghs_`, plus the IBM Cloud key prefixes from the hackathon guide.
  - Exit non-zero if any match found — blocks push.
  - Hackathon rule (PDF p.20): IBM Security deactivates accounts that leak credentials. This gate is non-negotiable.

**Time:** 60 min.
**Fallback:** Local Postgres in Docker if Neon delays — same Drizzle code, swap connection string.

### Hour 3–4: Upstash Redis + Web app stub deployed

**Tasks:**
- Redis client wired in `packages/db/redis.ts`. BullMQ queue stubs for `cartographer`, `surgeon`, `examiner`, `auditor`, `orchestrator`. No workers yet, just the queues defined.
- Idempotency cache layer (Redis-backed; 24h TTL on tool-call hashes).
- **Web app skeleton deployed to Vercel.** Next.js 16 App Router, Tailwind v4, shadcn/ui. One page: `/` — landing copy, public-key placeholder, GitHub link. **Already shareable URL by Hour 4.** Backend hasn't shipped a single byte yet, but you have a demo URL the moment you need one.

**Time:** 60 min.

### Hour 4–5: Sandbox smoke test + extension pack skeletons

**Tasks:**
- **Sandbox provider chosen and tested NOW, not at Hour 21.** Pick one of: Vercel Sandbox, e2b.dev, local Docker. Run a 30-second smoke test: spin up, install pnpm, run `pnpm --version`, tear down. If the chosen provider fails, switch now (cheap) — not at Hour 21 (expensive).
- **All four Bob extension surfaces have empty-but-real files in place:**
  - `bob-extensions/modes/migration.md` (already created)
  - `bob-extensions/commands/migrate.md` (already created)
  - `bob-extensions/skills/migrate-codebase.md` — skill recipe markdown, content TBD but file exists
  - `bob-extensions/mcp-config.example.json` — the MCP server registration snippet judges copy/paste
- Export Bob session for Wave 1.

**Time:** 60 min.

### Wave 1 Checkpoint (Hour 5)

- Bob calls Renatus MCP tools and we log to Postgres.
- Demo repo lives in `test-repos/demo-primary/` and the test suite runs locally.
- Web app stub is live on a Vercel URL.
- Redis + Neon + Neo4j + watsonx provisioning either complete or running in background.
- Pre-push secret gate blocks any test push containing a fake `sk-XXXX`.
- Four extension surfaces have placeholder files.
- At least one Bob session exported to `bob_sessions/`.

**Decision:** if any of {Bob talks to MCP, Postgres writes, secret gate works} fails — STOP and debug before Wave 2.

---

## Wave 2: Core Pipeline (Hour 5–13)

**Goal:** `/migrate react-19` on the *demo target repo* (not a tiny synthetic fixture — the real demo target) produces at least one valid patch end-to-end. **Backup video gets recorded the moment this works.**

**Checkpoint:** if no working patch by Hour 13, execute the Test Crew pivot (one-page plan further down in this document).

### Hour 5–6: Minimal Cartographer

**Tasks:**
- Zod schemas for `BreakingChange`, `BreakingChangeMap` in `packages/shared`.
- Drizzle TS schemas for `breaking_change_maps` and `breaking_changes` (TypeScript schema objects — let `drizzle-kit` generate the SQL; do not write raw `CREATE TABLE`).
- Cartographer service — **MVP is a hardcoded React 18→19 map in TypeScript**, not live changelog fetching. Real fetching comes in Wave 3 if time permits.
- The hardcoded map covers **three real React 19 mechanical rules** (see "Codemod targets" below). The previous draft's `useEffect` cleanup rule is wrong — `useEffect` behaves the same in 18 and 19 outside StrictMode. Skip it.
- New MCP tool: `plan_migration`. Returns the structured breaking-change list.

**Codemod targets (real React 19 mechanical rules):**
1. **`useRef()` now requires an initial argument** — `useRef()` → `useRef(null)`. Highly mechanical, codemod-friendly.
2. **`defaultProps` removal on function components** — function-component `Foo.defaultProps = { x: 1 }` → inline default destructuring `function Foo({ x = 1 })`.
3. **String refs removed** — `<div ref="myDiv" />` → `<div ref={myDivRef} />` with a corresponding `useRef`.

These three rules are real, documented in React 19's official migration guide, and produce visible diffs at demo time.

**Time:** 60 min.

### Hour 6–8: Minimal indexer

**Tasks:**
- File walker over the snapshot. Parse `.ts`/`.tsx` with `ts-morph` (preferred over jscodeshift here — better TypeScript ergonomics, plays cleanly with React 19's `useRef` overloads).
- Extract: file → imports, exports, top-level declarations, JSX element usages.
- Write to Postgres only for now: `repo_snapshots`, `code_chunks`. **Neo4j integration deferred to Wave 3.**
- Add MCP tools `clone_repository` (Octokit) and `index_repository`.
- Smoke test: index the demo target repo, verify imports and exports persisted.

**Time:** 120 min.
**Fallback:** if `ts-morph` is too slow on the demo repo, fall back to TypeScript compiler API directly (skip the wrapper).

### Hour 8–11: Surgeon — one rule end-to-end

**Tasks:**
- Zod schemas for `Patch` and `PatchBatch`. Drizzle TS schemas for `patches`.
- Surgeon service. **Pick the simplest of the three rules — `useRef()` requires initial arg — and ship it end-to-end.** Other two rules ship in Wave 3.
- The codemod itself uses `ts-morph`:

```typescript
// Real, working signature (not pseudocode).
// Visits every call expression to useRef with zero arguments,
// inserts `null` as the first argument.
export function patchUseRefRequiresInitialArg(
  sourceFile: SourceFile
): { patched: boolean; diff: string } {
  let patched = false;
  sourceFile.getDescendantsOfKind(SyntaxKind.CallExpression).forEach(call => {
    const expr = call.getExpression();
    if (!Node.isIdentifier(expr)) return;
    if (expr.getText() !== 'useRef') return;
    if (call.getArguments().length !== 0) return;
    call.addArgument('null');
    patched = true;
  });
  return { patched, diff: sourceFile.getFullText() };
}
```

The previous draft's example was non-functional (`getText()` on the callee in a way that would break on synthetic nodes, plus an empty visit body). This version actually runs.

- New MCP tools: `find_affected_files`, `propose_patch`, `apply_patch`.
- Persist each patch with `confidence` populated by the algorithm in the "Confidence scoring" section below.

**Time:** 180 min.
**Fallback:** if `ts-morph` mutation is fighting you, fall back to text-level transformation using `magic-string` — less robust but always finishes.

### Hour 11–12: Orchestrator + `migrate_repository` end-to-end

**Tasks:**
- Migration orchestrator (the FSM service) — at this stage, **synchronous, no BullMQ**. Tier-up to BullMQ in Wave 3. Reasoning: BullMQ adds an entire layer of retry/queue debugging that's not worth it for the v0 happy path.
- One tier-1 MCP tool: `migrate_repository(repoUrl, source, target)`. Internally calls clone → index → plan → patch → returns the patch batch id. No tests, no audit yet — those land in Wave 3.
- Slash command `bob-extensions/commands/migrate.md` now actually invokes `migrate_repository` with `source=react@18, target=react@19`.

**Time:** 60 min.

### Hour 12–13: First end-to-end run + **record backup video immediately**

**Tasks:**
- Run `/migrate react-19` against the demo target. Verify a patch lands. Eyeball-confirm the diff is correct.
- **The moment the migration completes successfully — record the demo video.** Even if it's rough, even if the audit/web-app isn't done yet. **This is the backup.** If everything else breaks between now and Hour 48, this is what gets shown.
- Export the Bob session for Wave 2.

**Time:** 60 min.

### Wave 2 Checkpoint (Hour 13)

- `/migrate react-19` produces at least one syntactically valid patch on the demo target.
- The patch, applied to the repo, doesn't break TypeScript compilation.
- **A rough but working demo video exists.** This is the insurance policy.

**Decision:**
- **Pass:** proceed to Wave 3.
- **Fail:** execute the Test Crew pivot (see end of this document). Do not try to "just keep fixing the codemod" past Hour 14 — that path leads to a no-submission.

---

## Wave 3: Production Depth (Hour 13–26)

**Goal:** Real demo target repo migrates end-to-end with tests run in a sandbox, audit signed.

**Checkpoint:** if real-repo end-to-end fails by Hour 26, cut Neo4j OR embeddings (one, not both). Do not cut Auditor — the signed report is the demo prop.

### Hour 13–16: Neo4j integration (structural retrieval)

**Tasks:**
- Neo4j repository layer. Cypher templates for the three queries from `SYSTEM-DESIGN.md` §8.2.
- Indexer extended to populate `(:File)`, `(:Symbol)`, `(:Import)` nodes + relationships.
- Surgeon's `find_affected_files` now uses Cypher traversal instead of the Wave-2 brute-force scan.
- Verify: for the demo target, Neo4j returns the same set the Wave-2 scan returned, faster.

**Time:** 180 min.
**Fallback:** in-memory graph (`Map<string, Set<string>>`) — keep the same `KnowledgeGraphRepository` interface so Surgeon doesn't care which backend it's hitting.

### Hour 16–19: Embeddings + semantic retrieval (pgvector)

**Tasks:**
- Enable `pgvector` extension on Neon. Drizzle schema for `embeddings` table with `vector(768)` column, HNSW index, cosine.
- Embeddings adapter — start with a local model (`Xenova/all-MiniLM-L6-v2` via Transformers.js) for zero-cost; swap to watsonx Granite Embeddings later if credits exist.
- Indexer extended to chunk files and embed each chunk.
- Surgeon's `find_affected_files` now returns the union of structural (Neo4j) and semantic (pgvector) hits, ranked.

**Time:** 180 min.
**Fallback:** skip semantic retrieval. Surgeon uses Neo4j only. This is acceptable for demo if Neo4j coverage is strong on the chosen demo target.

### Hour 19–22: Examiner (test generation)

**Tasks:**
- Examiner service. MVP is snapshot-style only: for each patched file, render the component in jsdom, capture output, assert equality.
- Detect test framework in the demo target (Vitest / Jest / Mocha) — emit tests matching the existing style.
- New MCP tool: `generate_test_for`.
- Generated tests stored in Drizzle table `generated_tests`.

**Time:** 180 min.
**Fallback:** if snapshot generation is unreliable, emit a `TODO: regression test for <file>` comment-test that fails until manually completed — still demonstrates the principle, judges see the intention.

### Hour 22–25: Auditor + sandbox + signing

**Tasks:**
- Auditor service. Uses the SandboxAdapter chosen at Hour 4–5.
- Apply patches into sandbox workspace → install deps → run baseline test suite → run generated tests → capture results.
- Signing service: ed25519 via `@noble/curves`. Per-job keypair stored in `signing_keys` (private key encrypted with a server-wide KEK from environment).
- New MCP tools: `run_test_suite`, `sign_audit`.
- The audit report JSON shape matches `SYSTEM-DESIGN.md` §5.4. Bob task ids stamped on `audit_runs.bob_session_refs`.

**Time:** 180 min.
**Fallback:** if sandbox is broken, run tests in a local subprocess (`child_process.spawn` with strict timeout). Less isolated, still demos.

### Hour 25–26: BullMQ tier-up (optional but recommended)

**Tasks:**
- Swap the synchronous orchestrator from Wave 2 for BullMQ-backed workers. The FSM and the agents do not change — only the dispatch layer.
- Verify the demo target still migrates end-to-end via the queue.
- **If this is fragile, skip it.** Synchronous orchestrator is fine for a 50-file demo target.

**Time:** 60 min.

### Wave 3 Checkpoint (Hour 26)

- Demo target migrates end-to-end. Tests run in sandbox. Audit report is signed.
- New, better demo video re-recorded (replacing the rough Hour-13 one).
- All four agents have at least one happy-path execution captured in `bob_sessions/`.

**Decision:** proceed to Wave 4. If running behind, cut Neo4j OR embeddings.

---

## Wave 4: Experience Layer (Hour 26–37)

**Goal:** Companion web app is no longer a stub — it renders the signed audit report and the 3D codebase KG.

**Note:** the web app was already deployed in Wave 1 as a stub. This wave fills in the pages, not the infrastructure.

### Hour 26–29: Audit report page

**Tasks:**
- `/audit/[jobId]` route. RSC for static structure; small client island for the signature-verification widget.
- Read the audit JSON, the patch list, the test results, the Bob session refs, and the timeline (from `tool_invocations` + `audit_events`).
- shadcn/ui for layout; Tailwind v4 utility classes only.
- Bob session deep-links resolve as relative GitHub paths (so when judges clone the repo, clicks work locally).

**Time:** 180 min.
**Fallback:** ship the page without the verification widget — server-side renders the canonical JSON and signature, judges can verify offline.

### Hour 29–32: 3D knowledge graph

**Tasks:**
- `/kg/[jobId]` — client-only route (dynamic import to avoid SSR errors on three.js).
- Pull KG data: nodes = files, edges = imports, colours by breaking-change severity.
- `react-force-graph-3d`. Hover for filename + applied rule ids. Migration animation pulses each affected file in patch-application order.
- Screenshot export button (for the audit page to embed a static fallback).

**Time:** 180 min.
**Fallback:** 2D force graph using the same library (`react-force-graph-2d`). Still impressive, less wow.

### Hour 32–35: HTTP/SSE transport + live progress

**Tasks:**
- The MCP server gains an HTTP transport (Hono). Same controllers, different I/O.
- SSE endpoint emits orchestrator state transitions and per-agent step events.
- `/jobs/[jobId]/live` — client + EventSource — shows the pipeline animating in real time. **This is the visual for the live demo.**

**Time:** 180 min.
**Fallback:** poll the job-status endpoint every 1s. Less real-time, still works.

### Hour 35–37: Polish pass on the web app

**Tasks:**
- Landing page upgrade — install instructions, public key, GitHub link, copy-pasteable Bob MCP config.
- `/verify` route — paste a signed report + public key, get verification result client-side.
- Mobile-degraded layouts (judges might be on phones).
- Lighthouse score check; fix anything obvious.

**Time:** 120 min.

### Wave 4 Checkpoint (Hour 37)

- Audit URL renders a real signed report end-to-end.
- 3D (or 2D) KG renders the demo target.
- Live SSE feed shows the pipeline ticking through states.

**Decision:** proceed to Wave 5.

---

## Wave 5: Polish & Demo (Hour 37–44)

**Goal:** Demo runs five times cleanly. Final backup video recorded. README and submission assets done.

**Note:** the rough backup video was recorded at Hour 13. The **final, high-quality version is recorded here** — but the safety net was already in place 25 hours earlier.

### Hour 37–39: Demo script + final video record

**Tasks:**
- Lock the 90-second arc from `SYSTEM-DESIGN.md` §17.1.
- Record the final demo video at high quality. Edit to 60s if submission asks for that.
- Upload to YouTube (unlisted) + keep a local mp4 fallback.

**Time:** 120 min.

### Hour 39–42: Live demo rehearsal × 5

**Tasks:**
- Run the demo five times start-to-finish on the demo target. Time each iteration. Target ≤90s.
- After every run, write down what was slowest or felt clunky.
- Optimise the top two issues. Run five more.

**Time:** 180 min.

### Hour 42–44: README, secret scan, final commit

**Tasks:**
- README install snippet — `npx @renatus/mcp` config block for Bob's MCP settings, plus the Vercel demo URL.
- Final pass on `bob_sessions/` — every file has a descriptive name, no leaked secrets. Run the pre-push secret scan one more time.
- AGENTS.md updated to reflect any architectural decisions changed during build.
- Push everything.

**Time:** 120 min.

### Wave 5 Checkpoint (Hour 44)

- 5/5 demo runs in ≤90s.
- Final video uploaded.
- Repo clean, public, renders correctly on GitHub.

---

## Wave 6: Submission (Hour 44–48)

**Goal:** Submit. Verify. Rest.

### Hour 44–46: Submission package

**Tasks:**
- Cover image (1920×1080).
- Long description, short description, tags.
- Lablab.ai submission form filled.
- Submit. Confirm the submission appears in the submissions list on the hackathon page.

**Time:** 120 min.

### Hour 46–48: Verification + rest

**Tasks:**
- Verify the demo URL from a different network and from mobile.
- Verify the GitHub repo's README renders (no broken links, images load).
- Sleep before judging. Final review with fresh eyes wins more points than a sleep-deprived "one more tweak."

**Time:** 120 min budget; whatever's left is sleep.

---

## Agent architecture details

### Shared types & schemas

Single source of truth in `packages/shared`. Drizzle schemas re-use these Zod types via `drizzle-zod` so the DB layer and the MCP layer share validation.

```typescript
import { z } from 'zod';

export const SemverRangeSchema = z.string().regex(/^\d+(\.\d+)?(\.\d+)?([.\-+].*)?$/);
export const EcosystemSchema = z.enum(['npm', 'pypi', 'cargo', 'maven']);
export const SeveritySchema = z.enum(['low', 'medium', 'high', 'critical']);
export const ConfidenceSchema = z.number().min(0).max(1);

export const JobStateSchema = z.enum([
  'draft', 'planning', 'planned',
  'cloning', 'cloned',
  'indexing', 'indexed',
  'patching', 'patched',
  'testing', 'tested',
  'auditing', 'audited',
  'done', 'failed', 'aborted', 'paused',
]);
```

### Cartographer

**Input:** `{ ecosystem, source, target, cacheKey? }`
**Output:** `BreakingChangeMap` containing a `BreakingChange[]`.

**MVP behaviour (Wave 2):** return the hardcoded React 18→19 map covering the three real mechanical rules.

**Production behaviour (Wave 3 if time):** fetch the upstream changelog from a curated source registry, parse with `unified` + `remark`, normalise into the schema. Elicit Bob's LLM only where automatic classification of a rule's severity is ambiguous.

**Confidence scoring (NEW — was missing in the draft):**
- A `BreakingChange` rule has `prescription.automationConfidence`:
  - `1.0` — codemod is deterministic and idempotent (e.g., `useRef()` → `useRef(null)`)
  - `0.7` — codemod handles 90% of cases, edge cases elicit to Bob
  - `0.3` — no codemod; manual notes only
- A `Patch` has `confidence`:
  - `min(rule.automationConfidence, codemodOutcomeScore)`
  - `codemodOutcomeScore` = 1.0 if transform applied cleanly without elicitation, 0.7 if elicitation was used, 0.3 if the site was unresolved

### Surgeon

**Input:** `{ snapshotId, breakingChangeMapId, retrievalMode? }`
**Output:** `PatchBatch` containing `Patch[]` with `confidence` populated as above.

**Codemod registry:** each `BreakingChange.id` maps to a codemod function with signature `(SourceFile, BreakingChange) => CodemodResult`. Registry is plain TypeScript — no plugin system in v0.

**Elicitation policy:** only elicit when the codemod returns `{ patched: false, reason: 'ambiguous' }`. Batch all unresolved sites into one elicitation per file when possible — reduces latency by ~5×. **Cache elicitation responses by `(rule.id, sourceFileSha, ambiguityHash)`** — if the same ambiguity recurs across files, second occurrence is instant.

### Examiner

**Input:** `{ patchBatchId, testStrategy? }`
**Output:** `GeneratedTestBatch` containing `GeneratedTest[]`.

**MVP:** snapshot tests against jsdom-rendered components. Vitest harness. Each test file co-located with the patched source file under a `*.migration.test.tsx` suffix so the existing test runner picks them up automatically.

### Auditor

**Input:** `{ patchBatchId, generatedTestBatchId, sandboxProvider? }`
**Output:** signed `AuditReport`.

**Signing implementation (corrected to use `@noble/curves`, not the deprecated `@noble/ed25519`):**

```typescript
import { ed25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha256';

export class SigningService {
  async sign(report: AuditReportInput, privateKey: Uint8Array): Promise<SignedAuditReport> {
    const canonical = canonicaliseJson(report);  // sorted keys, no whitespace
    const digest = sha256(new TextEncoder().encode(canonical));
    const signature = ed25519.sign(digest, privateKey);
    return {
      ...report,
      signature: Buffer.from(signature).toString('hex'),
      digest: Buffer.from(digest).toString('hex'),
      publicKey: Buffer.from(ed25519.getPublicKey(privateKey)).toString('hex'),
      signedAt: new Date().toISOString(),
    };
  }

  verify(signed: SignedAuditReport): boolean {
    const { signature, publicKey, digest: _, signedAt: __, ...rest } = signed;
    const canonical = canonicaliseJson(rest);
    const digest = sha256(new TextEncoder().encode(canonical));
    return ed25519.verify(
      Buffer.from(signature, 'hex'),
      digest,
      Buffer.from(publicKey, 'hex'),
    );
  }
}
```

The canonicalisation function sorts keys recursively and emits no whitespace; both sign and verify use the same canonical form so the signature is reproducible.

### Drizzle schema convention (no raw SQL)

All schemas are TypeScript objects. Example for `patches`:

```typescript
import { pgTable, uuid, text, numeric, timestamp, jsonb } from 'drizzle-orm/pg-core';

export const patches = pgTable('patches', {
  id: uuid('id').primaryKey().defaultRandom(),
  jobId: uuid('job_id').notNull().references(() => jobs.id),
  batchId: uuid('batch_id').notNull(),
  filePath: text('file_path').notNull(),
  beforeContent: text('before_content').notNull(),
  afterContent: text('after_content').notNull(),
  appliedRuleIds: jsonb('applied_rule_ids').$type<string[]>().notNull(),
  rationale: text('rationale').notNull(),
  confidence: numeric('confidence', { precision: 3, scale: 2 }).notNull(),
  status: text('status', { enum: ['resolved', 'unresolved', 'manual'] }).notNull(),
  unresolvedReason: text('unresolved_reason'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
```

`drizzle-kit` generates the DDL. **Do not hand-write `CREATE TABLE` statements.** The draft mixed both styles.

---

## Fallback decision matrix

| Checkpoint | Condition | Fallback | Impact | Recovery time |
| --- | --- | --- | --- | --- |
| Hour 4: Bob ↔ MCP | Bob can't call MCP tool | STOP; debug; do not proceed | Critical | 1–2h |
| Hour 4: Async services | Neon/Neo4j/Upstash delayed | Local Docker for each | Low | 30m each |
| Hour 5: Sandbox chosen | Sandbox provider broken | Switch provider NOW (not at H21) | Low | 30m |
| Hour 13: First patch | No working patch | **Test Crew pivot (see below)** | High | 0 |
| Hour 13: Backup video | Migration works but didn't record | Record immediately, then keep going | Critical | 15m |
| Hour 16: Neo4j too slow | Query >2s on demo target | In-memory `Map` adapter | Medium | 1h |
| Hour 19: pgvector | Slow or noisy on demo target | Skip semantic retrieval | Low | 0 |
| Hour 22: Sandbox | Fails on apply-patch step | Local subprocess + timeout | Medium | 1h |
| Hour 26: Real repo | E2E fails on demo target | Cut Neo4j OR embeddings | Medium | 0 |
| Hour 29: Audit page | Verification widget broken | Server-render JSON; offline verification | Low | 0 |
| Hour 32: 3D KG | Slow / errors on demo size | 2D force graph | Low | 1h |
| Hour 35: SSE | Bob doesn't render the stream | Poll-based progress | Low | 30m |
| Hour 42: Live demo | <4/5 successful runs | Switch to pre-recorded final video | Medium | 0 (recorded H37) |
| Hour 47: Demo URL down | Vercel hiccup | Static export hosted on GitHub Pages | Low | 30m |

**Rules:**
1. Never compromise the Hour-4 Bob ↔ MCP gate.
2. The Hour-13 video is the entire insurance policy. Record it the moment the first patch lands.
3. Cut features at checkpoints, not between checkpoints.

---

## Test Crew pivot plan

**When to execute:** if Wave 2 ends (Hour 13) with no working patch.

**What you build instead:** an MCP server that exposes one tool — `generate_regression_tests(repoUrl)` — which clones the repo, identifies untested files (via test/source path conventions + coverage gaps), and generates a Vitest suite covering each.

**Why it's a safe pivot:** every piece of infrastructure built in Wave 1 + Wave 2 (MCP transport, Drizzle schemas, snapshot/index, Examiner) still applies. You drop Cartographer + Surgeon + the codemod stack — the parts that were failing.

**90-second demo:** open Bob in a real repo, type `/generate-tests`, watch Bob call the tool, see 30 new test files appear, run `pnpm test`, all green. Audit URL still ships, still signed, still shareable.

**Field positioning:** less differentiation against the hackathon Quickstart (which is migration-themed), but a working tool beats a broken differentiator every time.

**Time to execute the pivot:** 4–6 hours from Hour 13 — i.e., a working Test Crew by Hour 17–19, leaving 29+ hours for depth + polish.

---

## Realistic time budget for solo builders

The original draft summed task budgets to exactly 48h with no slack. Real solo time accounting:

| Bucket | Hours |
| --- | --- |
| Sleep (two short nights, ~5h each) | 10 |
| Meals + breaks + transit | 4 |
| Bob session exports (~3 min × ~30 tasks) | 1.5 |
| Submission form + asset prep | 2 |
| Active build time available | **30.5** |

Budgets per task are scoped to fit within 30.5 active hours. The wave hour ranges are wall-clock, **not** active-hour; the gap is sleep + meals.

If you find yourself running long on any wave, the **fallback decision matrix** tells you what to cut. Do not extend wave timing by "just one more hour" — that's how submissions get missed.

---

## Risk mitigation strategies

### Technical

- **MCP SDK quirks.** Smoke-tested at Hour 1–2; raw JSON-RPC fallback available.
- **AST parse speed.** Profiled at Hour 6–8; regex / `magic-string` fallback documented.
- **Sandbox provider outage.** Tested at Hour 4–5, not Hour 21.
- **Elicitation latency.** Cache by `(rule.id, fileSha, ambiguityHash)`; batch unresolved sites per file.

### Process

- **Solo means single point of failure.** If you are blocked, prefer Test Crew pivot over heroic debugging. The pivot has a defined plan; heroics have none.
- **Scope creep.** No feature is added without cutting a same-weight feature.
- **Demo fragility.** The Hour-13 rough recording is the insurance; the Hour-37 final is the headline.

### External

- **Service outages (Neon / Neo4j / Upstash / Vercel).** Local Docker fallbacks pre-staged; same code paths.
- **GitHub rate limits.** Demo target pre-cloned to `test-repos/demo-primary/` at Hour 0; no live cloning during demo.
- **Stage network.** Pre-load every asset; assume offline.

---

## Success metrics

### Minimum viable demo (must have)
- Bob calls Renatus MCP tools.
- One working patch on the demo target.
- Audit report generated (signed if possible; JSON if not).
- Web app shows the audit URL.
- `bob_sessions/` has exports for every distinct surface.

### Target demo (should have)
- Demo target migrates end-to-end.
- Tests run in sandbox, all green.
- Audit signed + verifiable.
- 3D (or 2D) KG renders.
- 90-second live demo runs cleanly.

### Stretch (nice to have)
- Second migration target wired (Tailwind 3→4).
- Semantic retrieval contributing real hits.
- watsonx Granite path active for at least one classifier call.
- Mobile-degraded layouts polished.

---

## Post-hackathon roadmap

Designed-for, not built in 48h:

1. Multi-language codemods (Python, Rust, Java).
2. Pull-request automation — open the migration as a PR.
3. Marketplace for community-contributed `BreakingChangeMap`s.
4. GitHub Actions integration for migration-on-CI.
5. Side-by-side diff visualisation in the web app.
6. Rollback support — undo a migration with one tool call.
7. Multi-tenant / enterprise audit retention.

---

*End of Implementation Roadmap.*
