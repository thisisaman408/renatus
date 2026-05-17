# Renatus — 48-Hour Implementation Roadmap (v4)

> Hour-by-hour build plan for a solo builder with Claude Code + Bob IDE.
>
> Companion to `SYSTEM-DESIGN.md`. Read that first.

**Critical Success Factors (non-negotiable):**

1. Bob calls a Renatus MCP tool by **Hour 4**.
2. First end-to-end LLM-driven migration on a tiny fixture by **Hour 13** (pivot point).
3. **LLM-driven Cartographer** that emits `Rule[]` from arbitrary changelog text by **Hour 13** (the platform unlock).
4. **Backup demo video recorded immediately at Hour 13** — not at Hour 38.
5. Real OSS repo migrates end-to-end by **Hour 22**.
6. **Refactor agent** wired end-to-end by **Hour 26**.
7. **Security Audit + Q&A agents** wired by **Hour 32**.
8. WebContainers in-browser replay works by **Hour 34**.
9. **Four-agent web app live** by **Hour 36**.
10. Demo rehearsed 4× by **Hour 44**.

---

## Document map

- [Solo execution model](#solo-execution-model)
- [Wave 1 — Foundation (0–5)](#wave-1--foundation-hour-05)
- [Wave 2 — First end-to-end + LLM Cartographer (5–13)](#wave-2--first-end-to-end--llm-cartographer-hour-513)
- [Wave 3 — Production depth + Refactor agent (13–26)](#wave-3--production-depth--refactor-agent-hour-1326)
- [Wave 4 — Security + Q&A + four-agent web app (26–37)](#wave-4--security--qa--four-agent-web-app-hour-2637)
- [Wave 5 — Polish & demo (37–44)](#wave-5--polish--demo-hour-3744)
- [Wave 6 — Submission (44–48)](#wave-6--submission-hour-4448)
- [Agent architecture details](#agent-architecture-details)
- [Fallback decision matrix](#fallback-decision-matrix)
- [Test Crew pivot plan](#test-crew-pivot-plan)
- [Realistic time budget](#realistic-time-budget-for-solo-builders)
- [Success metrics](#success-metrics)
- [Risk mitigation](#risk-mitigation)

---

## Solo execution model

Three lanes, not four roles:

| Lane | What runs there |
| --- | --- |
| **Bob foreground** (you in Bob IDE) | Original code generation, agent intelligence, codemod design. **Every task exported to `bob_sessions/` the moment it ends.** |
| **Claude Code (terminal in Bob IDE)** | Reviewing Bob's output. Type/lint/test fixing. Wiring env vars. Commits. Push. Runtime debugging. **Never touches `bob_sessions/`.** |
| **Async services (background)** | Neon, Inngest Cloud, Vercel, IBM watsonx. Provisioned in Wave 1; left running. |

Rule: Bob does the thinking. Claude Code does the plumbing. Every Bob task gets exported when done — that is the hackathon audit chain.

---

## Wave 1 — Foundation (Hour 0–5)

**Goal:** Bob calls Renatus MCP. Postgres + Inngest dev are up. Demo repo selected. Web app stub deployed. Secret-leak gate active. `LlmAdapter` interface scaffolded with all 5 implementations.

**Checkpoint:** if Bob ↔ MCP doesn't work by Hour 4, STOP and debug.

### Hour 0–1: Repo skeleton + demo repo + async provisioning

- Monorepo with pnpm workspaces + Turbo. Strict TypeScript shared config.
- Workspace structure (logical):
  - `packages/mcp-server` — stdio + HTTP transport
  - `packages/shared` — Zod schemas, types, `LlmAdapter` interface
  - `packages/db` — Drizzle schemas, repositories, migrations
  - `packages/agents` — Cartographer / Surgeon / Examiner / Auditor / Q&A
  - `packages/llm` — adapters (MCP elicitation, Vercel AI Gateway, Groq, Gemini, watsonx)
  - `packages/sandbox` — Vercel Sandbox + WebContainers adapters
  - `apps/web` — companion Next.js 16 app (production product surface)
  - `bob-extensions/` — `modes/`, `commands/`, `skills/` markdowns
- `.bobignore` populated; pre-push secret-scan gate (Husky hook) scans for `sk-`, `AKIA`, `Bearer `, `ghp_`, `ghs_`, IBM Cloud key prefixes — hard fail on match.
- **Demo target repo selected and cloned to `test-repos/demo-primary/`.** Real React 18 + TypeScript + Vitest OSS app, ~100–250 files. Two backups recorded by name.
- **Async provisioning kicked off in parallel** (does not block code work):
  - Neon Postgres project — copy `DATABASE_URL`
  - Upstash Redis (for idempotency cache only) — copy URL + token
  - **Inngest Cloud account** — copy event/signing keys
  - **Vercel AI Gateway** — create gateway, attach Groq + Gemini + (later) watsonx
  - **Groq API key** — free tier, fast Llama 3.3 70B
  - **Gemini API key** — Google AI Studio, free tier, Gemini 2.0 Flash 1M context
  - IBM Cloud hackathon account (~1h provisioning)
  - Vercel project linked to `apps/web`

**Time:** 60 min active.

### Hour 1–2: MCP server + Bob talks to it

- MCP server stdio using `@modelcontextprotocol/sdk`. One no-op tool: `ping`. Zod schemas everywhere.
- Bob custom mode markdown (`bob-extensions/modes/migration.md`) — role + tool access restricted to read + `mcp:renatus:*`.
- Bob slash command (`bob-extensions/commands/migrate.md`) — switches to Migration mode + calls `ping`.
- Wire Bob IDE → local MCP server (Settings → MCP).
- **First export:** run `/migrate test`, watch `ping` succeed, export the Bob session.

**Time:** 60 min.

### Hour 2–3: Database + Inngest dev + secret gate

- Drizzle TypeScript schemas (no raw SQL): `mcp_sessions`, `tool_invocations`, `jobs` (with `agent_kind` column from day one), `web_jobs`. `drizzle-kit generate && drizzle-kit migrate`.
- Repository layer for those tables. Transaction-aware.
- `ping` now logs into `tool_invocations` with `bob_task_id` from MCP transport metadata via `withAudit()` higher-order wrapper.
- **Inngest dev server** running locally (`npx inngest-cli@latest dev`). One stub function: `migrateRepository` that just logs and returns.
- Pre-push secret-scan script committed and wired into Husky `pre-push`. Test with a fake `sk-XXXX` to verify the gate fails.

**Time:** 60 min.

### Hour 3–4: LlmAdapter scaffolding + web app stub deployed

- `packages/shared/src/llm-adapter.ts` — the `LlmAdapter` interface from SYSTEM-DESIGN §7. `ReasoningRequest`, `ReasoningResponse`, `ReasoningChunk` types.
- `packages/llm/src/`:
  - `mcp-elicitation-adapter.ts` — gated behind `MCP_ENABLE_ELICITATION=true` so standalone callers (web app, llm_test) skip the stub.
  - `vercel-ai-gateway-adapter.ts` — wraps Vercel AI SDK; routes through the Gateway URL from env.
  - `groq-adapter.ts`, `gemini-adapter.ts`, `watsonx-granite-adapter.ts` — direct provider adapters.
  - `llm-router.ts` — the routing policy from SYSTEM-DESIGN §7 (MCP > watsonx > Gemini > Groq).
- `apps/web` deployed to Vercel as a stub: a single `/` page with copy + GitHub link + four agent CTAs (placeholder routes). **Shareable URL by Hour 4.**

**Time:** 60 min.

### Hour 4–5: Sandbox smoke-test + all four Bob surfaces in place

- **Sandbox smoke-test NOW, not in Wave 3.** Pick one: Vercel Sandbox, e2b.dev, or local Docker. Run a 30-second test: spin up → `pnpm --version` → tear down. If broken, switch now (cheap).
- **WebContainers smoke-test in `apps/web`** — embed StackBlitz SDK on a `/replay-test` route, boot a Hello World, run `node -e "console.log('ok')"`. Verify the visitor's browser can run it. **This is the demo prop — confirm it works on day one.**
- All four Bob extension surfaces have real files (migration only for now; other agents come in Wave 3/4):
  - `bob-extensions/modes/migration.md`
  - `bob-extensions/commands/migrate.md`
  - `bob-extensions/skills/renatus-code-changes.md` — migration recipe (LLM playbook)
  - `bob-extensions/mcp-config.example.json` — the snippet judges paste into Bob's MCP settings
- Export Wave 1 Bob session.

**Time:** 60 min.

### Wave 1 Checkpoint (Hour 5)

- Bob calls Renatus MCP tools; calls logged to Postgres.
- Inngest dev server running; stub workflow executes.
- Demo repo cloned, tests pass locally.
- Web app stub live on a Vercel URL.
- `LlmAdapter` interface + 5 adapters scaffolded.
- Pre-push secret gate blocks fake `sk-XXXX`.
- Sandbox + WebContainers both smoke-tested.
- At least one Bob session exported.

If any of {Bob ↔ MCP, Postgres writes, secret gate, WebContainers boots} is broken — STOP and fix.

---

## Wave 2 — First end-to-end + LLM Cartographer (Hour 5–13)

**Goal:** `/migrate react-19` on a tiny fixture repo produces a real LLM-generated patch end-to-end. **Plus** the Cartographer can ingest arbitrary changelog text and emit `Rule[]` via the LLM. **Backup video recorded the moment migration works.**

**Checkpoint:** if no working patch by Hour 13, execute the Test Crew pivot.

### Hour 5–7: Cartographer — both paths

Two paths in one Cartographer, both ship in this window:

**Path A: bundled-pack** (deterministic, free, instant)
- Zod schemas for `Rule` (discriminated union: `MigrationRule | RefactorRule | MitigationRule`), `RulePack`, `RuleSource` in `packages/shared`.
- Drizzle schemas for `breaking_change_maps` (cache, keyed by `cache_key`), `breaking_changes` (rows with polymorphic `kind`).
- `Cartographer.planFromPack({ ecosystem, fromVersion, toVersion })` returns the React 18→19 hardcoded pack (~5–8 real rules: `useRef()` init arg, `defaultProps` removal on function components, string-ref removal, `ReactDOM.render` removal, PropTypes removal on function components).

**Path B: LLM-source** (the platform unlock)
- `Cartographer.planFromSource({ sourceKind: 'changelog' | 'diff' | 'guide-url' | 'refactor-intent' | 'cve-advisory', sourceText, ecosystem?, fromVersion?, toVersion? })`:
  1. Compute `cache_key = sha256(sourceText + sourceKind + agent_kind)`. Look up in `breaking_change_maps`. Hit → return immediately.
  2. Miss → call `LlmRouter.reason()` with `responseFormat: 'rule-classification'` and a system prompt explaining the `Rule` schema.
  3. Zod-validate the LLM's emission. On validation failure, retry with feedback ("your previous response failed Zod validation: ..."), max 2 retries.
  4. Persist to `breaking_change_maps` keyed by `cache_key`. Return `Rule[]`.

- New MCP tool: `plan_change` (replaces the migration-only `plan_migration` from earlier drafts). Accepts either path A inputs or path B inputs.

**Smoke test:** paste the React 19 upgrade guide URL (or its text) into `plan_change` with `sourceKind: 'guide-url'`, watch the LLM emit 4+ valid `MigrationRule` objects. Watch the second call hit the cache.

**Time:** 120 min.

### Hour 7–9: Indexer + recursive-CTE graph queries

- File walker over the snapshot. Parse `.ts`/`.tsx` with **ts-morph**. Extract: imports (file → file edges) and exports.
- Drizzle schemas: `repo_snapshots`, `files`, `imports`, `symbols`. **No Neo4j.**
- Add MCP tools `clone_repository` (Octokit) and `index_repository`.
- The "all files transitively importing X" query is a recursive CTE — write it in `KnowledgeGraphRepository` and unit-test on the demo target.
- **Smoke test:** index the demo target, verify the imports table has the right edges. **Confirm the recursive CTE returns the same set as a Surgeon test prompt would compute manually.**

**Time:** 120 min.

### Hour 9–12: Surgeon — LLM-driven, one rule end-to-end

This is the heart of Renatus. **The LLM does the work; codemods are an optional cache.**

- Zod schemas for `Patch`, `PatchBatch` in `packages/shared`. Drizzle schema for `patches`.
- `LlmRouter` wired up. For development, force the router to `GroqAdapter` (free, fast). Switch to `McpElicitationAdapter` once Bob path is being tested.
- `RetrievalService.retrieve()` — structural (recursive CTE) ∪ semantic (pgvector, added in Wave 3) — to find candidate files. **Returns coherent batches**, not isolated files: the import-connected cluster patched in one LLM context.
- Surgeon service:
  1. Load rules from DB (Cartographer output).
  2. Use retrieval to get coherent file batches.
  3. For each batch, assemble context: files + relevant rules + repo's existing test style.
  4. Call `LlmAdapter.reason()` with a tightly-scoped prompt: "Migrate these files. Return ONLY the new file contents per-path."
  5. Validate output via ts-morph parse. Invalid → retry with parse error feedback (max 2 retries).
  6. Persist patches with confidence (1.0 cached codemod, 0.85 fresh-clean, 0.7 one retry, 0.5 two retries, 0.3 gave up).
- New MCP tools: `find_affected_files`, `propose_patch`, `apply_patch`.

**Time:** 180 min.

### Hour 12–13: Orchestrator + `migrate_repository` end-to-end + backup video

- Inngest workflow `migrate_workflow`:
  ```
  step.run("clone")
  step.run("index")
  step.run("cartograph")        // Cartographer (pack OR LLM-source)
  step.run("patch", { parallel: true, perBatch })   // Surgeon
  // tests + audit land in Wave 3
  return { jobId, patchCount }
  ```
- Tier-1 MCP tool `migrate_repository` sends the Inngest event and returns the job id + SSE URL.
- Slash command invokes `migrate_repository` with `source: react@18, target: react@19`.
- Run `/migrate react-19` against a tiny fixture (5–10 files). Confirm at least one valid patch lands.
- **THE MOMENT IT WORKS — record the demo.** Even if it's rough, even if web app isn't done, even if audit isn't signed. **This is the insurance policy.**
- Export Wave 2 Bob session.

**Time:** 60 min.

### Wave 2 Checkpoint (Hour 13)

- `/migrate react-19` produces ≥1 syntactically valid patch.
- `plan_change` with a pasted changelog URL produces a valid `Rule[]` via LLM in <8s (first call); <100ms (cached).
- Inngest workflow runs the whole pipeline.
- **A rough but working demo video exists.**

**Decision:**
- **Pass:** proceed to Wave 3.
- **Fail:** Test Crew pivot. No "one more hour of debugging" past Hour 14.

---

## Wave 3 — Production depth + Refactor agent (Hour 13–26)

**Goal:** Real demo target repo migrates end-to-end with tests in sandbox and a signed audit. **Plus** Tailwind 3→4 pack pre-baked. **Plus** the Refactor agent fully wired (rename / move / extract intent → patches → signed audit).

**Checkpoint:** if real-repo E2E fails by Hour 22, cut embeddings (semantic retrieval) — structural retrieval alone is enough for demo. If Refactor doesn't land by Hour 26, fall back to migration-only demo arc.

### Hour 13–16: Embeddings + semantic retrieval (pgvector)

- Enable `pgvector` extension on Neon. Drizzle schema for `embeddings` with `vector(768)`, HNSW cosine index.
- Embeddings adapter — Vercel AI SDK over Voyage AI (free tier) or watsonx Granite embeddings if credits up. Local model (`Xenova/all-MiniLM-L6-v2`) as zero-cost fallback.
- Indexer chunks files (function-level) and embeds each chunk.
- `RetrievalService.retrieve(query, 'hybrid')` returns the union ranked by combined structural + semantic score.

**Time:** 180 min.
**Fallback:** skip semantic. Surgeon uses structural only. Acceptable for demo.

### Hour 16–18: Examiner — regression test generation

- Examiner service. Detect test framework from the demo target (Vitest most likely). Snapshot strategy.
- For each patched file: render component / call function pre and post migration, capture output, emit Vitest test.
- New MCP tool `generate_test_for`. Inngest workflow adds the `test_gen` step.

**Time:** 120 min.
**Fallback:** emit placeholder test files with `it.todo()` — still demos.

### Hour 18–22: Auditor + sandbox + signing

- Auditor service. Materialise scratch workspace → Vercel Sandbox → apply patches → install deps → run baseline tests → run generated tests → capture results.
- Signing: `@noble/curves` ed25519. Per-job keypair in `signing_keys` (private key encrypted via `RENATUS_KEK` env var).
- `audit_runs` + `audit_signatures` tables. Audit report shape from SYSTEM-DESIGN §5.4. Bob task ids stamped on `audit_runs.bob_session_refs`.
- New MCP tools `run_test_suite`, `sign_audit`.
- Inngest workflow `migrate_workflow` now ends with `audit` step.

**Time:** 240 min.

### Hour 22–24: Run against real demo target + Tailwind pack

**Migration on real demo target:**
- Switch the slash command's target from the tiny fixture to `test-repos/demo-primary/`.
- Run end-to-end. Watch SSE feed in `apps/web/jobs/[jobId]`.
- Fix what breaks. Most likely culprits: ts-morph parsing of edge syntax, retrieval too noisy, sandbox install timeouts.
- Re-record the demo video at higher quality.

**Tailwind 3→4 pack (in parallel):**
- Pre-bake a second `RulePack` for Tailwind 3→4 in `packages/agents/src/cartographer/rules/tailwind-3-to-4.ts`. 5 real rules from the official upgrade guide.
- Tests against a tiny Tailwind 3 fixture confirm the pack applies.

**Time:** 120 min.

### Hour 24–26: Refactor agent — one new workflow, zero new infrastructure

Same Surgeon, same Auditor, same Inngest steps. Only new things:

- Cartographer's `planFromSource({ sourceKind: 'refactor-intent', sourceText: "rename getUser to loadUser everywhere" })` — system prompt teaches the LLM to emit `RefactorRule[]` (`{ kind: 'rename', from, to, scope }`, `{ kind: 'extract', symbols, into }`, etc.).
- Inngest workflow `refactor_workflow` — identical to `migrate_workflow` except the cartograph step takes refactor-intent inputs.
- Tier-1 MCP tool `refactor_repository`.
- Bob surfaces: `bob-extensions/modes/refactor.md`, `bob-extensions/commands/refactor.md` (markdown-only — both are ~40 lines).
- Smoke test: run `/refactor "rename getUser to loadUser"` against a tiny fixture, verify ≥1 patch lands.

**Time:** 120 min.

### Wave 3 Checkpoint (Hour 26)

- Real demo target migrates end-to-end on Inngest.
- Tests run in sandbox. Audit signed.
- Tailwind 3→4 pack runs against a fixture.
- **Refactor agent runs end-to-end on a fixture, produces signed audit.**
- New, better demo video re-recorded.
- All shipped agents have at least one happy-path execution captured in `bob_sessions/`.

---

## Wave 4 — Security + Q&A + four-agent web app (Hour 26–37)

**Goal:** Two more agents land (Security, Q&A) using the same engine. Web app exposes all four. Audit page renders signed reports. WebContainers replay runs the migrated test suite in the browser. KG renders as a 2D force graph driven by actual patch-batch order.

The web app skeleton was deployed in Wave 1. This wave fills it in.

### Hour 26–28: Security Audit agent

Same Surgeon, same Auditor. New things:

- Cartographer's `planFromSource({ sourceKind: 'cve-advisory', sourceText: cveId | advisoryText })`:
  - If input is a CVE id: fetch from NVD API. Else use the pasted advisory text directly.
  - LLM emits `MitigationRule[]` — same `Rule` schema, different `kind`.
- Examiner extension: when `agent_kind === 'security_audit'`, emit a CVE-replay test (asserts the exploit pattern is no longer triggerable post-patch).
- Inngest workflow `security_audit_workflow` — same shape as migrate, different cartograph input.
- Tier-1 MCP tool `security_audit_repository`.
- Bob surfaces: `bob-extensions/modes/security-audit.md`, `bob-extensions/commands/security-audit.md`.
- Smoke test: paste a known npm CVE into the tool against a deliberately vulnerable fixture, verify the mitigation lands.

**Time:** 120 min.
**Fallback:** if CVE-replay test generation slips, ship without it — the migration test pattern is good enough. CVE-replay is a "would-be-amazing" not "must."

### Hour 28–29: Codebase Q&A agent

The free side-quest. No Surgeon, no Auditor. Uses indexer + retrieval + LLM.

- Inngest workflow `qa_workflow`:
  ```
  step: clone (skip if cached)
  step: index (skip if cached)
  step: retrieve (recursive CTE ∪ pgvector)
  step: answer (LlmAdapter.reason with cited context)
  step: sign-transcript (ed25519 over Q + A + cited file shas)
  ```
- Drizzle: `qa_transcripts` table.
- Tier-1 MCP tool `query_codebase`.
- Bob surfaces: `bob-extensions/modes/ask-codebase.md`, `bob-extensions/commands/ask-codebase.md`.
- Smoke test: ask a question about the indexed demo target ("where is auth middleware composed?"), get cited answer in <8s.

**Time:** 60 min.

### Hour 29–32: Four-agent web app forms + audit page + signature verification

- `/run` route — RSC + client form. Tabbed agent picker (Migrate / Refactor / Security / Q&A). Each tab has its own input form. Submits to a server action that creates a `web_job` and triggers the matching Inngest workflow.
- `/migrate`, `/refactor`, `/security`, `/qa` — shortcut routes that pre-select the matching tab on `/run`.
- `/audit/[jobId]` route — RSC for the canonical JSON, client island for verification widget.
- Pull audit + patch list + test results + Bob session refs + tool-call timeline.
- Bob session deep-links as relative repo paths (clicks resolve when judges clone locally).
- shadcn/ui for layout; Tailwind v4 utilities.

**Time:** 180 min.

### Hour 32–34: 2D knowledge graph as data structure, not decoration

- `/kg/[jobId]` — client-only route (dynamic import).
- `react-force-graph-2d`. Nodes = files, sized by LoC, coloured by rule severity. Edges = imports.
- **Animation order = actual patch-batch order from the Surgeon run.** The graph visualises the same recursive-CTE query that drove retrieval — it shows the data Surgeon used to plan the work.
- Hover tooltips show filename + applied rule ids. Screenshot export button.
- Pitch line wired into the page: *"Renatus operates on the dependency graph — it patches connected file clusters as coherent batches, not files in isolation."*

**Time:** 120 min.
**Fallback:** if dynamic import / canvas perf is broken, replace with a static `<svg>` of the same data — still tells the story.

### Hour 34–36: WebContainers in-browser replay + landing page polish

- `/replay/[jobId]` — client-only, dynamic import StackBlitz SDK.
- Boot WebContainer, pull the patched workspace tarball from blob storage, run `pnpm install` then `pnpm test`. Stream output to a live terminal in the page.
- **In ~30 seconds, judges' browsers run the migrated tests.** No backend round-trip.
- Fallback: if WebContainers fails in the visitor's browser, embed a pre-recorded `<video>` of the same flow.
- `/` landing: install MCP snippet (Bob + Claude Code + Cursor variants), four agent CTAs ("Try Migrate", "Try Refactor", "Try Security Audit", "Try Q&A"), GitHub link, public key for audit verification.
- `/verify` route — paste a signed report + public key → verify client-side.

**Time:** 120 min.

### Hour 36–37: Lighthouse + final wiring

- Lighthouse pass; fix any obvious image/font issues. Mobile-degraded layouts.
- All four Bob extension surfaces have markdown files for all four agents:
  - `modes/`: `migration.md`, `refactor.md`, `security-audit.md`, `ask-codebase.md`
  - `commands/`: `migrate.md`, `refactor.md`, `security-audit.md`, `ask-codebase.md`
  - `skills/`: `renatus-code-changes.md` (one skill, references all four)
  - `mcp-config.example.json` lists all four Tier-1 tools

**Time:** 60 min.

### Wave 4 Checkpoint (Hour 37)

- All four agents callable via MCP. All four runnable from the web app. All four have Bob surfaces.
- Audit URL renders real signed report end-to-end.
- 2D KG renders, animates by patch-batch order.
- WebContainers replay runs the migrated tests in the browser.
- `/run` accepts repo URL + agent + agent-specific input; shows live progress.
- `/verify` validates a signed report client-side.

---

## Wave 5 — Polish & demo (Hour 37–44)

**Goal:** 4/4 successful demo runs. Final video. README. Secret scan. Clean repo.

### Hour 37–39: Demo script + final video record

- Lock the 90-second arc from SYSTEM-DESIGN §18.1. The arc shows **two agents** (Migrate + Refactor) live, with Security + Q&A name-checked on the slide.
- Final recording at high quality. Edit to spec.
- Upload to YouTube (unlisted) + keep local mp4.

**Time:** 120 min.

### Hour 39–42: Live demo rehearsal × 4

- Run start-to-finish 4 times. Time each. Target ≤90s.
- After each, note the slowest beat. Optimise top two. Rerun 4 more times if needed.
- (Cut from 5× because we have more demo surface to cover but the same budget; 4× clean runs beats 5× cluttered runs.)

**Time:** 180 min.

### Hour 42–44: README, secret scan, final commit

- README: install MCP snippet (Bob + Claude Code + Cursor variants), Vercel demo URL, public key, GitHub link. **Lead with "Four agents, one engine, signed audit."** Migration is the example, not the headline.
- `bob_sessions/` final pass: descriptive names, no leaked secrets. Run pre-push secret scan.
- AGENTS.md updated.
- Push everything.

**Time:** 120 min.

### Wave 5 Checkpoint (Hour 44)

- 4/4 demo runs in ≤90s.
- Final video uploaded.
- Repo clean and public.
- README leads with platform pitch, not migration-only pitch.

---

## Wave 6 — Submission (Hour 44–48)

### Hour 44–46: Submission package

- Cover image (1920×1080) — show the four-agent grid, not a single migration screenshot.
- Long + short description, tags. Lead with "audit-grade platform for LLM code changes."
- Lablab.ai submission form.

**Time:** 120 min.

### Hour 46–48: Verification + rest

- Verify demo URL from another network / mobile.
- Verify GitHub repo README renders.
- Verify all four agent CTAs on the landing page actually trigger jobs.
- Sleep.

---

## Agent architecture details

### Shared types (`packages/shared`)

```typescript
export const SemverRangeSchema = z.string().regex(/^\d+(\.\d+)?(\.\d+)?([.\-+].*)?$/);
export const EcosystemSchema = z.enum(['npm', 'pypi', 'cargo', 'maven', 'gradle']);
export const SeveritySchema = z.enum(['low', 'medium', 'high', 'critical']);
export const ConfidenceSchema = z.number().min(0).max(1);
export const AgentKindSchema = z.enum(['migrate', 'refactor', 'security_audit', 'qa']);

export const RuleSchema = z.discriminatedUnion('kind', [
  MigrationRuleSchema,
  RefactorRuleSchema,
  MitigationRuleSchema,
]);

export interface LlmAdapter {
  reason(req: ReasoningRequest): Promise<ReasoningResponse>;
  stream(req: ReasoningRequest): AsyncIterable<ReasoningChunk>;
  capabilities(): LlmCapabilities;
}
```

### Cartographer

One service, two methods:

```typescript
class Cartographer {
  // Path A — deterministic, free, instant
  async planFromPack(input: { ecosystem; fromVersion; toVersion }): Promise<Rule[]>
  
  // Path B — LLM-driven; the platform unlock
  async planFromSource(input: {
    sourceKind: 'changelog' | 'diff' | 'guide-url' | 'refactor-intent' | 'cve-advisory';
    sourceText: string;
    ecosystem?: Ecosystem;
    fromVersion?: string;
    toVersion?: string;
  }): Promise<Rule[]>
}
```

`planFromSource` flow:
1. Compute `cache_key = sha256(sourceText + sourceKind + agent_kind)`.
2. Check `breaking_change_maps` cache. Hit → return.
3. Miss → `LlmRouter.reason()` with system prompt explaining the `Rule` schema for the source kind.
4. Zod-validate. Retry with feedback on failure (max 2).
5. Persist to cache. Return.

**Bundled packs (ship with the codebase):**
- React 18 → 19 (Wave 2)
- Tailwind 3 → 4 (Wave 3)

### Surgeon — LLM-driven

```typescript
class SurgeonService {
  constructor(
    private readonly retrieval: RetrievalService,
    private readonly llm: LlmRouter,
    private readonly ast: AstAdapter,
    private readonly patchRepo: PatchRepository,
  ) {}

  async migrateBatch(batch: FileBatch, rules: Rule[]): Promise<Patch[]> {
    const cached = await this.checkCodemodCache(rules, batch);
    if (cached) return this.applyCodemod(cached, batch);  // 1.0 confidence

    const context = await this.assembleContext(batch, rules);
    let attempt = 0;
    while (attempt < 3) {
      const response = await this.llm.reason({
        system: SYSTEM_PROMPT_FOR_AGENT(agent_kind),
        messages: [{ role: 'user', content: context }],
        responseFormat: 'file-replacement',
      });
      try {
        this.ast.parseAll(response.content);  // validate every file
        return this.persistPatches(batch, response, attempt);
      } catch (err) {
        context.feedback = `Previous attempt produced unparseable code: ${err.message}`;
        attempt++;
      }
    }
    return this.persistUnresolved(batch, rules);  // 0.3
  }
}
```

Key: `migrateBatch` operates on **coherent file batches from the KG**, not isolated files. This is the difference between a file-by-file codemod runner and a graph-aware platform.

### Examiner

Detects framework, generates snapshot-style regression test, validates it can pass. Extension for security_audit: emits CVE-replay tests.

### Auditor

Sandbox + sign. `@noble/curves` ed25519. Canonical JSON.

```typescript
import { ed25519 } from '@noble/curves/ed25519';
import { sha256 } from '@noble/hashes/sha256';

async function sign(report: AuditReportInput, privateKey: Uint8Array) {
  const canonical = canonicaliseJson(report);
  const digest = sha256(new TextEncoder().encode(canonical));
  const signature = ed25519.sign(digest, privateKey);
  return {
    ...report,
    signature: Buffer.from(signature).toString('hex'),
    publicKey: Buffer.from(ed25519.getPublicKey(privateKey)).toString('hex'),
    digest: Buffer.from(digest).toString('hex'),
    signedAt: new Date().toISOString(),
  };
}
```

### Q&A — read-only path

```typescript
class QaService {
  constructor(
    private readonly retrieval: RetrievalService,
    private readonly llm: LlmRouter,
    private readonly signing: SigningService,
  ) {}

  async ask(input: { repoUrl; question }): Promise<QaTranscript> {
    const candidates = await this.retrieval.retrieve(input.question, 'hybrid');
    const context = await this.assembleContext(candidates);
    const response = await this.llm.reason({
      system: QA_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: input.question }, { role: 'system', content: context }],
      responseFormat: 'cited-answer',
    });
    const transcript = {
      question: input.question,
      answer: response.content,
      citations: response.citations,
      ...await this.signing.signTranscript(...),
    };
    return this.persistTranscript(transcript);
  }
}
```

### Drizzle convention

All schemas are TypeScript objects (`pgTable(...)`). `drizzle-kit` generates the DDL. **No hand-written `CREATE TABLE`.**

---

## Fallback decision matrix

| Checkpoint | Trigger | Fallback | Recovery |
| --- | --- | --- | --- |
| Hour 4: Bob ↔ MCP | Can't call tool | STOP; debug | 1–2h |
| Hour 4: WebContainers | Browser refuses to boot | Use pre-recorded test-run video for `/replay` | 0 |
| Hour 5: Sandbox | Vercel Sandbox not provisioned | e2b.dev or local Docker | 30m |
| Hour 5: Async services | Neon / Inngest delays | Local Docker for each | 30m each |
| Hour 13: LLM Cartographer | LLM emits unparseable rules | 2 retries with feedback; fall back to bundled pack if available; if no pack, fail with clear error | 0 |
| Hour 13: First patch | LLM hallucinates unfixably | Pin to a smaller rule set (just `useRef` init arg) | 1h |
| Hour 13: Backup video | Didn't record | Record immediately and continue | 15m |
| Hour 16: Embeddings | pgvector noisy / slow | Skip semantic, use structural only | 0 |
| Hour 22: Sandbox patch-apply | Vercel Sandbox out of quota | e2b.dev failover | 1h |
| Hour 22: Real-repo E2E | Migration produces broken code | Pin demo to tiny fixture; demo arc uses fixture | 0 |
| Hour 26: Refactor agent | Doesn't land in time | Demo arc uses migration only; refactor name-checked on slide | 0 |
| Hour 28: Security agent | CVE-replay test gen breaks | Ship security agent without CVE-replay test (still patches) | 0 |
| Hour 29: Q&A agent | Doesn't land | Drop entirely; pitch as "three agents, Q&A coming soon" | 0 |
| Hour 32: WebContainers | Crashes mid-demo on stage | Recorded video fallback | 0 |
| Hour 32: 2D KG | Slow on demo size | Static SVG of the same data | 1h |
| Hour 42: Live demo | <3/4 success rate | Pre-recorded final | 0 |

Rules:
1. Never compromise Hour-4 Bob ↔ MCP.
2. Record the Hour-13 video unconditionally.
3. Cut features at checkpoints, not between them.
4. **Cut Q&A first, Security second, never Refactor** — Refactor pairs with Migration in the demo arc.

---

## Test Crew pivot plan

**When to execute:** Hour 13 with no working migration patch.

**Pivot:** drop migration entirely. Ship an MCP server exposing one tool — `generate_regression_tests(repoUrl)` — that clones the repo, identifies untested files, generates a Vitest suite per untested file.

**Why it's safe:** Wave 1 + most of Wave 2 infrastructure (MCP, Drizzle, Inngest, indexing, sandbox, signing, web app stub, LlmRouter) is reusable. Drop Cartographer + Surgeon + multi-agent. Examiner becomes the headline agent. Auditor still ships.

**Demo:** open Bob, type `/generate-tests`, watch ~30 new test files appear, `pnpm test` green, signed audit URL.

**Time to execute:** 4–6h from Hour 13 → working pivot by Hour 17–19. Leaves 29+ hours for depth + polish.

---

## Realistic time budget for solo builders

| Bucket | Hours |
| --- | --- |
| Sleep (two short nights, ~5h each) | 10 |
| Meals + breaks + transit | 4 |
| Bob session exports (~3 min × ~35 tasks) | 1.75 |
| Submission form + cover image + video edit | 2 |
| **Active build time available** | **30.25** |

Wave hour ranges are wall-clock — the gap is sleep + meals.

Do not extend a wave with "one more hour." That is how submissions get missed. Use the fallback matrix.

---

## Success metrics

### Minimum viable (must)

- Bob calls Renatus MCP tools.
- **Two agents fully wired end-to-end** (Migrate + at least one other — Refactor preferred).
- One working LLM-generated patch on the demo target.
- **LLM-driven Cartographer accepts arbitrary changelog text and emits valid `Rule[]`.**
- Audit report generated (signed if possible; JSON if not).
- Web app shows audit URL for at least 2 agents.
- `bob_sessions/` has exports for every shipped surface.

### Target (should)

- **All four agents** (Migrate + Refactor + Security + Q&A) wired end-to-end.
- Demo target migrates end-to-end on Inngest.
- Tests run in sandbox; baseline + generated all green.
- Audit signed + verifiable.
- 2D KG (animated by patch-batch order) + WebContainers replay work.
- 90-second live demo runs cleanly, shows ≥2 agents live.
- `/run` direct-mode works for all four agents with at least one provider (Groq).

### Stretch (nice)

- Third migration target wired (Node 18 → 22 from a pasted Node changelog).
- watsonx Granite path active for at least one agent.
- Codemod cache promotions visible in audit (internal — not demoed).
- Mobile-responsive web app polished.
- Auto-PR generation via GitHub adapter.

---

## Risk mitigation

### Technical

- **MCP SDK quirks** — smoke-tested Hour 1–2; raw JSON-RPC fallback documented.
- **AST parse speed** — profiled Hour 6–8; ts-morph is fine on demo target; `ast-grep` available as multi-language fallback.
- **Sandbox outage** — tested Hour 4–5, not Hour 22.
- **LLM hallucinations** — every Surgeon output validated via AST parse + retry-with-feedback. Cartographer output Zod-validated + retry.
- **LLM cost overrun** — `breaking_change_maps` cache means second run of any rule source is free. Codemod cache promotion drops repeated work to zero LLM calls. AI Gateway provides cost telemetry.
- **WebContainers feature support** — smoke-tested Hour 4–5; recorded fallback.
- **LLM Cartographer hallucinates schema** — Zod-validate, 2 retries with parse-error feedback, then fall back to bundled pack (if available) or hard error.

### Process

- **Solo single point of failure** — prefer Test Crew pivot over heroic debugging.
- **Scope creep** — no feature added without cutting a same-weight feature. Q&A is the first thing cut if time slips. Refactor stays paired with Migration.
- **Demo fragility** — Hour-13 rough recording is insurance; Hour-37 final is headline.
- **Four-agent ambition** — each agent past the first is ~30 min new code (rule-source adapter + workflow file + 2 markdown surfaces). The Surgeon, Auditor, sandbox, signing, audit chain, KG, WebContainers are shared across all four. If any agent slips, the others still ship.

### External

- **Service outages** — local Docker fallbacks for Neon / Inngest / Vercel pre-staged.
- **GitHub rate limits** — demo target pre-cloned; no live cloning during demo.
- **Stage network** — pre-load every asset.

---

## Post-hackathon roadmap

1. Multi-language codemods via ast-grep registry (Python, Rust, Go, Java rule packs).
2. Pull-request automation (auto-PR with conventional commit message + filled-in body from rules applied).
3. User accounts via Better Auth.
4. pgGraph upgrade when stable.
5. Enterprise: SSO, audit retention, compliance reports.
6. Community-contributed `RulePack` marketplace (any version pair, any ecosystem).
7. 3D knowledge graph (React Three Fiber upgrade).
8. Policy enforcement agent (style guide → enforcement patches).

---

*End of Implementation Roadmap v4.*
