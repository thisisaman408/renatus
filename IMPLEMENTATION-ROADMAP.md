# Renatus — 48-Hour Implementation Roadmap

> Hour-by-hour build plan for a solo builder with Claude Code + Bob IDE. First-pass authored by Bob in Plan mode (session export under `bob_sessions/task_1_implementation_plan/`); reviewed and corrected by Claude Code.
>
> Companion to `SYSTEM-DESIGN.md`. Read that first.

**Critical Success Factors:**
1. Bob calls a Renatus MCP tool by Hour 4 (non-negotiable).
2. First end-to-end LLM-driven migration on a tiny fixture by Hour 13 (pivot point).
3. **Backup demo video recorded immediately at Hour 13** — not at Hour 38.
4. Real OSS repo migrates end-to-end by Hour 26.
5. WebContainers in-browser replay works by Hour 32.
6. Demo rehearsed 5× by Hour 44.

---

## Document map

- [Solo execution model](#solo-execution-model)
- [Wave 1 — Foundation (0–5)](#wave-1--foundation-hour-05)
- [Wave 2 — First end-to-end (5–13)](#wave-2--first-end-to-end-migration-hour-513)
- [Wave 3 — Production depth (13–26)](#wave-3--production-depth-hour-1326)
- [Wave 4 — Experience layer (26–37)](#wave-4--experience-layer-hour-2637)
- [Wave 5 — Polish & demo (37–44)](#wave-5--polish--demo-hour-3744)
- [Wave 6 — Submission (44–48)](#wave-6--submission-hour-4448)
- [Agent architecture details](#agent-architecture-details)
- [Fallback decision matrix](#fallback-decision-matrix)
- [Test Crew pivot plan](#test-crew-pivot-plan)
- [Realistic time budget](#realistic-time-budget-for-solo-builders)

---

## Solo execution model

Three lanes, not four roles:

| Lane | What runs there |
| --- | --- |
| **Bob foreground** (you in Bob IDE) | Original code generation, agent intelligence, codemod design. **Every task exported to `bob_sessions/` the moment it ends.** |
| **Claude Code (terminal in Bob IDE)** | Reviewing Bob's output. Type/lint/test fixing. Wiring env vars. Commits. Push. Runtime debugging. **Never touches `bob_sessions/`.** |
| **Async services (background)** | Neon, Upstash, Inngest Cloud, Vercel, IBM watsonx. Provisioned in Wave 1; left running. |

Rule: Bob does the thinking. Claude Code does the plumbing. Every Bob task gets exported when done — that is the hackathon audit chain.

---

## Wave 1 — Foundation (Hour 0–5)

**Goal:** Bob calls Renatus MCP. Postgres + Inngest dev are up. Demo repo selected. Web app stub deployed. Secret-leak gate active. `LlmAdapter` interface scaffolded.

**Checkpoint:** if Bob ↔ MCP doesn't work by Hour 4, STOP and debug.

### Hour 0–1: Repo skeleton + demo repo + async provisioning

- Monorepo with pnpm workspaces + Turbo. Strict TypeScript shared config.
- Workspace structure (logical):
  - `packages/mcp-server` — stdio + HTTP transport
  - `packages/shared` — Zod schemas, types, `LlmAdapter` interface
  - `packages/db` — Drizzle schemas, repositories, migrations
  - `packages/agents` — Cartographer / Surgeon / Examiner / Auditor
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
  - **Groq API key** — free tier, fast Llama 3.1 70B / 405B
  - **Gemini API key** — Google AI Studio, free tier, Gemini 2.0 Pro 1M context
  - IBM Cloud hackathon account (~1h provisioning)
  - Vercel project linked to `apps/web`

**Time:** 60 min active.

### Hour 1–2: MCP server + Bob talks to it

- MCP server stdio using `@modelcontextprotocol/sdk`. One no-op tool: `ping`. Zod schemas everywhere.
- Bob custom mode markdown (`bob-extensions/modes/migration.md`) — role + tool access restricted to read + `mcp:renatus:*`.
- Bob slash command (`bob-extensions/commands/migrate.md`) — switches to Migration mode + calls `ping`.
- Wire Bob IDE → local MCP server (Settings → MCP).
- **First export:** run `/migrate test`, watch `ping` succeed, export the Bob session to `bob_sessions/<timestamp>__slash-migrate__hello.md` + screenshot.

**Time:** 60 min.

### Hour 2–3: Database + Inngest dev + secret gate

- Drizzle TypeScript schemas (no raw SQL): `mcp_sessions`, `tool_invocations`, `jobs`, `web_jobs`. `drizzle-kit generate && drizzle-kit migrate`.
- Repository layer for those tables. Transaction-aware.
- `ping` now logs into `tool_invocations` with `bob_task_id` from MCP transport metadata.
- **Inngest dev server** running locally (`npx inngest-cli@latest dev`). One stub function: `migrateRepository` that just logs and returns.
- Pre-push secret-scan script committed and wired into Husky `pre-push`. Test with a fake `sk-XXXX` to verify the gate fails.

**Time:** 60 min.

### Hour 3–4: LlmAdapter scaffolding + web app stub deployed

- `packages/shared/src/llm-adapter.ts` — the `LlmAdapter` interface from SYSTEM-DESIGN §7. `ReasoningRequest`, `ReasoningResponse`, `ReasoningChunk` types.
- `packages/llm/src/`:
  - `mcp-elicitation-adapter.ts` — stub returning a fixed string (no real elicitation yet).
  - `vercel-ai-gateway-adapter.ts` — wraps Vercel AI SDK; routes through the Gateway URL from env.
  - `groq-adapter.ts` — uses the Vercel AI SDK's Groq provider directly (bypass for low-latency).
  - `llm-router.ts` — the routing policy from SYSTEM-DESIGN §7 (MCP > watsonx > Gemini > Groq).
- `apps/web` deployed to Vercel as a stub: a single `/` page with copy + GitHub link + "Try the web app" CTA pointing nowhere yet. **Shareable URL by Hour 4.**

**Time:** 60 min.

### Hour 4–5: Sandbox smoke-test + all four Bob surfaces in place

- **Sandbox smoke-test NOW, not in Wave 3.** Pick one: Vercel Sandbox, e2b.dev, or local Docker. Run a 30-second test: spin up → `pnpm --version` → tear down. If broken, switch now (cheap).
- **WebContainers smoke-test in `apps/web`** — embed StackBlitz SDK on a `/replay-test` route, boot a Hello World, run `node -e "console.log('ok')"`. Verify the visitor's browser can run it. **This is the demo prop — confirm it works on day one.**
- All four Bob extension surfaces have real files:
  - `bob-extensions/modes/migration.md`
  - `bob-extensions/commands/migrate.md`
  - `bob-extensions/skills/migrate-codebase.md` — migration recipe (LLM playbook)
  - `bob-extensions/mcp-config.example.json` — the snippet judges paste into Bob's MCP settings
- Export Wave 1 Bob session.

**Time:** 60 min.

### Wave 1 Checkpoint (Hour 5)

- Bob calls Renatus MCP tools; calls logged to Postgres.
- Inngest dev server running; stub workflow executes.
- Demo repo cloned, tests pass locally.
- Web app stub live on a Vercel URL.
- `LlmAdapter` interface + 3 adapters scaffolded.
- Pre-push secret gate blocks fake `sk-XXXX`.
- Sandbox + WebContainers both smoke-tested.
- At least one Bob session exported.

If any of {Bob ↔ MCP, Postgres writes, secret gate, WebContainers boots} is broken — STOP and fix.

---

## Wave 2 — First end-to-end migration (Hour 5–13)

**Goal:** `/migrate react-19` on a tiny fixture repo produces a real LLM-generated patch end-to-end. **Backup video recorded the moment this works.**

**Checkpoint:** if no working patch by Hour 13, execute the Test Crew pivot (one-page plan below).

### Hour 5–6: Minimal Cartographer

- Zod schemas for `BreakingChange`, `BreakingChangeMap` in `packages/shared`.
- Drizzle schemas for `breaking_change_maps`, `breaking_changes` (TypeScript objects only).
- Cartographer service: **MVP is a hardcoded React 18→19 map** with 5–8 real rules (`useRef()` init arg, `defaultProps` removal on function components, string-ref removal, removed PropTypes, `act` from `react-dom/test-utils` moved to `react`, etc.).
- New MCP tool: `plan_migration`. Returns the structured rule set.

**Time:** 60 min.

### Hour 6–8: Indexer + recursive-CTE graph queries

- File walker over the snapshot. Parse `.ts`/`.tsx` with **ts-morph**. Extract: imports (file → file edges) and exports.
- Drizzle schemas: `repo_snapshots`, `files`, `imports`, `symbols`. **No Neo4j.**
- Add MCP tools `clone_repository` (Octokit) and `index_repository`.
- The "all files transitively importing X" query is a recursive CTE — write it in the `KnowledgeGraphRepository` and unit-test it on the demo target.
- Smoke test: index the demo target, verify the imports table has the right edges.

**Time:** 120 min.

### Hour 8–11: Surgeon — LLM-driven, one rule end-to-end

This is the heart of Renatus. **The LLM does the work; codemods are an optional cache.**

- Zod schemas for `Patch`, `PatchBatch` in `packages/shared`. Drizzle schema for `patches`.
- `LlmRouter` wired up. For development, force the router to use the `GroqAdapter` (free, fast, deterministic-ish behaviour for testing). Switch to `McpElicitationAdapter` once Bob path is being tested.
- Surgeon service:
  1. Load breaking changes from DB.
  2. Use `RetrievalService.retrieve()` — structural (recursive CTE) ∪ semantic (pgvector, added in Wave 3) — to find candidate files.
  3. For each file, assemble context: file contents + relevant breaking-change rules + repo's existing test style snippet.
  4. Call `LlmAdapter.reason()` with a tightly-scoped prompt: "Migrate this file. Return ONLY the new file contents."
  5. Validate output via ts-morph parse. If invalid → retry with the parse error as feedback (max 2 retries).
  6. Persist patch with confidence (1.0 if cached codemod, 0.85 fresh-clean, 0.7 one retry, 0.5 two retries, 0.3 gave up).
- New MCP tools: `find_affected_files`, `propose_patch`, `apply_patch`.

**Time:** 180 min.

### Hour 11–12: Orchestrator + `migrate_repository` end-to-end

- Inngest workflow `migrate_repository`:
  ```
  step.run("clone")
  step.run("index")
  step.run("plan")
  step.run("patch", { parallel: true, perFile })
  // tests and audit land in Wave 3
  return { jobId, patchCount }
  ```
- Tier-1 MCP tool `migrate_repository` sends the Inngest event and returns the job id + SSE URL.
- Slash command `bob-extensions/commands/migrate.md` invokes `migrate_repository` with `source: react@18, target: react@19`.

**Time:** 60 min.

### Hour 12–13: First end-to-end run + **immediate backup recording**

- Run `/migrate react-19` against a tiny fixture (5–10 files). Confirm at least one valid patch lands.
- **THE MOMENT IT WORKS — record the demo.** Even if it's rough, even if web app isn't done, even if audit isn't signed. **This is the insurance policy.** If everything breaks Hour 14+, this is what gets shown.
- Export Wave 2 Bob session.

**Time:** 60 min.

### Wave 2 Checkpoint (Hour 13)

- `/migrate react-19` produces ≥1 syntactically valid patch.
- Inngest workflow runs the whole pipeline.
- **A rough but working demo video exists.**

**Decision:**
- **Pass:** proceed to Wave 3.
- **Fail:** Test Crew pivot. No "one more hour of debugging" past Hour 14.

---

## Wave 3 — Production depth (Hour 13–26)

**Goal:** Real demo target repo migrates end-to-end with tests in sandbox and a signed audit.

**Checkpoint:** if real-repo E2E fails by Hour 26, cut embeddings (semantic retrieval) — structural retrieval alone is enough for demo.

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
- `audit_runs` + `audit_signatures` tables (Drizzle). Audit report shape from SYSTEM-DESIGN §5.4. Bob task ids stamped on `audit_runs.bob_session_refs`.
- New MCP tools `run_test_suite`, `sign_audit`.
- Inngest workflow `migrate_repository` now ends with `audit` step.

**Time:** 240 min.

### Hour 22–24: Run against the real demo target

- Switch the slash command's target from the tiny fixture to `test-repos/demo-primary/`.
- Run end-to-end. Watch the SSE feed in `apps/web/jobs/[jobId]`.
- Fix what breaks. Most likely culprits: ts-morph parsing of edge syntax, retrieval too noisy, sandbox install timeouts.
- Re-record the demo video at higher quality.

**Time:** 120 min.

### Hour 24–26: Cache promotions + cleanup

- Codemod cache: after the first run on demo target, identify patterns the LLM applied 3+ times across files. Promote them to deterministic codemods in a small registry (`packages/agents/src/surgeon/codemod-cache.ts`). Second run uses cache → faster + zero LLM cost.
- Cleanup: remove tiny-fixture test code. Ensure all `bob_sessions/` exports are clean.

**Time:** 120 min.

### Wave 3 Checkpoint (Hour 26)

- Real demo target migrates end-to-end on Inngest.
- Tests run in sandbox. Audit signed.
- New, better demo video re-recorded.
- All four agents have at least one happy-path execution captured in `bob_sessions/`.

---

## Wave 4 — Experience layer (Hour 26–37)

**Goal:** Web app pages render the full product story: live progress, signed audit, 3D KG, **WebContainers in-browser replay**, and the direct-mode `/run` flow.

The web app skeleton was deployed in Wave 1. This wave fills it in.

### Hour 26–29: Audit page + signature verification

- `/audit/[jobId]` route — RSC for the canonical JSON, client island for verification widget.
- Pull audit + patch list + test results + Bob session refs + tool-call timeline.
- Bob session deep-links as relative repo paths (clicks resolve when judges clone locally).
- shadcn/ui for layout; Tailwind v4 utilities.

**Time:** 180 min.

### Hour 29–32: 3D knowledge graph

- `/kg/[jobId]` — client-only route (dynamic import to avoid three.js SSR).
- React Three Fiber + `react-force-graph-3d`. Nodes = files, sized by LoC, coloured by rule severity. Edges = imports.
- Migration animation: pulse each affected file in patch-application order.
- Hover tooltips show filename + applied rule ids. Screenshot export button.

**Time:** 180 min.
**Fallback:** `react-force-graph-2d`. Still impressive.

### Hour 32–34: WebContainers in-browser replay (THE demo prop)

- `/replay/[jobId]` — client-only, dynamic import StackBlitz SDK.
- Boot WebContainer, pull the patched workspace tarball from blob storage, run `pnpm install` then `pnpm test`. Stream output to a live terminal in the page.
- **In ~30 seconds, judges' browsers run the migrated tests.** No backend round-trip. This is the visual hero of the demo.
- Fallback: if WebContainers fails in the visitor's browser, embed a pre-recorded `<video>` of the same flow.

**Time:** 120 min.

### Hour 34–36: Direct-mode `/run` route + LLM provider picker

- `/run` route — RSC + client form. Repo URL + source/target version + LLM provider dropdown (Groq / Gemini / watsonx / "auto").
- Submits to a server action that creates a `web_job` and triggers the same `migrate_repository` Inngest workflow. `LlmRouter` uses the picked provider (or auto-routes).
- `/jobs/[jobId]` route — RSC + EventSource — shows Inngest's live state transitions. **Demo shows: paste repo, hit Run, watch live progress, click audit URL.**

**Time:** 120 min.

### Hour 36–37: Landing page + polish + Lighthouse

- `/` landing: install MCP snippet (copy-paste config for Bob/Claude Code/Cursor), "Run a migration in the browser" CTA → `/run`, GitHub link, public key.
- `/verify` route — paste a signed report + public key → verify client-side.
- Lighthouse pass; fix any obvious image/font issues. Mobile-degraded layouts.

**Time:** 60 min.

### Wave 4 Checkpoint (Hour 37)

- Audit URL renders real signed report end-to-end.
- 3D KG renders.
- WebContainers replay runs the migrated tests in the browser.
- `/run` direct-mode submits a job and shows live progress.

---

## Wave 5 — Polish & demo (Hour 37–44)

**Goal:** 5/5 successful demo runs. Final video. README. Secret scan. Clean repo.

### Hour 37–39: Demo script + final video record

- Lock the 90-second arc from SYSTEM-DESIGN §18.1.
- Final recording at high quality. Edit to spec.
- Upload to YouTube (unlisted) + keep local mp4.

**Time:** 120 min.

### Hour 39–42: Live demo rehearsal × 5

- Run start-to-finish 5 times. Time each. Target ≤90s.
- After each, note the slowest beat. Optimise top two. Rerun 5 more times.

**Time:** 180 min.

### Hour 42–44: README, secret scan, final commit

- README: install MCP snippet (Bob + Claude Code + Cursor variants), Vercel demo URL, public key, GitHub link.
- `bob_sessions/` final pass: descriptive names, no leaked secrets. Run pre-push secret scan.
- AGENTS.md updated.
- Push everything.

**Time:** 120 min.

### Wave 5 Checkpoint (Hour 44)

- 5/5 demo runs in ≤90s.
- Final video uploaded.
- Repo clean and public.

---

## Wave 6 — Submission (Hour 44–48)

### Hour 44–46: Submission package

- Cover image (1920×1080).
- Long + short description, tags.
- Lablab.ai submission form.

**Time:** 120 min.

### Hour 46–48: Verification + rest

- Verify demo URL from another network / mobile.
- Verify GitHub repo README renders.
- Sleep.

---

## Agent architecture details

### Shared types (`packages/shared`)

```typescript
export const SemverRangeSchema = z.string().regex(/^\d+(\.\d+)?(\.\d+)?([.\-+].*)?$/);
export const EcosystemSchema = z.enum(['npm', 'pypi', 'cargo', 'maven']);
export const SeveritySchema = z.enum(['low', 'medium', 'high', 'critical']);
export const ConfidenceSchema = z.number().min(0).max(1);
export const JobStateSchema = z.enum([
  'draft','planning','planned','cloning','cloned','indexing','indexed',
  'patching','patched','testing','tested','auditing','audited',
  'done','failed','aborted','paused',
]);

export interface LlmAdapter {
  reason(req: ReasoningRequest): Promise<ReasoningResponse>;
  stream(req: ReasoningRequest): AsyncIterable<ReasoningChunk>;
  capabilities(): LlmCapabilities;
}
```

### Cartographer

**MVP (Wave 2):** hardcoded React 18→19 map (~5–8 real rules).
**Production (post-hackathon):** fetch from changelog sources, parse with `unified` + `remark`, elicit only on ambiguous severity.

### Surgeon — LLM-driven

```typescript
class SurgeonService {
  constructor(
    private readonly retrieval: RetrievalService,
    private readonly llm: LlmRouter,
    private readonly ast: AstAdapter,
    private readonly patchRepo: PatchRepository,
  ) {}

  async migrateFile(file: FileRow, rules: BreakingChange[]): Promise<Patch> {
    const cached = await this.checkCodemodCache(rules, file);
    if (cached) return this.applyCodemod(cached, file);  // 1.0 confidence

    const context = await this.assembleContext(file, rules);
    let attempt = 0;
    while (attempt < 3) {
      const response = await this.llm.reason({
        system: MIGRATION_SYSTEM_PROMPT,
        messages: [{ role: 'user', content: context }],
        responseFormat: 'file-replacement',
      });
      try {
        this.ast.parse(response.content, file.language);  // validate
        return this.persistPatch(file, response, attempt);
      } catch (err) {
        context.feedback = `Previous attempt produced unparseable code: ${err.message}`;
        attempt++;
      }
    }
    return this.persistUnresolved(file, rules);  // 0.3
  }
}
```

### Examiner

Detects framework, generates snapshot-style regression test, validates it can pass.

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

### Drizzle convention

All schemas are TypeScript objects (`pgTable(...)`). `drizzle-kit` generates the DDL. **No hand-written `CREATE TABLE`.**

---

## Fallback decision matrix

| Checkpoint | Trigger | Fallback | Recovery |
| --- | --- | --- | --- |
| Hour 4: Bob ↔ MCP | Can't call tool | STOP; debug | 1–2h |
| Hour 4: WebContainers | Browser refuses to boot | Use pre-recorded test-run video for `/replay` | 0 |
| Hour 5: Sandbox | Vercel Sandbox not provisioned | e2b.dev or local Docker | 30m |
| Hour 5: Async services | Neon / Upstash / Inngest delays | Local Docker for each | 30m each |
| Hour 13: First patch | LLM hallucinates unfixably | Pin to a smaller rule set (just `useRef` init arg) | 1h |
| Hour 13: Backup video | Didn't record | Record immediately and continue | 15m |
| Hour 16: Embeddings | pgvector noisy / slow | Skip semantic, use structural only | 0 |
| Hour 22: Sandbox patch-apply | Vercel Sandbox out of quota | e2b.dev failover | 1h |
| Hour 22: Real-repo E2E | Migration produces broken code | Pin demo to tiny fixture; remove "real OSS" claim from pitch | 0 |
| Hour 26: BullMQ vs Inngest | Inngest free-tier limit | Switch to local Inngest dev for demo | 30m |
| Hour 32: WebContainers | Crashes mid-demo on stage | Recorded video fallback | 0 |
| Hour 32: 3D KG | Slow on demo size | 2D force graph | 1h |
| Hour 42: Live demo | <4/5 success rate | Pre-recorded final | 0 |

Rules:
1. Never compromise Hour-4 Bob ↔ MCP.
2. Record the Hour-13 video unconditionally.
3. Cut features at checkpoints, not between them.

---

## Test Crew pivot plan

**When to execute:** Hour 13 with no working migration patch.

**Pivot:** an MCP server exposing one tool — `generate_regression_tests(repoUrl)` — that clones the repo, identifies untested files (test/source path conventions + coverage gaps), generates a Vitest suite per untested file.

**Why it's safe:** Wave 1 + Wave 2 infrastructure (MCP, Drizzle, Inngest, indexing, sandbox, signing, web app stub) is reusable. Drop Cartographer + Surgeon + codemods. Examiner becomes the headline agent. Auditor still ships.

**Demo:** open Bob, type `/generate-tests`, watch ~30 new test files appear, `pnpm test` green, signed audit URL.

**Time to execute:** 4–6h from Hour 13 → working pivot by Hour 17–19. Leaves 29+ hours for depth + polish.

**Field positioning:** less differentiated against the Quickstart theme but a working tool beats a broken differentiator.

---

## Realistic time budget for solo builders

| Bucket | Hours |
| --- | --- |
| Sleep (two short nights, ~5h each) | 10 |
| Meals + breaks + transit | 4 |
| Bob session exports (~3 min × ~30 tasks) | 1.5 |
| Submission form + cover image + video edit | 2 |
| **Active build time available** | **30.5** |

Task budgets fit within 30.5 active hours. Wave hour ranges are wall-clock — the gap is sleep + meals.

Do not extend a wave with "one more hour." That is how submissions get missed. Use the fallback matrix.

---

## Risk mitigation

### Technical

- **MCP SDK quirks** — smoke-tested Hour 1–2; raw JSON-RPC fallback documented.
- **AST parse speed** — profiled Hour 6–8; ts-morph is fine on demo target; `ast-grep` available as multi-language fallback.
- **Sandbox outage** — tested Hour 4–5, not Hour 22.
- **LLM hallucinations** — every Surgeon output validated via AST parse + retry-with-feedback.
- **LLM cost overrun** — codemod cache promotion drops repeated work to zero LLM calls. AI Gateway provides cost telemetry.
- **WebContainers feature support** — smoke-tested Hour 4–5; recorded fallback.

### Process

- **Solo single point of failure** — prefer Test Crew pivot over heroic debugging.
- **Scope creep** — no feature added without cutting a same-weight feature.
- **Demo fragility** — Hour-13 rough recording is insurance; Hour-37 final is headline.

### External

- **Service outages** — local Docker fallbacks for Neon / Inngest / Vercel pre-staged.
- **GitHub rate limits** — demo target pre-cloned; no live cloning during demo.
- **Stage network** — pre-load every asset.

---

## Success metrics

### Minimum viable (must)
- Bob calls Renatus MCP tools.
- One working LLM-generated patch on a fixture.
- Audit report generated (signed if possible; JSON if not).
- Web app shows the audit URL.
- `bob_sessions/` has exports for every surface.

### Target (should)
- Demo target migrates end-to-end on Inngest.
- Tests run in sandbox; baseline + generated all green.
- Audit signed + verifiable.
- 3D KG + WebContainers replay work.
- 90-second live demo runs cleanly.
- `/run` direct-mode works with at least one provider (Groq).

### Stretch (nice)
- Second migration target wired (Node 18 → 22 or Tailwind 3 → 4).
- watsonx Granite path active.
- Codemod cache promotions visible in audit.
- Mobile-responsive web app polished.

---

## Post-hackathon roadmap

1. Refactor / Q&A / security-review / policy modes (architecture-ready).
2. Multi-language codemods via ast-grep registry.
3. Pull-request automation.
4. User accounts via Better Auth.
5. pgGraph upgrade when stable.
6. Enterprise: SSO, audit retention, compliance reports.
7. Community-contributed `BreakingChangeMap` marketplace.

---

*End of Implementation Roadmap.*
