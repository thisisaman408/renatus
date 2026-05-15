# Renatus — Multi-Agent Code Migration Crew

> Codebases die not from age but from version drift. Renatus is the crew that brings them back.

Project: **Renatus** · Event: **IBM Bob Hackathon** · Window: **Fri 15 May 8:30 PM IST → Sun 17 May 8:30 PM IST** · Builder: solo · Stack: Next.js 16 + R3F + watsonx.ai Granite-3 (`@ibm-cloud/watsonx-ai`) at runtime + IBM Bob IDE as the 48-hour dev partner.

---

## 1. Product statement

Renatus is a single-page web app that takes a public GitHub repository URL and a migration target (e.g. `react@18 → react@19`), and produces:

1. A complete, reviewable, file-by-file migration patch set.
2. A regression test suite generated from the *original* behavior.
3. A signed audit report containing the per-agent reasoning trail proving how each change was decided.

The product is operated by a crew of **four specialist AI agents** coordinated by an in-house orchestrator (watsonx.ai Granite + LangGraph). All runtime LLM calls hit **watsonx.ai Granite-3** via `@ibm-cloud/watsonx-ai`, with **Anthropic Claude Sonnet 4.6** as the fallback for the Surgeon's longest cross-file context windows:

| Agent | Role | Output artifact |
|---|---|---|
| **Cartographer** | Reads the *upstream* release notes / changelog / breaking-change docs. Produces a structured map of every API surface that changed. | `breaking_changes.json` |
| **Surgeon** | Reads *your* repository through a pgvector retrieval layer (file embeddings indexed via `@octokit/rest`). Locates every callsite, import, JSX use, hook use, type reference, or pattern that intersects a breaking change. Generates patches. | `patches.diff` |
| **Examiner** | Generates regression tests that pin original behavior of every touched module. Runs them against the original code to confirm green-baseline. | `tests/*.spec.ts` + `baseline.json` |
| **Auditor** | Runs migrated code against Examiner's tests in a sandbox. Diff-classifies every deviation. Exports signed audit report including per-agent reasoning trail. | `audit.json` + `audit.pdf` |

The product's wedge is the **four-role crew architecture** — Cartographer → Surgeon → Examiner → Auditor — with regression-test pinning and a signed audit log. Whole-codebase reasoning is delivered by watsonx Granite calls over pgvector-retrieved code chunks from the indexed repo. No existing migration tool decomposes the problem into this four-role crew with verifiable audit evidence per agent run.

Renatus does not replace a senior engineer. It produces a migration draft that a senior engineer can verify in 30 minutes instead of authoring in 2 weeks. Every patch carries an `agent_run_id` so the engineer can replay the Granite inference call and its retrieved context.

**Bob's role in this project is upstream of runtime.** IBM Bob is the AI IDE the solo builder uses during the 48-hour hackathon to design, implement, and verify the four agents. Bob did not "ship in" Renatus. Bob's contribution is recorded as 30+ exported task sessions in `bob_sessions/` — the construction evidence judges read. See §2.3 for the full framing.

Demo target: live React 18 → 19 migration of a real OSS repo on stage, in under 5 minutes, with regression tests turning green at the end.

---

## 2. Why this wins

### 2.1 Direct competitor analysis (PR review, docs, onboarding)

The IBM Bob field has 282 teams with specific pitches. 35 are explicitly in "developer tools." Their pitches cluster into four lanes:

| Lane | Sample competitors | What they do | Gap |
|---|---|---|---|
| PR review / merge gate | PRism Labs, ShieldOps (BobMerge Shield), DevPilot AI, Eclipse Lab, CodeSheriff | Score a diff. Comment on a PR. Maybe block merge. | They only see the diff hunk. No four-role crew, no regression-test pinning, no signed audit. |
| Onboarding / docs gen | RepoReady, CodeKalesh, works-on-my-machine (Fossick), DevPilot AI, Matrix, BobTheCoder | Turn a repo into a getting-started guide. | Read-only. Produces a doc nobody reads. No verifiable artifact. |
| Code Q&A / explainer | CodeSheriff, RepoMind, Repo Mind, DevMind, Syntax Architects, Team CogniSage | "Ask the repo questions." | Chatbot wrappers. Demo well, ship nothing. |
| Codebase modernization (adjacent) | Simply Lovely (COBOL → Java), Autopsy (analysis), GranLegacy (legacy RCA) | Legacy modernization at a different scope. | Different demo target. Renatus is the only team migrating *modern* version boundaries with verification. |

15+ direct PR-review competitors. 5+ docs-debt competitors. **Zero teams** pitching cross-version migration with multi-agent verification. The closest analog (Simply Lovely's BFSI COBOL → Java) is enterprise-pitched but undemoable on a 3-minute video — they cannot live-migrate COBOL on stage. Renatus can live-migrate React on stage.

### 2.2 Empty-lane exploitation (dev-tools + multi-agent + governance)

From the white-space matrix in `MARKET-INTEL.md`:

| Combo | Teams across 1,577 entrants | Renatus exploits |
|---|---:|---|
| developer tools × multi-agent / swarm | **0** | ✅ 4-agent crew is the structural claim |
| developer tools × guardrails / governance | **0** | ✅ Auditor agent + signed report is the governance claim |
| developer tools × graph / KG | 1 | ✅ Codebase knowledge graph in Neo4j is the visualization claim |
| developer tools × rag / retrieval | 1 | ✅ Cartographer's changelog ingestion is RAG |

Four white-space combos hit in one product. No other Bob team is doing this. The Auditor's signed report is the only governance artifact in the entire dev-tools lane.

### 2.3 Why Bob is the right dev partner for this build

IBM Bob is IBM's AI dev IDE — analogous to Cursor or VS Code with a coding agent baked in. For Renatus, **Bob is the engineering partner for the 48-hour hackathon, not a runtime dependency of the shipped product.**

| Bob mode | How it's used during the 48-hour build |
|---|---|
| **Plan mode** | Designing each of the four agents: input/output contracts, prompt scaffolds, retry policies, fallback paths. Reading the full repo before proposing structural edits. |
| **Code mode** | Implementing the Drizzle schemas, BullMQ flows, Granite call wrappers, SSE plumbing, R3F graph, and audit signing — file-by-file, with whole-repo context. |
| **Orchestrator mode** | Running end-to-end demos on demo repos: triggering migrations, watching failures, regenerating prompts, smoke-testing the sandbox. |
| **`/init`, `/review`, `/commit`** | Bootstrapping the Next.js project, pre-merge review of agent code, conventional-commit messages. |

Every Bob IDE task session is exported to `bob_sessions/` with a screenshot + a markdown transcript. By submission time, that folder contains **30+ deep sessions** spanning all four agents, the orchestrator, the sandbox, and the demo-day rehearsals. Judges open these to evaluate Bob usage.

**At runtime — when an end user opens `renatus.vercel.app` and starts a migration — Bob is not in the loop.** Renatus calls watsonx.ai Granite-3 (`granite-3.0-8b-instruct` for Cartographer/Examiner/Auditor, `granite-3.0-2b-instruct` for quick classification, Claude Sonnet 4.6 as Surgeon's long-context fallback). Bob is not deployed. Bob is not on the critical path of a single migration.

The judging criterion "meaningful use of Bob" is satisfied by the construction evidence in `bob_sessions/`, not by Bob being a runtime service of the shipped product. The 4-agent crew architecture + signed audit trail is the product's architectural wedge; Bob is what made building that architecture in 48 hours possible.

> Building a 4-agent crew with regression-test pinning and signed audit reports in 48 hours requires a dev partner that can read the whole repository, plan multi-file changes, and reason across the codebase as you build. That is exactly Bob's pitch. The `bob_sessions/` folder is the receipt — 30+ sessions across Plan, Code, and Orchestrator modes, each one a structural engineering step. The same product built without Bob would have taken three weeks. Bob is core to *how Renatus exists*, not to what Renatus calls at runtime.

### 2.4 Judging criteria mapping

The submission rubric (inferred from "meaningful use of Bob may be disqualified" and the standard lablab.ai rubric):

| Criterion | Score path |
|---|---|
| Meaningful use of Bob | 30+ Bob IDE task sessions across all four agents exported to `bob_sessions/`, each with screenshot + markdown transcript. Bob is **the dev partner that built Renatus in 48 hours**; the receipt is the folder. |
| Technical depth | 4 agents, BullMQ queue, Neo4j graph, sandbox execution, Drizzle schema, Zod-typed I/O, watsonx.ai Granite runtime, pgvector retrieval. |
| Innovation | Multi-agent migration crew with regression-test pinning and signed audit log. Zero teams in this lane. |
| Business value | F500 framework migrations cost $500K–$5M in consultants. Auditable migration is the unlock. |
| Demo quality | Live React 18 → 19 migration on a real public repo, tests turning green, demo-time click-through from agent timeline to the Bob session that built that agent. |
| Polish | Dark Stripe-Docs × GitHub aesthetic, R3F knowledge graph, side-by-side diff viewer, embedded per-agent reasoning trail. |
| Documentation | README + system design + `bob_sessions/` construction evidence in repo. |

---

## 3. Prize eligibility & submission checklist

Prize pool: $10K (1st $5K, 2nd $3K, 3rd $2K). All three are realistically reachable from this scope. Target: 1st.

### 3.1 Mandatory: meaningful use of Bob

> *"All submissions must clearly demonstrate how IBM Bob is used in the solution. Projects that do not show meaningful use of Bob may be disqualified."*

Bob's meaningfulness for Renatus is measured by the **depth and breadth of dev-time use captured in `bob_sessions/`**, not by Bob being on the product's runtime critical path. Renatus runs on watsonx.ai Granite-3 in production; Bob is the IDE the solo builder lived in for 48 hours to design and build the four agents.

The `bob_sessions/` folder ships in the submission repo with at least 30 task session exports (screenshot + markdown transcript per session). By category:

| # | Bob task session (representative) | What Bob did during the build | Why it's meaningful |
|---:|---|---|---|
| 1 | `plan/01-cartographer-agent-design.md` | Plan-mode session designing Cartographer's prompt, retry policy, Zod schema, fallback to pre-seeded catalog. Bob read the whole repo before proposing edits. | Whole-repo planning of an agent's contract. |
| 2 | `code/02-cartographer-impl.md` | Code-mode session implementing `agents/cartographer/index.ts`, `prompt.ts`, `schema.ts` end-to-end. | Multi-file structural implementation. |
| 3 | `plan/03-surgeon-agent-design.md` + `code/04-surgeon-scan.md` + `code/05-surgeon-patch.md` | Three sessions covering Surgeon's two-phase architecture and the pgvector retrieval layer. | The hardest agent. Bob's full-repo reading drove the design. |
| 4 | `plan/06-examiner-baseline-strategy.md` + `code/07-examiner-impl.md` | Examiner's baseline-must-pass policy and Vitest spec generator. | Cross-file reasoning over how symbols are used elsewhere. |
| 5 | `plan/08-auditor-signing-flow.md` + `code/09-auditor-impl.md` | Auditor's sandbox + ed25519 signing flow. | Multi-step orchestration: sandbox, test runs, classification, signing. |
| 6 | `code/10-watsonx-adapter.md` | Implementing `lib/watsonx.ts` and IAM token refresh. | Real wiring of the runtime LLM Bob is helping ship. |
| 7 | `orchestrator/11-end-to-end-demo-run.md` | Orchestrator-mode session running a full migration on a demo repo, watching failures, regenerating prompts. | Demonstrates Bob driving the whole stack. |
| 8 | 20+ further sessions across `/review`, `/commit`, polish, R3F graph, R3F debug, the SSE plumbing, the Drizzle schema, sandbox setup, demo-day rehearsals. | … | Depth across every layer. |

Each session export contains:
- `screenshot.png` of Bob's task console at completion
- `transcript.md` with the full Plan/Code/Orchestrator session
- `summary.md` written by the builder describing what shipped from that session
- A pointer to the commit SHA the session produced

The folder is the proof. The product is built **by** Bob, not **on** Bob.

### 3.2 Mandatory: exported Bob task sessions in repo

The submission GitHub repo includes a top-level `bob_sessions/` folder. This is the hackathon's mandatory submission folder; the **name and location are non-negotiable** because the judges' tooling looks there.

```
bob_sessions/
├── README.md                            # index of all sessions, with categorization
├── plan/                                # Plan-mode sessions (agent design, architecture)
│   ├── 01-cartographer-agent-design/
│   │   ├── screenshot.png
│   │   ├── transcript.md
│   │   └── summary.md
│   ├── 03-surgeon-agent-design/...
│   ├── 06-examiner-baseline-strategy/...
│   └── 08-auditor-signing-flow/...
├── code/                                # Code-mode sessions (implementation)
│   ├── 02-cartographer-impl/...
│   ├── 04-surgeon-scan/...
│   ├── 05-surgeon-patch/...
│   ├── 07-examiner-impl/...
│   ├── 09-auditor-impl/...
│   ├── 10-watsonx-adapter/...
│   └── …20+ more…
├── orchestrator/                        # Orchestrator-mode end-to-end runs
│   ├── 11-end-to-end-demo-run/...
│   └── 12-demo-rehearsal-react-19/...
└── review-commit/                       # /review and /commit sessions
    └── …
```

Each session subfolder contains the four files listed in §3.1. The repo root also has a `.bobignore` configured to keep Bob from reading `bob_sessions/` itself when running new sessions (avoids meta-recursion).

The session-export procedure (using Bob IDE's built-in task export) is documented in §12.6. There is no runtime export endpoint to build — `bob_sessions/` is populated incrementally as the builder finishes each Bob task during the 48-hour build window.

### 3.3 Lablab.ai submission requirements

Confirmed required artifacts:

| Artifact | Where | Status path |
|---|---|---|
| Public GitHub repo | `github.com/thisisaman408/renatus` (MIT license) | scaffold Wed–Thu, freeze Sun 5 PM IST |
| `bob_sessions/` folder | repo root, 30+ exported Bob IDE task sessions | populated incrementally during the 48-hour build; final pass Sun afternoon |
| Audit artifact (`/audit/`) | per-migration audit JSON + PDF for a demo run | produced during final live run Sun afternoon |
| Demo URL | Vercel preview pinned to a tag | `renatus.vercel.app` reserved Wed |
| 3-min video | YouTube (unlisted) + Loom backup | recorded Sun 4–5 PM IST |
| Slide deck | Figma → PDF, 10 slides | drafted Thu, polished Sun 5–6 PM IST |
| Cover image | 1920×1080 PNG, dark theme, agent crew motif | produced Thu |
| Project page on lablab.ai | submission form | filed Sun 6 PM IST (2.5h buffer) |

Registration deadline before event: **Fri 15 May 7:00 AM ET / 1:00 PM CET**. Builder must be registered before this cutoff. SOP §12.1 handles.

---

## 4. Feature list (P0 / P1 / P2)

### 4.1 P0 — Must ship in 48h

1. **New Migration wizard**: paste GitHub URL, pick migration target from catalog, click Start.
2. **Cartographer agent**: ingests breaking changes for at least React 18 → 19. (Pre-seeded JSON if the watsonx Granite call fails — see §14 R1.)
3. **Surgeon agent**: reads target repo via pgvector retrieval, calls Granite (or Claude for long contexts), emits patches as unified diffs with rationale.
4. **Examiner agent**: generates Vitest specs for at least 3 affected files.
5. **Auditor agent**: runs Examiner specs against `pre/` and `post/` versions of each file, emits `audit.json`.
6. **Live work view**: 4 columns, one per agent, streaming progress via SSE. Cards bounce in as files move through stages.
7. **File-by-file diff viewer**: side-by-side with `react-diff-view`.
8. **Audit report viewer**: web view with embedded per-agent reasoning trail (the Granite call's prompt + response + retrieved context chunks) per file.
9. **Audit export**: button that produces `audit.json` + `audit.pdf` (per-migration artifact, includes the full agent_runs trail). Separate from `bob_sessions/` — that folder is populated by the builder via Bob IDE exports during the build, not by the deployed product.
10. **Past migrations list**: minimal table showing prior runs.
11. **Settings**: paste `WATSONX_AI_API_KEY` + `WATSONX_PROJECT_ID` + GitHub token + (optional) `ANTHROPIC_API_KEY` for the Surgeon long-context fallback.
12. **Deploy on Vercel**, MIT license, public repo.

Acceptance criterion for P0: can run `react@18 → 19` on one of the three pre-picked demo repos end-to-end in under 5 minutes on a warm cache. Audit shows ≥1 file with green regression tests post-migration.

### 4.2 P1 — Differentiators

1. **3D Codebase Knowledge Graph** (R3F + react-force-graph): nodes = files, edges = imports, highlight = files touched by current migration.
2. **Parallel agent execution**: BullMQ workers run Surgeon and Examiner across files concurrently, capped at 4 workers.
3. **Second migration target wired**: Tailwind 3 → 4 catalog populated. Demo backup.
4. **PDF audit export**: pretty PDF via `@react-pdf/renderer`.
5. **Agent reasoning trail embed**: collapsible per-file panel showing the Granite prompt, retrieved pgvector context, and model response for each agent that touched the file. Plus a deep-link to the Bob IDE session (in `bob_sessions/`) that *built* that agent during the hackathon.
6. **Reduced motion** support (`prefers-reduced-motion` disables Framer transitions).
7. **Skeleton shimmers** on every async surface (no spinners anywhere).

### 4.3 P2 — Polish & wow

1. **Animated dependency wave**: when Surgeon updates file A, downstream files (importers) pulse in the graph.
2. **Replay mode**: scrub the timeline of a past migration like a video.
3. **Side-by-side test output**: original test output vs migrated test output, character-diffed.
4. **Migration target catalog** with React 18→19, Python 3.10→3.12, Tailwind 3→4, Drizzle 0.x→1.0, Java 17→21.
5. **Signed audit report**: ed25519 signature over the audit hash, public key in repo. (Marketing not crypto.)
6. **Cover image autogen**: page that renders a shareable image of the migration result.
7. **CLI**: `npx renatus migrate ./my-repo --target react@19`. (Stretch.)

Anything below P0 line in §12 timeline gets cut if behind schedule.

---

## 5. System architecture

### 5.1 ASCII diagram

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                              BROWSER (Next.js)                                │
│  ┌─────────────────┐   ┌──────────────────┐   ┌─────────────────────────┐    │
│  │ New Migration   │   │ 4-Agent Live View│   │ Diff / Tests / Audit    │    │
│  │ Wizard          │   │ (SSE)            │   │ R3F Graph               │    │
│  └────────┬────────┘   └────────┬─────────┘   └──────────┬──────────────┘    │
│           │ Server Action       │ EventSource            │ Server Component  │
└───────────┼─────────────────────┼────────────────────────┼───────────────────┘
            │                     │                        │
┌───────────▼─────────────────────▼────────────────────────▼───────────────────┐
│                    NEXT.JS APP ROUTER (Vercel, Node runtime)                  │
│                                                                               │
│   /api/migrations (POST)        /api/migrations/[id]/stream (GET, SSE)        │
│   /api/migrations/[id]/audit    /api/migrations/[id]/inference-trail          │
│                                                                               │
│   server actions: startMigration, cancelMigration, retryFile                  │
└─────┬─────────────────────┬─────────────────────┬───────────────────┬────────┘
      │                     │                     │                   │
      ▼                     ▼                     ▼                   ▼
┌─────────────┐      ┌──────────────┐     ┌──────────────┐    ┌────────────────────┐
│ Neon        │      │ Upstash      │     │ Neo4j        │    │ watsonx.ai         │
│ Postgres    │      │ Redis +      │     │ AuraDB       │    │ Granite-3          │
│ (Drizzle +  │      │ BullMQ       │     │ (Graph)      │    │ (@ibm-cloud/       │
│  pgvector)  │      │              │     │              │    │  watsonx-ai)       │
│             │      │ queues:      │     │ File, Symbol │    │                    │
│ migrations  │      │ - cartog     │     │ Module, Test │    │ - granite-3.0-8b   │
│ agents      │      │ - surgeon    │     │ BreakingCh.  │    │   instruct (main)  │
│ agent_runs  │      │ - examiner   │     │              │    │ - granite-3.0-2b   │
│ files       │      │ - auditor    │     │ IMPORTS      │    │   instruct (fast)  │
│ patches     │      │              │     │ DEFINES      │    │                    │
│ tests       │      │              │     │ TESTS        │    │ + Claude Sonnet    │
│ audit_evt   │      │              │     │ AFFECTS      │    │   4.6 (Surgeon     │
│ repos       │      │              │     │              │    │   long-ctx fallbk) │
│ users       │      │              │     │              │    └────────────────────┘
│ api_keys    │      │              │     │              │
│ embeddings  │      │              │     │              │
│ (pgvector)  │      │              │     │              │
└─────────────┘      └──────┬───────┘     └──────────────┘
                            │
                            ▼
                  ┌─────────────────────┐
                  │ BullMQ Workers      │
                  │ (Vercel Functions   │
                  │ + long-running on   │
                  │  Vercel cron + a    │
                  │  Fly.io machine)    │
                  │                     │
                  │ each worker = one   │
                  │ agent dequeue loop  │
                  │ orchestrator =      │
                  │ Granite + LangGraph │
                  │                     │
                  │ sandbox: node-pty   │
                  │ inside isolated     │
                  │ tmpfs               │
                  └─────────────────────┘

  ┌─────────────────────────────────────────────────────────────────────┐
  │ IBM Bob IDE — dev partner during build (NOT deployed at runtime)    │
  │  Plan / Code / Orchestrator modes used by solo builder for 48h.     │
  │  Every task session exported to bob_sessions/ as construction       │
  │  evidence for judging. Not on any runtime path.                     │
  └────────────────────────────────┬────────────────────────────────────┘
                                   │ (dev-time only)
                                   ▼
                            ┌──────────────┐
                            │ solo builder │
                            └──────────────┘
```

### 5.2 Component breakdown

| Layer | Component | Tech | Responsibility |
|---|---|---|---|
| UI | App shell | Next 16 App Router | Routing, server components, layouts |
| UI | New migration | Server action + form | Validate inputs, create migration row, enqueue Cartographer job |
| UI | Live view | RSC + Client + EventSource | Render 4-column board, subscribe to SSE per migration |
| UI | Graph | R3F + react-force-graph-3d | Render codebase as 3D force graph, animate `AFFECTS` edges |
| UI | Diff viewer | react-diff-view | Side-by-side unified diff per file |
| UI | Audit | Server component | Stream `audit.json` + embed per-agent inference trail (Granite/Claude prompts + responses) |
| API | Route handlers | Next 16 Route Handlers | REST surface |
| API | SSE | Native ReadableStream | Push agent state changes to client |
| Orchestration | Job queue | BullMQ on Upstash Redis | Parallel agent execution, retries, backoff |
| Orchestration | Agent coordinator | LangGraph + watsonx Granite | State-machine across the 4 agents, routing decisions |
| Worker | Cartographer | Node worker | Granite call reading upstream changelog (chunks retrieved by pgvector over `@octokit/rest`-fetched files) |
| Worker | Surgeon | Node worker | Granite call (Claude Sonnet 4.6 fallback for long context) reading target repo via pgvector retrieval, emitting patches |
| Worker | Examiner | Node worker | Granite call generating tests; Granite-2b for cheap smoke tests as fallback |
| Worker | Auditor | Node worker | Spawn sandbox, run tests, classify, emit audit; Granite call for summary synthesis |
| Sandbox | Test runner | node-pty in tmpfs, network-off | Run Vitest against pre/ and post/ versions |
| Data | Postgres | Neon (with pgvector extension) | Source of truth for migration state + file embeddings for retrieval |
| Data | Redis | Upstash | Queue + ephemeral pubsub for SSE |
| Data | Neo4j | AuraDB | Code knowledge graph, queried for impact analysis and visualization |
| External | watsonx.ai | `@ibm-cloud/watsonx-ai` SDK | Runtime LLM. Granite-3 8b/2b. IAM token flow per IBM Cloud guide. |
| External | Anthropic | `@anthropic-ai/sdk`, Claude Sonnet 4.6 | Surgeon long-context fallback when input > Granite's window |
| External | GitHub | Octokit (`@octokit/rest`) | Clone target repo into worker tmpfs; fetch file trees for embedding |
| Infra | Hosting | Vercel | Next.js app + cron + edge |
| Infra | Long-running workers | Fly.io machine | BullMQ workers that exceed Vercel function limits |
| Dev | IBM Bob IDE | desktop app | **Dev-time only**: design, implement, review, and demo the four agents during the 48-hour build. Not deployed. Sessions exported to `bob_sessions/`. |

### 5.3 Sequence: end-to-end migration flow

```
User                Next Server          Postgres         Redis/BullMQ      Cartographer       Surgeon (×N)       Examiner (×N)       Auditor           Neo4j
 │                      │                     │                │                  │                   │                   │                  │                │
 ├── POST /api/migrations (repoUrl, target)
 │                      │
 │                      ├── INSERT migrations row (status=queued)
 │                      │                     │
 │                      ├── enqueue carto job
 │                      │                                      ├── dequeue
 │                      │                                      │                  ├── Octokit fetch upstream changelog/RFC files
 │                      │                                      │                  ├── embed + pgvector retrieve top-k chunks
 │                      │                                      │                  ├── watsonx.generate(granite-3-8b-instruct, prompt+chunks)
 │                      │                                      │                  │   parse → breaking_changes.json
 │                      │                                      │                  ├── INSERT breaking_changes
 │                      │                                      │                  ├── enqueue clone job
 │  EventSource subscribe ───→ stream agent state
 │                                                                                                     ├── Octokit clone target repo to tmpfs
 │                                                                                                     ├── embed every file → pgvector index (per-migration namespace)
 │                                                                                                     ├── watsonx.generate(granite-3-8b-instruct, scan-prompt + retrieved chunks)
 │                                                                                                     │   for each breaking change:
 │                                                                                                     │     find affected files
 │                                                                                                     │   write affected files to `files` table
 │                                                                                                     │                                                       ├── upsert File nodes + IMPORTS edges
 │                                                                                                     │                                                       ├── upsert AFFECTS edges (BreakingChange → File)
 │                                                                                                     ├── for each affected file (concurrency 4):
 │                                                                                                     │     watsonx.generate(granite-3-8b, patch-prompt + file + neighbors)
 │                                                                                                     │     if input > 16k tokens: fallback to anthropic.messages.create(claude-sonnet-4-6)
 │                                                                                                     │     INSERT patches row
 │                                                                                                     │     enqueue examiner job for that file
 │                                                                                                                          ├── watsonx.generate(granite-3-8b, test-prompt + file + retrieved callers)
 │                                                                                                                          │   emit *.spec.ts
 │                                                                                                                          ├── INSERT tests row, mark file ready_for_audit
 │                                                                                                                          ├── enqueue auditor job
 │                                                                                                                                                ├── sandbox: write pre/ tree, apply patch to post/ tree
 │                                                                                                                                                ├── run Vitest in pre/
 │                                                                                                                                                ├── run Vitest in post/
 │                                                                                                                                                ├── classify deviations
 │                                                                                                                                                ├── INSERT test_runs + audit_events
 │                                                                                                                                                ├── watsonx.generate(granite-3-8b, summary-prompt) → audit summary
 │                                                                                                                                                ├── when all files done: emit audit.json + audit.pdf
 │  ←─── SSE: migration.completed
 │
 ├── GET /api/migrations/[id]/audit ───→ aggregate agent_runs → audit.json (includes every Granite call's prompt, response, latency)
```

### 5.4 Sequence: single file migration lifecycle

```
file row (status=detected)
   │
   ├─ Surgeon worker picks up
   │     └─ agent_run: surgeon-{migrationId}-{fileId}
   │         retrieve: pgvector top-k chunks (file + importers + usage sites)
   │         watsonx.generate(granite-3-8b-instruct, patch-prompt)
   │         if input > 16k tokens: anthropic.messages.create(claude-sonnet-4-6)
   │         → generate unified diff
   │     └─ INSERT patches { file_id, diff, rationale, agent_run_id }
   │
   ├─ status=patched
   │
   ├─ Examiner worker picks up
   │     └─ agent_run: examiner-{migrationId}-{fileId}
   │         retrieve: pgvector top-k chunks (file + callers + existing tests)
   │         watsonx.generate(granite-3-8b-instruct, test-prompt)
   │         → generate Vitest spec
   │     └─ INSERT tests { file_id, source, agent_run_id }
   │     └─ Run spec against ORIGINAL source in sandbox (baseline must pass)
   │           if baseline fails: regenerate up to 2× with stricter prompt, then fallback to granite-3-2b smoke-test prompt
   │
   ├─ status=tested
   │
   ├─ Auditor worker picks up
   │     └─ sandbox: pre/ tree + post/ tree (patch applied to post/)
   │     └─ run Vitest against post/
   │         → all green: file.status=green
   │         → some red: file.status=red, capture stderr
   │     └─ INSERT test_runs + audit_events
   │
   └─ status=green|red|skipped
```

### 5.5 Bob IDE session timeline during 48-hour development

This subsection enumerates the planned **Bob IDE task sessions** the solo builder runs in Bob during the 48-hour hackathon. Each session is exported to `bob_sessions/` as the construction-evidence artifact for judging. **None of these are runtime calls of the deployed product** — they are the dev-time work that builds Renatus.

| # | Bob mode | Session export path | What the builder asks Bob to do | Output / commit |
|---|---|---|---|---|
| 1 | Plan | `bob_sessions/plan/01-cartographer-agent-design/` | "Design the Cartographer agent. Inputs, outputs, retry policy, fallbacks." | Updated SYSTEM-DESIGN.md §8.2, Zod schema in `agents/cartographer/schema.ts`. |
| 2 | Code | `bob_sessions/code/02-cartographer-impl/` | "Implement `agents/cartographer/index.ts` per the plan, using `lib/watsonx.ts`." | Working Cartographer agent. |
| 3 | Plan | `bob_sessions/plan/03-surgeon-agent-design/` | "Design two-phase Surgeon (scan + patch). Wire pgvector retrieval." | Surgeon's contract pinned. |
| 4 | Code | `bob_sessions/code/04-surgeon-scan-impl/` | "Implement `agents/surgeon/scan.ts` with the retrieval layer." | Working scan phase. |
| 5 | Code | `bob_sessions/code/05-surgeon-patch-impl/` | "Implement `agents/surgeon/patch.ts`, including Claude long-context fallback path." | Working patch phase. |
| 6 | Plan | `bob_sessions/plan/06-examiner-baseline-policy/` | "Design Examiner's baseline-must-pass policy and retry ladder." | Examiner contract pinned. |
| 7 | Code | `bob_sessions/code/07-examiner-impl/` | "Implement `agents/examiner/index.ts` with Vitest sandbox baseline." | Working Examiner. |
| 8 | Plan | `bob_sessions/plan/08-auditor-signing-flow/` | "Design the Auditor's sandbox + ed25519 signing flow." | Auditor contract pinned. |
| 9 | Code | `bob_sessions/code/09-auditor-impl/` | "Implement `agents/auditor/index.ts` and the sandbox driver." | Working Auditor. |
| 10 | Code | `bob_sessions/code/10-watsonx-adapter/` | "Implement `lib/watsonx.ts` adapter — IAM token flow, retries, schema-constrained `generate()`." | The runtime LLM adapter. |
| 11 | Code | `bob_sessions/code/11-anthropic-fallback/` | "Implement `lib/anthropic.ts` as the Surgeon long-context fallback." | Working fallback. |
| 12 | Code | `bob_sessions/code/12-pgvector-retrieval/` | "Implement `lib/retrieval.ts`: embed files, write to pgvector, top-k query." | Retrieval layer. |
| 13 | Code | `bob_sessions/code/13-drizzle-schema/` | "Materialize `db/schema.ts` from §7.1." | Migrations run. |
| 14 | Code | `bob_sessions/code/14-bullmq-flow/` | "Implement `lib/queues.ts` BullMQ flow producer + worker bindings." | Queue alive. |
| 15 | Code | `bob_sessions/code/15-sse-stream/` | "Implement `/api/migrations/[id]/stream` SSE handler." | Live view streams. |
| 16 | Code | `bob_sessions/code/16-r3f-graph/` | "Implement `components/graph-3d.tsx` with react-force-graph-3d." | Graph renders. |
| 17 | Code | `bob_sessions/code/17-diff-viewer/` | "Implement `components/diff-viewer.tsx` using react-diff-view." | Diff renders. |
| 18 | Code | `bob_sessions/code/18-audit-pdf/` | "Implement `@react-pdf/renderer` audit PDF builder." | PDF builds. |
| 19 | Code | `bob_sessions/code/19-audit-signing/` | "Implement `lib/crypto.ts` ed25519 signing over `audit.json`." | Signed audit. |
| 20 | Code | `bob_sessions/code/20-settings-keys/` | "Implement `app/settings/page.tsx` and `actions/api-keys.ts` for libsodium-encrypted secrets." | Settings page works. |
| 21 | Code | `bob_sessions/code/21-sandbox-fly/` | "Set up Fly.io sandbox machine with node-pty + tmpfs." | Sandbox alive. |
| 22 | Code | `bob_sessions/code/22-orchestrator-langgraph/` | "Wire LangGraph state-machine across the four agents." | Orchestrator alive. |
| 23 | Orchestrator | `bob_sessions/orchestrator/23-e2e-react-19-demo/` | "Run end-to-end migration on demo repo #1 and report failures." | Demo path validated. |
| 24 | Orchestrator | `bob_sessions/orchestrator/24-e2e-debug-pass/` | "Debug whatever Block 23 surfaced; fix the worst three failures." | Demo path greener. |
| 25 | Orchestrator | `bob_sessions/orchestrator/25-demo-rehearsal-final/` | "Run all three demo repos in sequence as if recording." | Demo timing pinned. |
| 26 | Plan | `bob_sessions/plan/26-fallback-paths/` | "Audit every fallback path for the demo. Pre-seed any missing." | Pre-seeded `catalogs/react-18-to-19.ts` confirmed. |
| 27 | `/review` | `bob_sessions/review-commit/27-pre-merge-review/` | "/review the working tree before the submission tag." | Cleanup commits. |
| 28 | Code | `bob_sessions/code/28-readme-polish/` | "Tighten README, Bob usage section, run-it-yourself." | README ready. |
| 29 | `/commit` | `bob_sessions/review-commit/29-submission-commit/` | "/commit the submission tag with conventional message." | `v1.0.0-submission` tagged. |
| 30 | Plan | `bob_sessions/plan/30-post-mortem-notes/` | "Write a short post-mortem of what Bob did best for this build." | Notes file for retrospective. |

For a clean run: roughly **30+ Bob IDE task sessions** across Plan / Code / Orchestrator / review-commit modes. The expected token spend across the 30 sessions is on Bob (IDE-side, not Renatus runtime); the runtime token spend is on watsonx Granite and is budgeted separately in §15.

---

## 6. Tech stack

| Concern | Choice | Why |
|---|---|---|
| Framework | Next.js 16 App Router | RSC, Server Actions, Route Handlers, SSE streams |
| Language | TypeScript strict | Type safety on agent boundaries is non-negotiable |
| Styling | Tailwind CSS v4 | Stable, fast, plays nice with shadcn/ui |
| Components | shadcn/ui | Pre-themed, dark-mode native |
| Motion | Framer Motion | Card animations, agent column transitions |
| 3D | React Three Fiber + drei | Codebase knowledge graph |
| Graph viz | react-force-graph-3d | Force-directed layout |
| Diff viewer | react-diff-view | Side-by-side unified diff |
| ORM | Drizzle ORM | Type-safe SQL, plays with Neon HTTP driver |
| Postgres | Neon (free tier) with `pgvector` | Serverless HTTP, fits Vercel; pgvector powers retrieval over indexed repo files |
| Graph DB | Neo4j AuraDB (free tier) | 1 instance, 200k nodes, enough for demo |
| Queue | BullMQ on Upstash Redis (free tier) | 10k commands/day plenty |
| **Runtime LLM (primary)** | **watsonx.ai Granite-3** (`granite-3.0-8b-instruct` for Cartographer/Examiner/Auditor and Surgeon up to 16k tokens; `granite-3.0-2b-instruct` for fast classification and Examiner smoke-test fallback) via `@ibm-cloud/watsonx-ai` | The runtime LLM Renatus calls on every migration. Aligns with the watsonx sponsor stack. Hackathon's $80 IBM Cloud credit covers all 48h of runtime token use. |
| **Runtime LLM (fallback)** | **Anthropic Claude Sonnet 4.6** via `@anthropic-ai/sdk` | Surgeon's hardest cross-file patches exceed Granite's effective window. Claude takes over only on that path. |
| Agent orchestration | LangGraph + watsonx Granite | State-machine across the four agents at runtime. Routing decisions made by Granite-2b. |
| Retrieval | pgvector over Neon Postgres | File embeddings for each indexed repo. Top-k retrieval feeds the context window for each Granite call. |
| **Dev partner (not runtime)** | **IBM Bob IDE** | The desktop AI IDE the solo builder uses for 48 hours to design, code, review, and demo Renatus. Bob does not ship with the product. Every Bob task session is exported to `bob_sessions/` as construction evidence. |
| GitHub | `@octokit/rest` + `simple-git` | Clone target repo, list trees for embedding |
| Sandbox | node-pty + tmpfs + network-namespace | Run untrusted code |
| PDF | `@react-pdf/renderer` | Audit PDF |
| Auth | none (single-user demo) | Speed |
| Hosting | Vercel | Next.js native |
| Long-running | Fly.io 1× shared-cpu-1x machine | BullMQ workers + sandbox host |
| Telemetry | Sentry free + console | Capture failures during demo |
| Package manager | bun | Faster local dev |

Required runtime env vars (from the watsonx.ai PDF guide, pages 40–43):

```
WATSONX_AI_API_KEY=...              # IBM Cloud API key with watsonx.ai service access
WATSONX_PROJECT_ID=...              # watsonx project ID under your IBM Cloud account
WATSONX_ENDPOINT=https://us-south.ml.cloud.ibm.com   # regional endpoint
ANTHROPIC_API_KEY=sk-ant-...        # Surgeon long-context fallback
```

The watsonx adapter (`lib/watsonx.ts`) handles the IAM access-token flow: exchange the API key for a short-lived bearer token at `https://iam.cloud.ibm.com/identity/token`, cache for 50 minutes, refresh on 401.

Notably absent: tRPC (Server Actions cover it), Zustand (URL state + RSC), tanstack-query (RSC + SSE), Prisma (Drizzle).

---

## 7. Data model

### 7.1 Postgres tables (Drizzle schemas)

```ts
// db/schema.ts
import {
  pgTable, serial, text, uuid, timestamp, jsonb, integer,
  boolean, pgEnum, varchar, index, uniqueIndex, foreignKey,
} from "drizzle-orm/pg-core";

export const migrationStatusEnum = pgEnum("migration_status", [
  "queued",
  "cartography",
  "scanning",
  "patching",
  "testing",
  "auditing",
  "completed",
  "failed",
  "cancelled",
]);

export const agentKindEnum = pgEnum("agent_kind", [
  "cartographer",
  "surgeon",
  "examiner",
  "auditor",
  "orchestrator",
]);

export const fileStatusEnum = pgEnum("file_status", [
  "detected",       // Surgeon found this file is affected
  "patching",       // Surgeon is patching
  "patched",        // patch produced
  "testing",        // Examiner is generating tests
  "tested",         // tests generated, baseline green
  "auditing",       // Auditor running tests against post/
  "green",          // tests pass on migrated code
  "red",            // tests fail on migrated code
  "skipped",        // user-skipped or rejected
  "error",          // unrecoverable
]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const apiKeys = pgTable("api_keys", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  provider: varchar("provider", { length: 32 }).notNull(), // watsonx | anthropic | github
  // Encrypted at rest via libsodium secretbox; nonce stored separately
  cipherText: text("cipher_text").notNull(),
  nonce: text("nonce").notNull(),
  label: text("label"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
}, (t) => ({
  byUserProvider: index("api_keys_user_provider_idx").on(t.userId, t.provider),
}));

export const repos = pgTable("repos", {
  id: uuid("id").primaryKey().defaultRandom(),
  url: text("url").notNull(),
  owner: text("owner").notNull(),
  name: text("name").notNull(),
  defaultBranch: text("default_branch").notNull().default("main"),
  // detected stack and version, populated by Cartographer/Surgeon
  detectedStack: jsonb("detected_stack").$type<{
    languages: string[];
    frameworks: { name: string; version: string }[];
    packageManager?: string;
  }>(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  byUrl: uniqueIndex("repos_url_idx").on(t.url),
  byOwnerName: index("repos_owner_name_idx").on(t.owner, t.name),
}));

export const migrationTargets = pgTable("migration_targets", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: varchar("slug", { length: 64 }).notNull().unique(),
  // e.g. "react@18->react@19"
  fromName: text("from_name").notNull(),
  fromVersion: text("from_version").notNull(),
  toName: text("to_name").notNull(),
  toVersion: text("to_version").notNull(),
  upstreamRepoUrl: text("upstream_repo_url").notNull(),
  changelogPaths: jsonb("changelog_paths").$type<string[]>().notNull(),
  rfcPaths: jsonb("rfc_paths").$type<string[]>(),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

export const breakingChanges = pgTable("breaking_changes", {
  id: uuid("id").primaryKey().defaultRandom(),
  targetId: uuid("target_id").notNull().references(() => migrationTargets.id, { onDelete: "cascade" }),
  externalRef: text("external_ref"), // e.g. "react/RFC-0234"
  apiSurface: text("api_surface").notNull(), // e.g. "useEffect", "ReactDOM.render"
  kind: varchar("kind", { length: 32 }).notNull(), // removed | renamed | signature | semantics | type
  severity: varchar("severity", { length: 16 }).notNull(), // breaking | warning | info
  summary: text("summary").notNull(),
  body: text("body").notNull(),
  detectPattern: jsonb("detect_pattern").$type<{
    importMatch?: string;
    jsxMatch?: string;
    callMatch?: string;
    typeMatch?: string;
    astQuery?: string;
  }>(),
  fixHint: text("fix_hint"),
  examplesBefore: text("examples_before"),
  examplesAfter: text("examples_after"),
  inferenceCallId: uuid("inference_call_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  byTarget: index("breaking_changes_target_idx").on(t.targetId),
  byApi: index("breaking_changes_api_idx").on(t.apiSurface),
}));

export const migrations = pgTable("migrations", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  repoId: uuid("repo_id").notNull().references(() => repos.id),
  targetId: uuid("target_id").notNull().references(() => migrationTargets.id),
  commitSha: text("commit_sha"), // commit pinned at start of run
  status: migrationStatusEnum("status").notNull().default("queued"),
  progressPct: integer("progress_pct").notNull().default(0),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  totalFiles: integer("total_files").notNull().default(0),
  greenFiles: integer("green_files").notNull().default(0),
  redFiles: integer("red_files").notNull().default(0),
  skippedFiles: integer("skipped_files").notNull().default(0),
  // denormalized for the past-migrations list
  repoFullName: text("repo_full_name").notNull(),
  targetSlug: text("target_slug").notNull(),
  // Auditor outputs
  auditJsonUrl: text("audit_json_url"),
  auditPdfUrl: text("audit_pdf_url"),
  signedHash: text("signed_hash"),
  signature: text("signature"),
}, (t) => ({
  byUserStarted: index("migrations_user_started_idx").on(t.userId, t.startedAt.desc()),
  byStatus: index("migrations_status_idx").on(t.status),
}));

export const agents = pgTable("agents", {
  id: uuid("id").primaryKey().defaultRandom(),
  migrationId: uuid("migration_id").notNull().references(() => migrations.id, { onDelete: "cascade" }),
  kind: agentKindEnum("kind").notNull(),
  status: varchar("status", { length: 24 }).notNull().default("idle"), // idle|running|done|failed
  startedAt: timestamp("started_at", { withTimezone: true }),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  // running counters surfaced in the live view
  itemsProcessed: integer("items_processed").notNull().default(0),
  itemsTotal: integer("items_total").notNull().default(0),
  lastError: text("last_error"),
}, (t) => ({
  byMigrationKind: uniqueIndex("agents_migration_kind_idx").on(t.migrationId, t.kind),
}));

export const agentRuns = pgTable("agent_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  agentId: uuid("agent_id").notNull().references(() => agents.id, { onDelete: "cascade" }),
  inferenceCallId: uuid("inference_call_id"),
  fileId: uuid("file_id"),
  inputDigest: varchar("input_digest", { length: 64 }), // sha256
  outputDigest: varchar("output_digest", { length: 64 }),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  latencyMs: integer("latency_ms"),
  status: varchar("status", { length: 16 }).notNull(), // ok|retry|fail
  errorMessage: text("error_message"),
  rawOutput: jsonb("raw_output"),
}, (t) => ({
  byAgent: index("agent_runs_agent_idx").on(t.agentId, t.startedAt.desc()),
  byInferenceCall: index("agent_runs_inference_call_idx").on(t.inferenceCallId),
}));

export const files = pgTable("files", {
  id: uuid("id").primaryKey().defaultRandom(),
  migrationId: uuid("migration_id").notNull().references(() => migrations.id, { onDelete: "cascade" }),
  path: text("path").notNull(),
  language: varchar("language", { length: 24 }).notNull(),
  loc: integer("loc"),
  status: fileStatusEnum("status").notNull().default("detected"),
  // which breaking changes touched this file
  breakingChangeIds: jsonb("breaking_change_ids").$type<string[]>().notNull().default([]),
  originalSha: varchar("original_sha", { length: 64 }),
  patchedSha: varchar("patched_sha", { length: 64 }),
  detectedAt: timestamp("detected_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  byMigrationPath: uniqueIndex("files_migration_path_idx").on(t.migrationId, t.path),
  byStatus: index("files_status_idx").on(t.migrationId, t.status),
}));

export const patches = pgTable("patches", {
  id: uuid("id").primaryKey().defaultRandom(),
  fileId: uuid("file_id").notNull().references(() => files.id, { onDelete: "cascade" }),
  diff: text("diff").notNull(),                 // unified diff
  rationale: text("rationale").notNull(),       // Bob's explanation
  breakingChangeIds: jsonb("breaking_change_ids").$type<string[]>().notNull().default([]),
  inferenceCallId: uuid("inference_call_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  appliedAt: timestamp("applied_at", { withTimezone: true }),
}, (t) => ({
  byFile: index("patches_file_idx").on(t.fileId),
}));

export const tests = pgTable("tests", {
  id: uuid("id").primaryKey().defaultRandom(),
  fileId: uuid("file_id").notNull().references(() => files.id, { onDelete: "cascade" }),
  framework: varchar("framework", { length: 24 }).notNull().default("vitest"),
  source: text("source").notNull(),
  inferenceCallId: uuid("inference_call_id"),
  generatorModel: varchar("generator_model", { length: 48 }).notNull(), // granite-3-8b-instruct | granite-3-2b-instruct | claude-sonnet-4.6
  baselineOk: boolean("baseline_ok"), // ran green on original code
  baselineLog: text("baseline_log"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  byFile: index("tests_file_idx").on(t.fileId),
}));

export const testRuns = pgTable("test_runs", {
  id: uuid("id").primaryKey().defaultRandom(),
  testId: uuid("test_id").notNull().references(() => tests.id, { onDelete: "cascade" }),
  fileId: uuid("file_id").notNull().references(() => files.id, { onDelete: "cascade" }),
  phase: varchar("phase", { length: 16 }).notNull(), // baseline | post-migration
  passed: boolean("passed").notNull(),
  stdout: text("stdout"),
  stderr: text("stderr"),
  durationMs: integer("duration_ms"),
  ranAt: timestamp("ran_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  byFilePhase: index("test_runs_file_phase_idx").on(t.fileId, t.phase),
}));

export const auditEvents = pgTable("audit_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  migrationId: uuid("migration_id").notNull().references(() => migrations.id, { onDelete: "cascade" }),
  fileId: uuid("file_id"),
  kind: varchar("kind", { length: 32 }).notNull(),
  // file.patched | file.tested | file.green | file.red | agent.started | agent.done | bob.session.opened ...
  payload: jsonb("payload").notNull().default({}),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  byMigrationTime: index("audit_events_migration_time_idx").on(t.migrationId, t.occurredAt),
  byKind: index("audit_events_kind_idx").on(t.kind),
}));

// Each runtime LLM call (watsonx Granite or Claude fallback) is logged here for
// the audit trail. Replaces what was previously called `bob_sessions` in earlier
// drafts — Bob is no longer a runtime LLM. The folder `bob_sessions/` in the repo
// root is unrelated; it holds Bob IDE task exports for hackathon judging.
export const inferenceCalls = pgTable("inference_calls", {
  id: uuid("id").primaryKey().defaultRandom(),
  migrationId: uuid("migration_id").references(() => migrations.id, { onDelete: "cascade" }),
  agentRunId: uuid("agent_run_id").references(() => agentRuns.id, { onDelete: "cascade" }),
  provider: varchar("provider", { length: 24 }).notNull(),  // watsonx | anthropic
  modelId: varchar("model_id", { length: 64 }).notNull(),   // ibm/granite-3-8b-instruct | claude-sonnet-4-6 | ...
  agentKind: agentKindEnum("agent_kind").notNull(),
  purpose: text("purpose").notNull(),
  promptDigest: varchar("prompt_digest", { length: 64 }),   // sha256 of full prompt
  responseDigest: varchar("response_digest", { length: 64 }),
  retrievedChunkIds: jsonb("retrieved_chunk_ids").$type<string[]>().default([]),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  latencyMs: integer("latency_ms"),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  // The full prompt + response, used for the per-file reasoning trail and audit PDF
  fullPayload: jsonb("full_payload"),
}, (t) => ({
  byMigration: index("inference_calls_migration_idx").on(t.migrationId),
  byAgentRun: index("inference_calls_agent_run_idx").on(t.agentRunId),
}));

export const graphSnapshots = pgTable("graph_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  migrationId: uuid("migration_id").notNull().references(() => migrations.id, { onDelete: "cascade" }),
  // JSON of {nodes, links} for the 3D graph at this point in time
  payload: jsonb("payload").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
}, (t) => ({
  byMigration: index("graph_snapshots_migration_idx").on(t.migrationId, t.createdAt),
}));
```

Notes:

- `files.breakingChangeIds` is a denormalized array for fast list-in-UI display. Source of truth lives in Neo4j (`AFFECTS` edges).
- `auditEvents` is append-only. Used both for the live view (via SSE) and for the final audit report.
- `inferenceCalls.fullPayload` stores the full prompt + response + retrieved chunks for every watsonx Granite (and Claude fallback) call. This is what powers the audit report's per-file reasoning trail.
- `inferenceCallId` columns on `breakingChanges`, `agentRuns`, `patches`, `tests` are nullable FKs into `inference_calls.id`. Nullable so a Granite-unreachable fallback path that goes through Claude still inserts cleanly without a synthesized call record (rare).
- Folder note: `bob_sessions/` at the repo root is the **mandatory hackathon submission folder** of exported Bob IDE task sessions. It is unrelated to the Postgres schema — those exports are static files committed to git.

### 7.2 Neo4j graph schema

```cypher
// Nodes
(:File   { path: STRING, language: STRING, loc: INT, migrationId: UUID })
(:Symbol { name: STRING, kind: STRING /* function|class|hook|component|type|export */ })
(:Module { name: STRING /* npm package or python module */, version: STRING })
(:Test   { id: UUID, framework: STRING })
(:BreakingChange { id: UUID, apiSurface: STRING, severity: STRING, kind: STRING })

// Relationships
(:File)-[:IMPORTS { specifier: STRING, isTypeOnly: BOOLEAN }]->(:Module)
(:File)-[:DEFINES]->(:Symbol)
(:File)-[:USES   { line: INT }]->(:Symbol)
(:File)-[:TESTS  { coverage: FLOAT }]->(:File)
(:BreakingChange)-[:AFFECTS { confidence: FLOAT, pattern: STRING }]->(:File)
(:BreakingChange)-[:AFFECTS { confidence: FLOAT }]->(:Symbol)
(:Module)-[:EXPORTS]->(:Symbol)
(:Test)-[:COVERS]->(:File)

// Indexes
CREATE INDEX file_path_migration IF NOT EXISTS FOR (f:File) ON (f.path, f.migrationId);
CREATE INDEX symbol_name IF NOT EXISTS FOR (s:Symbol) ON (s.name);
CREATE INDEX module_name_version IF NOT EXISTS FOR (m:Module) ON (m.name, m.version);
CREATE INDEX bc_api IF NOT EXISTS FOR (b:BreakingChange) ON (b.apiSurface);
```

Core queries:

```cypher
// What files does this breaking change touch?
MATCH (b:BreakingChange { id: $bcId })-[:AFFECTS]->(f:File { migrationId: $migrationId })
RETURN f.path AS path
ORDER BY f.path;

// What's the blast radius if we change Symbol X?
MATCH (s:Symbol { name: $name })<-[:USES]-(f:File { migrationId: $migrationId })
RETURN f.path AS path, count(*) AS uses
ORDER BY uses DESC;

// Graph payload for R3F visualization (capped at N nodes)
MATCH (f:File { migrationId: $migrationId })
OPTIONAL MATCH (f)-[i:IMPORTS]->(m:Module)
OPTIONAL MATCH (b:BreakingChange)-[:AFFECTS]->(f)
WITH f, collect(DISTINCT m) AS imports, collect(DISTINCT b) AS bcs
RETURN f.path AS path, f.loc AS loc, size(imports) AS fanOut, bcs;
```

### 7.3 Migration target catalog

#### React 18 → 19 (primary demo target)

```ts
// catalogs/react-18-to-19.ts
import type { MigrationCatalog } from "@/lib/types";

export const reactCatalog: MigrationCatalog = {
  slug: "react@18->react@19",
  from: { name: "react", version: "18.x" },
  to:   { name: "react", version: "19.x" },
  upstreamRepoUrl: "https://github.com/facebook/react",
  changelogPaths: ["CHANGELOG.md", "packages/react/CHANGELOG.md"],
  rfcPaths: ["https://github.com/reactjs/rfcs"],
  changes: [
    {
      apiSurface: "ReactDOM.render",
      kind: "removed",
      severity: "breaking",
      summary: "ReactDOM.render removed in favor of createRoot.",
      detect: {
        importMatch: "^react-dom$",
        callMatch:   "ReactDOM\\.render\\(",
      },
      fixHint:
        "Replace `ReactDOM.render(<App />, root)` with " +
        "`createRoot(root).render(<App />)` and import from `react-dom/client`.",
    },
    {
      apiSurface: "ReactDOM.hydrate",
      kind: "removed",
      severity: "breaking",
      summary: "ReactDOM.hydrate removed in favor of hydrateRoot.",
      detect: { callMatch: "ReactDOM\\.hydrate\\(" },
      fixHint: "Use `hydrateRoot(root, <App />)` from `react-dom/client`.",
    },
    {
      apiSurface: "ReactDOM.unmountComponentAtNode",
      kind: "removed",
      severity: "breaking",
      summary: "Replaced by root.unmount() returned from createRoot.",
      detect: { callMatch: "unmountComponentAtNode\\(" },
      fixHint: "Hold the root returned from createRoot and call `root.unmount()`.",
    },
    {
      apiSurface: "act",
      kind: "removed",
      severity: "breaking",
      summary: "`act` removed from `react-dom/test-utils`. Import from `react`.",
      detect: { importMatch: "react-dom/test-utils", callMatch: "\\bact\\(" },
      fixHint: "Import `{ act }` from `react` directly.",
    },
    {
      apiSurface: "useRef without initial value",
      kind: "signature",
      severity: "breaking",
      summary:
        "useRef now requires an explicit argument. `useRef<T>()` is an error; use `useRef<T>(null)`.",
      detect: { callMatch: "useRef<[^>]+>\\(\\)" },
      fixHint: "Pass `null` explicitly: `useRef<HTMLDivElement>(null)`.",
    },
    {
      apiSurface: "useEffect cleanup timing",
      kind: "semantics",
      severity: "warning",
      summary:
        "Effect cleanup ordering changed for components with concurrent rendering. " +
        "Cleanup runs before the next effect, may now run more eagerly.",
      detect: { callMatch: "useEffect\\(" },
      fixHint:
        "Audit any cleanup that depended on a specific timing relative to commit phase.",
    },
    {
      apiSurface: "forwardRef",
      kind: "semantics",
      severity: "warning",
      summary:
        "ref is now a regular prop on function components. forwardRef is no longer required " +
        "for new code but remains supported.",
      detect: { callMatch: "forwardRef\\(" },
      fixHint:
        "Optional: refactor `forwardRef((props, ref) => ...)` to a plain component with " +
        "`ref` in the props destructure.",
    },
    {
      apiSurface: "defaultProps on function components",
      kind: "removed",
      severity: "breaking",
      summary:
        "defaultProps removed for function components. Use default parameter destructuring.",
      detect: { astQuery: "MemberExpression[property.name='defaultProps']" },
      fixHint: "Replace `Foo.defaultProps = { x: 1 }` with `function Foo({ x = 1 })`.",
    },
    {
      apiSurface: "propTypes warnings",
      kind: "removed",
      severity: "warning",
      summary:
        "propTypes are no longer checked at runtime in React 19 production. Use TypeScript.",
      detect: { importMatch: "^prop-types$" },
      fixHint: "Replace runtime propTypes with TypeScript types.",
    },
    {
      apiSurface: "Context.Provider",
      kind: "renamed",
      severity: "warning",
      summary:
        "You can render `<Context>` directly without `.Provider`. Old form still works.",
      detect: { jsxMatch: "<\\w+\\.Provider" },
      fixHint:
        "Optional cleanup: `<MyCtx.Provider value=...>` → `<MyCtx value=...>`.",
    },
    {
      apiSurface: "useFormState → useActionState",
      kind: "renamed",
      severity: "warning",
      summary: "useFormState renamed to useActionState.",
      detect: { callMatch: "useFormState\\(" },
      fixHint: "Rename import: `useFormState` → `useActionState`.",
    },
    {
      apiSurface: "renderToString suspense behavior",
      kind: "semantics",
      severity: "warning",
      summary:
        "renderToString streaming and Suspense fallback handling changed. " +
        "Prefer renderToPipeableStream for SSR.",
      detect: { callMatch: "renderToString\\(" },
      fixHint: "For SSR with Suspense, switch to renderToPipeableStream.",
    },
    {
      apiSurface: "Element ref type",
      kind: "type",
      severity: "warning",
      summary:
        "TypeScript: ref types tightened. `Ref<HTMLDivElement>` may need adjustment in custom components.",
      detect: { astQuery: "TSTypeReference[typeName.name='Ref']" },
      fixHint:
        "Audit ref types in custom forwardRef components and library wrappers.",
    },
  ],
};
```

#### Python 3.10 → 3.12 (backup)

| API surface | Kind | Fix |
|---|---|---|
| `asyncio.coroutine` decorator | removed | use `async def` directly |
| `distutils` module | removed | use `setuptools` / `pyproject.toml` |
| `imp` module | removed | use `importlib` |
| `pkg_resources` deprecation | warning | use `importlib.resources` / `importlib.metadata` |
| `tkinter.tix` | removed | replace with `ttk` widgets |
| F-string `=` debug spec edge cases | semantics | audit `f"{x=}"` usages |
| `int.__div__` etc. | n/a | unchanged but tighter type checks |
| `typing.TypeAlias` → PEP 695 syntax | warning | optional rewrite to `type X = ...` |

#### Tailwind 3 → 4 (backup)

| API surface | Kind | Fix |
|---|---|---|
| `tailwind.config.js` → CSS-first config | breaking | `@theme` block in CSS replaces JS config |
| `tailwindcss/postcss` plugin path | renamed | new import path `@tailwindcss/postcss` |
| `bg-opacity-*` utilities | removed | use `bg-black/50` slash syntax |
| `flex-grow-*` shorthand | renamed | `grow-*` |
| `decoration-slice` | renamed | `box-decoration-slice` |
| `theme()` CSS function arg syntax | breaking | parentheses changes |
| `@apply` inside `@layer base` | semantics | scoping changes |

#### Drizzle ORM 0.x → 1.0 (backup)

| API surface | Kind | Fix |
|---|---|---|
| `drizzle-kit push:pg` | renamed | `drizzle-kit push` |
| `db.execute(sql...)` return shape | breaking | unwrap `.rows` |
| `where` chaining order on `update` | breaking | required before `.set` in 1.0 |
| `relations()` helper signature | breaking | new generic signature |

#### Java 17 → 21 (stretch, mentioned in catalog but not demoed)

Sealed classes, pattern matching for switch, virtual threads, deprecated `finalize()`, etc.

### 7.4 Indexes

Recap of indexes (Postgres):

| Table | Index | Columns | Purpose |
|---|---|---|---|
| `repos` | unique | `url` | dedupe repos on submit |
| `repos` | btree | `(owner, name)` | search |
| `migrations` | btree | `(user_id, started_at DESC)` | past migrations list |
| `migrations` | btree | `status` | worker queries |
| `files` | unique | `(migration_id, path)` | one row per file per migration |
| `files` | btree | `(migration_id, status)` | "all green files" panel |
| `agents` | unique | `(migration_id, kind)` | one agent row per kind |
| `agent_runs` | btree | `(agent_id, started_at DESC)` | timeline |
| `audit_events` | btree | `(migration_id, occurred_at)` | event stream replay |
| `inference_calls` | btree | `migration_id` | audit aggregation |
| `inference_calls` | btree | `agent_run_id` | per-agent reasoning trail |
| `breaking_changes` | btree | `target_id` | catalog scan |
| `breaking_changes` | btree | `api_surface` | dedupe |

---

## 8. Agent design

All agents share a common envelope:

```ts
// agents/_envelope.ts
import { z } from "zod";

export const AgentEnvelope = z.object({
  migrationId: z.string().uuid(),
  agentKind: z.enum(["cartographer", "surgeon", "examiner", "auditor", "orchestrator"]),
  inferenceCallId: z.string().uuid().optional(),  // FK into inference_calls
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
  status: z.enum(["ok", "retry", "fail"]),
  payload: z.unknown(),
});
export type AgentEnvelope<T> = z.infer<typeof AgentEnvelope> & { payload: T };
```

### 8.1 Orchestrator

- **Role**: state machine that walks migrations through `queued → cartography → scanning → patching → testing → auditing → completed`. Implemented as a LangGraph state-machine. Uses `granite-3.0-2b-instruct` for fast routing decisions (e.g. "did Cartographer produce ≥1 breaking change? route to Surgeon; else route to failure"). Owns BullMQ flow definitions.
- **Runtime LLM calls**: small routing decisions only, via `granite-3.0-2b-instruct`. No long-context reasoning.
- **Inputs**: `{ migrationId, userId, repoUrl, targetSlug }`
- **Outputs**: queue jobs and state transitions.

```ts
// orchestrator/flow.ts
import { FlowProducer } from "bullmq";

export async function startMigration(input: {
  migrationId: string;
  userId: string;
  repoUrl: string;
  targetSlug: string;
}) {
  const flow = new FlowProducer({ connection: redis });
  await flow.add({
    name: "migration",
    queueName: "orchestrator",
    data: input,
    children: [
      { name: "cartography", queueName: "cartographer", data: input },
      { name: "scanning",    queueName: "surgeon-scan", data: input },
    ],
  });
}
```

Constraints: hard 25-minute wall-clock budget per migration (demo padding). Failure modes: queue stall → orchestrator polls every 30s and re-queues stuck agent runs (max 2 retries).

### 8.2 Cartographer

- **Role**: read the upstream framework's release notes / changelog / RFC docs (fetched via `@octokit/rest`, retrieved via pgvector) and produce a structured `breaking_changes.json` for the target.
- **Runtime LLM calls**: one `granite-3.0-8b-instruct` call per migration target (cached across migrations).
- **Inputs**: `{ migrationId, targetSlug }`
- **Outputs**: `BreakingChange[]` (Zod below) persisted to `breaking_changes` table.

```ts
// agents/cartographer/schema.ts
import { z } from "zod";

export const BreakingChange = z.object({
  apiSurface: z.string(),
  kind: z.enum(["removed", "renamed", "signature", "semantics", "type"]),
  severity: z.enum(["breaking", "warning", "info"]),
  summary: z.string().max(280),
  body: z.string(),
  detectPattern: z.object({
    importMatch: z.string().optional(),
    jsxMatch:    z.string().optional(),
    callMatch:   z.string().optional(),
    typeMatch:   z.string().optional(),
    astQuery:    z.string().optional(),
  }),
  fixHint: z.string(),
  examplesBefore: z.string().optional(),
  examplesAfter:  z.string().optional(),
  externalRef:    z.string().optional(),
});
export const CartographerOutput = z.object({
  targetSlug: z.string(),
  changes: z.array(BreakingChange).min(1),
});
```

System prompt (template):

```
You are Cartographer, agent 1 of 4 in the Renatus migration crew.
Your job: read the upstream changelog and RFCs for a framework version bump
and emit a STRUCTURED map of every API breaking change.

Target: {{targetSlug}}
From:   {{fromName}}@{{fromVersion}}
To:     {{toName}}@{{toVersion}}
Upstream repo: {{upstreamRepoUrl}}
Changelog paths to read first: {{changelogPaths}}

For each breaking change, output an object with:
- apiSurface: the public symbol or pattern affected
- kind: one of removed | renamed | signature | semantics | type
- severity: breaking | warning | info
- summary: 1 sentence, <=280 chars
- body: 1-3 paragraphs
- detectPattern: a tiny regex or AST hint we can use to find affected files
- fixHint: <=400 chars actionable transformation
- examplesBefore / examplesAfter: short code samples if useful
- externalRef: link back to the canonical doc / RFC

Output JSON matching the CartographerOutput schema and nothing else.
Do not invent breaking changes. If in doubt, OMIT.
Prefer DETECTABLE patterns. If you cannot write a detectPattern, skip the change.
```

watsonx Granite call pattern:

```ts
// agents/cartographer/index.ts
import { watsonx } from "@/lib/watsonx";
import { octokit } from "@/lib/github";
import { retrieve } from "@/lib/retrieval";

// 1. Pull upstream changelog/RFC files via Octokit
const files = await octokit.rest.repos.getContent({ ... target.changelogPaths });
// 2. Index into pgvector under namespace `upstream:${targetSlug}`
await retrieve.index({ namespace: `upstream:${target.slug}`, files });
// 3. Retrieve top-k chunks relevant to "breaking changes / removed APIs"
const chunks = await retrieve.query({
  namespace: `upstream:${target.slug}`,
  query: "removed deprecated breaking renamed signature change API",
  topK: 40,
});
// 4. Granite inference call
const response = await watsonx.text.generate({
  modelId: "ibm/granite-3-8b-instruct",
  projectId: process.env.WATSONX_PROJECT_ID,
  input: renderPrompt({ system: cartographerPrompt, chunks, target }),
  parameters: {
    decoding_method: "greedy",
    max_new_tokens: 4096,
    temperature: 0.2,
    stop_sequences: ["</output>"],
  },
});
const parsed = CartographerOutput.parse(JSON.parse(response.results[0].generated_text));
```

Constraints:

- No invented breaking changes. Schema-validate output; on parse failure, retry up to 2× with stricter prompt.
- Cache result per `targetSlug`. Subsequent migrations skip Cartographer.

Failure modes + fallbacks:

| Failure | Fallback |
|---|---|
| watsonx Granite returns malformed JSON | 2 retries with a stricter prompt and `temperature: 0.0`. |
| Granite endpoint unavailable / rate-limited | Pre-seeded catalog file (`catalogs/react-18-to-19.ts` above) is shipped in the repo. Cartographer reads it directly without any LLM call. |
| Both fail | Mark migration `failed` with reason `cartography_unavailable` and surface in UI. |

### 8.3 Surgeon

- **Role**: read the target repo via pgvector retrieval over `@octokit/rest`-fetched files, identify affected files, generate patches.
- Two phases:
  1. **Scan** (one Granite call per migration): walk repo embeddings, classify which files match which breaking changes.
  2. **Patch** (one Granite call per affected file; Claude Sonnet 4.6 fallback for >16k-token contexts): emit unified diff + rationale.
- **Runtime LLM calls**: 1 scan + N patch calls where N = affected file count (cap 30 for demo).

```ts
// agents/surgeon/schema.ts
export const SurgeonScanOutput = z.object({
  affected: z.array(z.object({
    path: z.string(),
    language: z.string(),
    loc: z.number().int().nonnegative(),
    breakingChangeIds: z.array(z.string().uuid()).min(1),
    rationale: z.string(),       // why this file is affected
    confidence: z.number().min(0).max(1),
  })),
  unaffectedCount: z.number().int().nonnegative(),
});

export const SurgeonPatchOutput = z.object({
  path: z.string(),
  diff: z.string(),               // unified diff
  rationale: z.string(),
  breakingChangeIds: z.array(z.string().uuid()).min(1),
  warnings: z.array(z.string()).default([]),
});
```

System prompt for scan:

```
You are Surgeon (scan phase), agent 2 of 4.
You have access to the user's repo at {{repoFullName}} at commit {{commitSha}}.

The Cartographer identified these breaking changes for {{targetSlug}}:
{{#each breakingChanges}}
- [{{id}}] {{apiSurface}} ({{kind}}, {{severity}}): {{summary}}
  detect: {{detectPattern}}
{{/each}}

Read the repo. For EVERY file that matches one or more of the breaking-change
detectPatterns, emit an entry with:
- path
- language
- loc
- breakingChangeIds (UUIDs of the changes that apply)
- rationale (1-2 sentences)
- confidence (0..1; <0.5 means "we should still try but a human must review")

You are given a set of repo file chunks retrieved by pgvector against each breaking-change's detectPattern. Look at imports, JSX, hook usage, call sites, type references. A file is affected if it USES a changed API anywhere, not just if it imports it. The retrieval layer has already surfaced cross-file usage sites for you to reason over.

Output JSON matching SurgeonScanOutput. Nothing else.
```

System prompt for patch:

```
You are Surgeon (patch phase), agent 2 of 4.

Target file: {{path}}
Original source:
```
{{originalSource}}
```

This file is affected by the following breaking changes:
{{#each breakingChanges}}
[{{id}}] {{apiSurface}}: {{summary}}
Fix hint: {{fixHint}}
{{/each}}

Produce a UNIFIED DIFF (path-relative) that migrates this file safely.

Rules:
1. Touch ONLY what the breaking changes require. Do not rewrite for style.
2. Preserve every comment, every type annotation, every import that isn't
   directly affected.
3. If a change requires a new import, add it; if a change removes the last
   use of an import, remove it.
4. If you cannot perform a safe transformation, emit `diff: ""` and put the
   reason in `warnings`.
5. Rationale: 2-4 sentences referencing the specific breaking-change IDs.

Output JSON matching SurgeonPatchOutput. Nothing else.
```

watsonx Granite call pattern (with Claude long-context fallback):

```ts
// agents/surgeon/patch.ts
import { watsonx } from "@/lib/watsonx";
import { anthropic } from "@/lib/anthropic";

const prompt = renderPatchPrompt({ path, originalSource, breakingChanges });
const estimatedTokens = estimateTokens(prompt);

let raw: string;
if (estimatedTokens <= 14_000) {
  // Primary path: Granite-3 8b instruct
  const response = await watsonx.text.generate({
    modelId: "ibm/granite-3-8b-instruct",
    projectId: process.env.WATSONX_PROJECT_ID,
    input: prompt,
    parameters: {
      decoding_method: "greedy",
      max_new_tokens: 4096,
      temperature: 0.1,
      stop_sequences: ["</output>"],
    },
  });
  raw = response.results[0].generated_text;
} else {
  // Long-context fallback: Claude Sonnet 4.6
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 4096,
    temperature: 0.1,
    messages: [{ role: "user", content: prompt }],
  });
  raw = response.content[0].type === "text" ? response.content[0].text : "";
}
const parsed = SurgeonPatchOutput.parse(JSON.parse(raw));
```

Constraints:

- Diff must be valid unified format (`---`/`+++`/`@@` markers).
- We re-parse with `parse-diff` and reject malformed.
- Cap patch context to ±5 lines around hunks.
- Skip files >2000 LoC (out of scope for demo).

Failure modes + fallbacks:

| Failure | Fallback |
|---|---|
| Scan returns 0 affected files | Surface as "no migration needed" to user (rare on demo repos). |
| Patch call timeout (>60s) | Retry once; then fallback to Claude Sonnet 4.6 with same prompt. |
| Diff doesn't apply cleanly to original | Mark file `error`, exclude from audit, show in UI with raw diff. |
| watsonx rate-limit mid-run | Backoff with jitter; secondary failure → route entire worker pool to Claude for the remainder of the run. |
| Granite context window exceeded | Auto-routed to Claude per the size check above. No manual intervention. |

### 8.4 Examiner

- **Role**: generate regression tests informed by repo-wide call patterns. Run them against ORIGINAL code (baseline) before declaring tests valid.
- **Runtime LLM calls**: 1 `granite-3.0-8b-instruct` call per file, with `granite-3.0-2b-instruct` smoke-test fallback if baseline fails twice. For demo we cap at 5 files tested. Other files still get patched, just not green/red graded.

```ts
// agents/examiner/schema.ts
export const ExaminerOutput = z.object({
  path: z.string(),
  framework: z.literal("vitest"),
  source: z.string(),              // full spec file source
  rationale: z.string(),
  coverageHints: z.array(z.string()).default([]),
});
```

System prompt:

```
You are Examiner, agent 3 of 4.

Target file: {{path}}
Original source:
```
{{originalSource}}
```

The Surgeon will migrate this file. Your job is to PIN ITS CURRENT BEHAVIOR
with regression tests so we can verify the migration is safe.

Constraints:
1. Framework: Vitest. Use `import { describe, it, expect } from "vitest";`.
2. Test the PUBLIC interface of this file (default export, named exports).
3. If the file is a React component, render it with `@testing-library/react`
   and assert visible behavior — not implementation details.
4. Use the repo-wide context to construct realistic inputs (look at how
   other files call into this module).
5. Tests MUST pass against the ORIGINAL source unmodified. We will run them
   as a baseline.
6. Do NOT import anything from {{breakingChangeApiSurfaces}} directly in tests
   unless absolutely required.

Output JSON matching ExaminerOutput. Nothing else.
The "source" field is the full content of `tests/{{path}}.spec.ts`.
```

watsonx Granite call pattern:

```ts
// agents/examiner/index.ts
import { watsonx } from "@/lib/watsonx";

const response = await watsonx.text.generate({
  modelId: "ibm/granite-3-8b-instruct",
  projectId: process.env.WATSONX_PROJECT_ID,
  input: renderPrompt({ system: examinerPrompt, file, retrievedCallers }),
  parameters: {
    decoding_method: "greedy",
    max_new_tokens: 4096,
    temperature: 0.2,
    stop_sequences: ["</output>"],
  },
});
const parsed = ExaminerOutput.parse(JSON.parse(response.results[0].generated_text));
```

Constraints:

- Spec must declare its own deps; we install Vitest + RTL into the sandbox.
- If baseline run is red, regenerate twice with stricter prompt. Then fall back to a simpler "smoke test only" prompt against `granite-3.0-2b-instruct` that just verifies the module imports cleanly and a few obvious assertions hold.
- Skip tests entirely (mark file `tested` with `baselineOk=false` and `generatorModel=skipped`) if both retries fail. The patch is still applied; we just don't grade it green/red.

Failure modes + fallbacks:

| Failure | Fallback |
|---|---|
| Baseline test fails | Retry up to 2× with adjusted prompt → `granite-3.0-2b-instruct` smoke test → skip. |
| Vitest dependency conflict in repo | Use `--isolate` mode and a separate `package.json` in `/tests-renatus`. |
| Test takes >30s | Kill and mark skipped. |

### 8.5 Auditor

- **Role**: apply patch in sandbox, run tests against post-migration source, classify deviations, emit signed audit report.
- **Runtime LLM calls**: 1 `granite-3.0-8b-instruct` call at the end to synthesize a human-readable summary.

```ts
// agents/auditor/schema.ts
export const FileAudit = z.object({
  fileId: z.string().uuid(),
  path: z.string(),
  patchApplied: z.boolean(),
  baseline: z.object({ passed: z.boolean(), durationMs: z.number().nonnegative() }),
  post: z.object({
    passed: z.boolean(),
    durationMs: z.number().nonnegative(),
    failingTests: z.array(z.string()).default([]),
    stderr: z.string().optional(),
  }),
  classification: z.enum(["green", "red", "skipped", "error"]),
  // Pointers into inference_calls for the full reasoning trail per agent.
  inferenceCallIds: z.array(z.string().uuid()).default([]),
});

export const AuditorOutput = z.object({
  migrationId: z.string().uuid(),
  repoFullName: z.string(),
  targetSlug: z.string(),
  commitSha: z.string(),
  totals: z.object({
    files: z.number(),
    green: z.number(),
    red: z.number(),
    skipped: z.number(),
  }),
  files: z.array(FileAudit),
  summary: z.string(),
  inferenceCalls: z.array(z.object({
    id: z.string().uuid(),
    provider: z.enum(["watsonx", "anthropic"]),
    modelId: z.string(),
    agentKind: z.string(),
    purpose: z.string(),
    inputTokens: z.number().nullable(),
    outputTokens: z.number().nullable(),
    latencyMs: z.number().nullable(),
  })),
  signedHash: z.string(),
  signature: z.string(),
});
```

Synthesis prompt:

```
You are Auditor, agent 4 of 4.

You are writing the final audit summary for a migration:
- Repo: {{repoFullName}} @ {{commitSha}}
- Target: {{targetSlug}}
- Files migrated: {{totalFiles}}  (green: {{green}}, red: {{red}}, skipped: {{skipped}})

Per-file results:
{{#each files}}
- {{path}} → {{classification}} ({{post.passed}}). {{#if post.failingTests}}Failing tests: {{post.failingTests}}{{/if}}
{{/each}}

Write a clear, dispassionate 6-10 sentence summary suitable for a senior
engineer to skim before reviewing the patches. Reference specific breaking
changes by apiSurface. Do NOT say "I migrated" — say "Renatus migrated".
Do not exaggerate. If red files exist, name them.

Output JSON: { "summary": string } and nothing else.
```

Constraints:

- Sandbox is a separate Fly.io machine. Network egress disabled except to npm registry mirror.
- Test runs have a 60-second wall clock each.
- Signature: ed25519 over `sha256(JSON.stringify(auditMinusSig))`. Public key bundled in repo.

Failure modes + fallbacks:

| Failure | Fallback |
|---|---|
| Sandbox cannot install deps | Mark migration `failed` with `audit_sandbox_unavailable`; still produce a textual report. |
| Granite summary synthesis fails | Build summary deterministically from totals; mark `auditor.synthesizedBy=template`. |
| Network blip on test run | Retry 1×. |

---

## 9. API surface

### 9.1 Server actions

```ts
// app/actions/migrations.ts
"use server";
import { z } from "zod";

export const StartMigrationInput = z.object({
  repoUrl: z.string().url().refine(
    (u) => /^https:\/\/github\.com\/[^/]+\/[^/]+/.test(u),
    { message: "must be a GitHub repo URL" },
  ),
  targetSlug: z.string().min(3),
  commitSha: z.string().optional(),
});
export type StartMigrationInput = z.infer<typeof StartMigrationInput>;

export async function startMigration(
  input: StartMigrationInput,
): Promise<{ migrationId: string }> { /* ... */ }

export async function cancelMigration(
  migrationId: string,
): Promise<{ ok: true }> { /* ... */ }

export async function retryFile(input: {
  migrationId: string;
  fileId: string;
  fromStage: "patch" | "test" | "audit";
}): Promise<{ ok: true }> { /* ... */ }

export async function saveApiKey(input: {
  provider: "watsonx" | "anthropic" | "github";
  value: string;
  label?: string;
}): Promise<{ id: string }> { /* ... */ }
```

### 9.2 Route handlers

```
POST   /api/migrations                       -> { migrationId }
GET    /api/migrations/[id]                  -> Migration (full state)
GET    /api/migrations/[id]/files            -> FileRow[]
GET    /api/migrations/[id]/files/[fid]      -> FileDetail (patch+tests+runs+inference_calls)
GET    /api/migrations/[id]/audit            -> AuditorOutput (includes every inference_call)
GET    /api/migrations/[id]/audit.pdf        -> binary PDF
GET    /api/migrations/[id]/inference-trail  -> per-file Granite/Claude prompt+response trail
POST   /api/migrations/[id]/cancel           -> 204
GET    /api/migrations/[id]/graph            -> { nodes, links } (Neo4j projection)
GET    /api/migrations/[id]/stream           -> text/event-stream (SSE)
POST   /api/webhooks/github                  -> 204 (optional, P2)
```

Sample handler:

```ts
// app/api/migrations/route.ts
import { NextRequest } from "next/server";
import { startMigration, StartMigrationInput } from "@/app/actions/migrations";

export async function POST(req: NextRequest) {
  const json = await req.json();
  const parsed = StartMigrationInput.safeParse(json);
  if (!parsed.success) {
    return Response.json({ error: parsed.error.format() }, { status: 400 });
  }
  const { migrationId } = await startMigration(parsed.data);
  return Response.json({ migrationId }, { status: 202 });
}
```

### 9.3 SSE endpoint for live agent progress

```ts
// app/api/migrations/[id]/stream/route.ts
import { redis } from "@/lib/redis";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_: Request, ctx: { params: { id: string } }) {
  const { id } = ctx.params;
  const stream = new ReadableStream({
    start(controller) {
      const sub = redis.duplicate();
      sub.subscribe(`migrations:${id}:events`);
      sub.on("message", (_ch, msg) => {
        controller.enqueue(new TextEncoder().encode(`data: ${msg}\n\n`));
      });
      const ping = setInterval(() => {
        controller.enqueue(new TextEncoder().encode(`: ping\n\n`));
      }, 15_000);
      // close on abort
      (controller as any)._cleanup = () => { sub.unsubscribe(); clearInterval(ping); };
    },
    cancel() { (this as any)._cleanup?.(); },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "Connection": "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
```

Event types pushed on the channel:

```
event: agent.started   { agentKind }
event: agent.progress  { agentKind, itemsProcessed, itemsTotal }
event: file.detected   { fileId, path, breakingChangeIds }
event: file.patched    { fileId, patchPreview }
event: file.tested     { fileId, baselineOk }
event: file.green      { fileId }
event: file.red        { fileId, failingTests }
event: agent.done      { agentKind }
event: migration.completed { auditUrl }
event: migration.failed { reason }
```

### 9.4 Webhook for GitHub repo events (P2)

`POST /api/webhooks/github` accepts `push` events. If the repo is one we're watching, automatically opens a PR with the latest migration against `main`. Stretch goal, descoped on Sun morning if behind.

---

## 10. UI / UX design

### 10.1 Design tokens

```css
/* app/globals.css */
:root {
  --bg:        #09090b;  /* zinc-950 */
  --bg-1:      #18181b;  /* zinc-900 */
  --bg-2:      #27272a;  /* zinc-800 */
  --line:      #3f3f46;  /* zinc-700 */
  --fg:        #fafafa;  /* zinc-50  */
  --fg-1:      #d4d4d8;  /* zinc-300 */
  --fg-2:      #a1a1aa;  /* zinc-400 */
  --accent:    #06b6d4;  /* cyan-500 */
  --accent-dim:#0e7490;  /* cyan-700 */
  --green:     #22c55e;
  --red:       #ef4444;
  --amber:     #f59e0b;

  --r-sm: 6px;
  --r-md: 10px;
  --r-lg: 14px;

  --font-sans: "Inter", system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, monospace;

  --shadow-1: 0 1px 0 rgba(255,255,255,.04) inset, 0 0 0 1px rgba(255,255,255,.04);
  --shadow-2: 0 8px 24px rgba(0,0,0,.4);
}
```

Body: `bg-zinc-950 text-zinc-100 font-sans antialiased`. Code: `font-mono`.

### 10.2 Component library mapping

| Need | shadcn primitive | Notes |
|---|---|---|
| Button | `<Button>` | variant `default`, `ghost`, `outline` |
| Modal | `<Dialog>` | new migration wizard |
| Tabs | `<Tabs>` | audit report sections |
| Card | `<Card>` | agent column items |
| Tooltip | `<Tooltip>` | breaking-change descriptions |
| Toast | `<Toast>` | success / failure |
| Progress | `<Progress>` | top-level migration progress |
| Tree | custom | file tree in graph panel |
| Skeleton | `<Skeleton>` | replaces all spinners |

### 10.3 Key screens

#### 10.3.1 New Migration wizard

```
+-------------------------------------------------------------------+
| Renatus                                          [keys] [theme]    |
+-------------------------------------------------------------------+
|                                                                   |
|        Start a migration                                          |
|        ─────────────────                                          |
|                                                                   |
|        Repository                                                  |
|        [ https://github.com/_______________________________ ]      |
|                                                                   |
|        Migration target                                            |
|        ( • ) react@18 → react@19                                  |
|        (   ) python@3.10 → 3.12                                   |
|        (   ) tailwind@3 → 4                                       |
|        (   ) drizzle@0.x → 1.0                                    |
|                                                                   |
|        Commit (optional)                                           |
|        [ main ]                                                   |
|                                                                   |
|                                       [ cancel ]  [ start ↵ ]      |
+-------------------------------------------------------------------+
```

Validation: GitHub URL pattern + check Octokit accessibility. Returns `migrationId`, redirects to `/m/[id]`.

#### 10.3.2 4-Agent live work view

```
+-------------------------------------------------------------------+
| renatus › facebook/react-router · react@18→19                     |
| ████████░░░░░░░░░░░ 42% · 8/19 green · 1 red · 5:31 elapsed       |
+-------------------------------------------------------------------+
| Cartographer    | Surgeon         | Examiner       | Auditor      |
| ●done           | ●working        | ●working       | ●waiting     |
+-----------------+-----------------+----------------+--------------+
| 13 breaking ch. | src/App.tsx     | tests/App      | (queue 12)   |
|  - ReactDOM.    |   ● patching    |   ● baseline   |              |
|    render       |                 |     pass       |              |
|  - useRef()     | src/main.tsx    |                |              |
|    null arg     |   ✓ patched     | src/main.tsx   |              |
|  - act in       |                 |   ✓ tested     |              |
|    test-utils   | src/Layout.tsx  |                |              |
|  - hydrate      |   ✓ patched     | src/Layout.tsx | src/main.tsx |
|  - …            |                 |   ✓ tested     |   ✓ green    |
|                 | src/Form.tsx    |                |              |
|                 |   ⚠ skipped     |                | src/Layout   |
|                 |   (over 2k LoC) |                |   ✓ green    |
+-----------------+-----------------+----------------+--------------+
|        [ 3D codebase graph ▾ ]   [ diffs ]   [ audit ]            |
+-------------------------------------------------------------------+
```

Each card animates in via Framer (`opacity 0 → 1`, `y +6 → 0`, `duration 180ms`). When a file moves from Surgeon to Examiner, the card smoothly translates between columns using a layout animation (shared `layoutId`).

#### 10.3.3 3D Codebase Knowledge Graph

```
+-------------------------------------------------------------------+
| 3D codebase graph                            [ ⤢ ] [ filter ]      |
+-------------------------------------------------------------------+
|                                                                   |
|             ·                                                     |
|        ·    ●           ●                ● src/main.tsx           |
|       ●  ───●───── ●    │                                          |
|       │     │           ●   ●  ──────●                            |
|       │     ●           │   │       │                              |
|       ●─────●───────────●───●───────●                             |
|                                                                   |
|       (R3F: drag-rotate, scroll-zoom, click-focus)                |
|                                                                   |
| Legend:  ● file   ● module   ● test   ◍ breaking change           |
| Edges:   import (thin)    AFFECTS (animated cyan pulse)           |
+-------------------------------------------------------------------+
```

When a file is patched, the AFFECTS edges from the BreakingChange node pulse cyan for 800ms then dim. When tests turn green, the file node flashes green for 400ms. Reduced motion: no pulses; status communicated via static color only.

#### 10.3.4 File-by-file Diff Viewer

```
+-------------------------------------------------------------------+
| src/main.tsx                            patch · tests · audit log |
+-------------------------------------------------------------------+
| 1  - import ReactDOM from "react-dom";                            |
|    + import { createRoot } from "react-dom/client";               |
| 2                                                                 |
| 3    import App from "./App";                                     |
| 4                                                                 |
| 5  - ReactDOM.render(                                             |
| 6  -   <App />,                                                   |
| 7  -   document.getElementById("root")                            |
| 8  - );                                                           |
|    + const root = createRoot(document.getElementById("root")!);   |
|    + root.render(<App />);                                        |
+-------------------------------------------------------------------+
| Rationale (Surgeon · granite-3-8b)                                |
| Replaced ReactDOM.render with createRoot(...).render(...) per     |
| breaking change [bc-uuid-1]. Adjusted import to `react-dom/client`|
| as required.                                                      |
+-------------------------------------------------------------------+
| Tests (3 / 3 green)                                               |
|  ✓ renders <App /> into root                                      |
|  ✓ root.render does not throw on second call                      |
|  ✓ unmounts cleanly via root.unmount                              |
+-------------------------------------------------------------------+
```

Powered by `react-diff-view` with the `unified` view-type, `gutterType: 'default'`. Syntax highlighting via `refractor` + the `tsx` grammar.

#### 10.3.5 Test Results panel

```
+-------------------------------------------------------------------+
| Tests                                            8 green · 1 red  |
+-------------------------------------------------------------------+
| ✓ src/main.tsx          3/3   42ms                                |
| ✓ src/Layout.tsx        5/5   88ms                                |
| ✓ src/components/Btn    2/2   31ms                                |
| ✗ src/hooks/useFetch    4/5   71ms                                |
|     ‒ "aborts on unmount"  AbortController.abort is now called    |
|       synchronously; test asserted async timing.                  |
|     [ open diff ]   [ inference trail ]   [ retry ]               |
| ✓ src/components/Form   3/3   55ms                                |
+-------------------------------------------------------------------+
```

#### 10.3.6 Audit Report viewer

```
+-------------------------------------------------------------------+
| Audit report · facebook/react-router · react@18→19                |
| commit: a7c91b2 · signed: ed25519:8f4a2…                          |
+-------------------------------------------------------------------+
| Summary                                                           |
| Renatus migrated 19 files for the react@18→19 target. 17 went     |
| green on regression tests. One file (src/hooks/useFetch) failed   |
| because AbortController.abort is now invoked synchronously, and   |
| an existing test asserted async timing. One file (src/Form.tsx)   |
| was skipped because it exceeded the 2k LoC patch budget. …       |
+-------------------------------------------------------------------+
| Files                                                             |
|  src/main.tsx              green   ⤓ patch  ⤓ tests  ⤓ reasoning  |
|  src/Layout.tsx            green   ⤓ patch  ⤓ tests  ⤓ reasoning  |
|  …                                                                 |
|  src/hooks/useFetch.tsx    red     ⤓ patch  ⤓ tests  ⤓ reasoning  |
+-------------------------------------------------------------------+
| Inference trail (42 calls)                                         |
|  watsonx · granite-3-8b · cartographer · 12.4k → 1.1k tok · 2.1s   |
|  watsonx · granite-3-8b · surgeon-scan · 14.8k → 3.2k tok · 5.4s   |
|  anthropic · claude-sonnet-4-6 · surgeon-patch · file_id=…         |
|  …                                                                 |
+-------------------------------------------------------------------+
| Export                                                            |
| [ download audit.json ]  [ download audit.pdf ]                   |
+-------------------------------------------------------------------+
| Construction evidence: see `bob_sessions/` in the repo for the 30+|
| Bob IDE task sessions that built Renatus during the 48-hour build.|
+-------------------------------------------------------------------+
```

#### 10.3.7 Past Migrations list

```
+-------------------------------------------------------------------+
| Past migrations                                                   |
+-------------------------------------------------------------------+
| repo                       target       files   green  status     |
| facebook/react-router      react@19     19      17     ✓ done     |
| vercel/next-app-template   react@19     12       9     ⚠ red      |
| myname/old-app             react@19      8       8     ✓ done     |
+-------------------------------------------------------------------+
```

#### 10.3.8 Settings / API key management

```
+-------------------------------------------------------------------+
| Settings · API keys                                                |
+-------------------------------------------------------------------+
| watsonx.ai    [ ●●●●●●●●●●●●●●●●●● ]   added 12:04 PM   [ rotate ]|
|   project_id  [ ●●●●●●●●●●●●●●●●●● ]   added 12:04 PM   [ rotate ]|
|   endpoint    [ us-south.ml.cloud.ibm.com ]              [ save ] |
| Anthropic     [ ●●●●●●●●●●●●●●●●●● ]   added Wed         [ rotate ]|
|   (Surgeon long-context fallback only)                            |
| GitHub PAT    [ ●●●●●●●●●●●●●●●●●● ]   scope: repo       [ rotate ]|
+-------------------------------------------------------------------+
| Keys are encrypted at rest with libsodium secretbox. Nonce stored |
| separately. IBM Bob is the dev partner, not a runtime service —   |
| no Bob credentials are stored or used by the deployed product.    |
+-------------------------------------------------------------------+
```

### 10.4 Animations & micro-interactions

| Element | Animation | Duration | Spring/ease |
|---|---|---|---|
| Card in agent column | fade-in + y-shift | 180ms | `ease-out` |
| Card cross-column move | layout (shared id) | 320ms | `spring 280/24` |
| Breaking change row | stagger 50ms each | 200ms | `ease-out` |
| Graph node pulse on AFFECTS | radius 1× → 1.5× → 1× | 800ms | `ease-in-out` |
| File flip to green | bg flash → fade | 400ms | `ease-out` |
| Progress bar | width tween | 600ms | `ease` |
| Diff viewer reveal | fade | 120ms | linear |
| Toast | slide-up | 160ms | `ease-out` |
| Skeleton shimmer | bg-position loop | 1.6s | linear (infinite) |

All wrapped by:

```tsx
const reduced = useReducedMotion();
return reduced ? <div /> : <motion.div ... />;
```

### 10.5 Accessibility

- Color contrast: every text-on-bg pair meets WCAG AA. Audit with `axe-core` once on Sat night.
- Keyboard nav: every interactive element focusable; visible focus ring (`outline outline-2 outline-cyan-500`).
- Screen reader: ARIA live region for SSE events (`role="status"`, `aria-live="polite"`).
- Motion: respect `prefers-reduced-motion`.
- Color blindness: never use color alone — green/red files also carry `✓`/`✗` glyphs.
- Modals: focus trap via Radix Dialog (shadcn default).

---

## 11. Setup & accounts

### 11.1 Sign-ups required

| Service | Tier | Required for | Sign-up time |
|---|---|---|---|
| **IBM Cloud (watsonx.ai)** | hackathon credit ($80) | **Runtime LLM (Granite-3)** — primary path for every migration. Request hackathon account per PDF guide pages 21–23. | 10 min (account request) + 5 min (project create) |
| IBM Bob IDE | hackathon-issued | **Dev partner only** — solo builder uses Bob during the 48h. Not deployed. | provided at event kickoff |
| Neo4j AuraDB | Free | Knowledge graph | 5 min |
| Neon (with `pgvector` ext) | Free | Postgres + retrieval embeddings | 3 min |
| Upstash Redis | Free | BullMQ | 3 min |
| Vercel | Hobby | Hosting | 2 min |
| GitHub | existing | Repo + Octokit token | n/a |
| Fly.io | Free | Long-running BullMQ workers + sandbox | 5 min |
| Anthropic | pay-as-go | **Runtime fallback** for Surgeon long-context cross-file reasoning | 5 min |
| Sentry | Developer | Error tracking | 3 min |
| Resend (optional) | Free | Email on migration complete | 3 min |
| Lablab.ai | existing | Submission | n/a (registered Wed) |

All accounts should be live and tested by **Thu 14 May EOD**.

**watsonx.ai setup specifics** (per IBM Cloud hackathon PDF guide, pages 21–23 and 40–43):

1. **IBM Cloud hackathon account request** (pages 21–23): visit the hackathon-provided onboarding link. The $80 IBM Cloud credit is automatically applied to your account.
2. **watsonx.ai project creation** (pages 40–41): in IBM Cloud console, create a new watsonx.ai project. Note the `project_id`. Bind a watsonx Runtime service instance to the project.
3. **Generate an IAM access token** (pages 42–43): the SDK does this for you using your API key. For manual testing, POST to `https://iam.cloud.ibm.com/identity/token` with `grant_type=urn:ibm:params:oauth:grant-type:apikey&apikey=<YOUR_KEY>`. Token TTL is ~60 min; `lib/watsonx.ts` caches and refreshes.
4. **Store credentials in `.env.local`**: `WATSONX_AI_API_KEY`, `WATSONX_PROJECT_ID`, `WATSONX_ENDPOINT` (default `https://us-south.ml.cloud.ibm.com`).
5. **Anthropic key** in `.env.local` as `ANTHROPIC_API_KEY` — only for Surgeon long-context fallback.

**IBM Bob IDE setup** (dev-time only): install Bob from the hackathon-provided download link. Sign in with the credentials issued at event kickoff. Configure `.bobignore` at the repo root to exclude `bob_sessions/` (avoids meta-recursion when running new Bob sessions).

### 11.2 API keys & secrets management

`.env.local` template:

```
# database (Neon with pgvector extension)
DATABASE_URL=postgresql://...neon.tech/renatus
NEO4J_URI=neo4j+s://....neo4j.io
NEO4J_USER=neo4j
NEO4J_PASS=...

# queue
REDIS_URL=rediss://default:...@...upstash.io:6379

# RUNTIME LLM — watsonx.ai Granite (primary)
WATSONX_AI_API_KEY=...
WATSONX_PROJECT_ID=...
WATSONX_ENDPOINT=https://us-south.ml.cloud.ibm.com

# RUNTIME LLM — Anthropic Claude (Surgeon long-context fallback only)
ANTHROPIC_API_KEY=sk-ant-...

# Note: NO Bob credentials at runtime. Bob is a desktop IDE used by the
# solo builder during the 48-hour build; the deployed product does not
# call Bob.

# github
GITHUB_TOKEN=ghp_...

# sandbox (Fly)
FLY_API_TOKEN=...
FLY_APP_NAME=renatus-sandbox

# crypto
LIBSODIUM_MASTER_KEY=base64...
AUDIT_SIGNING_PRIVATE_KEY=base64...
AUDIT_SIGNING_PUBLIC_KEY=base64...

# misc
NEXT_PUBLIC_APP_URL=https://renatus.vercel.app
SENTRY_DSN=...
```

In Vercel, every key is set as a Production env var with `Encrypted` flag. `.env.example` checked into git.

### 11.3 Local dev setup

```bash
git clone git@github.com:thisisaman408/renatus.git
cd renatus
bun install
cp .env.example .env.local && $EDITOR .env.local
bun run db:push        # drizzle-kit push to Neon
bun run graph:bootstrap # cypher to seed Neo4j indexes
bun run dev            # next dev on :3000
# in another terminal:
bun run worker         # BullMQ worker pool
```

### 11.4 Deployment to Vercel

```bash
vercel link
vercel env pull .env.production.local
vercel --prod
```

Edge functions: `/api/migrations/[id]/stream` runs on Node runtime (SSE not supported on Edge in Next 16 stable as of cutoff). Workers run on Fly (`fly deploy` from `apps/worker`).

DNS: `renatus.vercel.app` until Sun morning, then optional `renatus.dev` if user has the domain. (No DNS in MVP.)

---

## 12. Standard Operating Procedures (SOPs)

### 12.1 Pre-event SOP (Wed 13 May – Fri 15 May morning)

| When | Action | Done if |
|---|---|---|
| Wed 13 May AM | Read all hackathon rules. Verify submission format on lablab.ai page. Read watsonx.ai PDF guide (pages 21–23, 36–43). | Notes file written. |
| Wed 13 May AM | **Register on lablab.ai for IBM Bob hackathon BEFORE Fri 1 PM CET cutoff.** | Confirmation email received. |
| Wed PM | **Request IBM Cloud hackathon account; verify $80 credit applied; create watsonx.ai project; capture `WATSONX_PROJECT_ID` and API key.** | Test call to `granite-3.0-8b-instruct` returns text. |
| Wed PM | Create accounts: Neon (enable `pgvector`), Upstash, Neo4j AuraDB, Vercel, Fly.io, Anthropic. | Each dashboard accessible. |
| Wed PM | Reserve `renatus.vercel.app` subdomain. | Vercel project exists. |
| Wed PM | Scaffold Next.js 16 app, install shadcn, Tailwind v4, Drizzle, BullMQ, R3F, `@ibm-cloud/watsonx-ai`, `@anthropic-ai/sdk`. Commit. | `bun run dev` shows the empty shell. |
| Thu 14 May | Write `db/schema.ts` (full), `bun run db:push`. | Tables exist in Neon. |
| Thu 14 May | Pre-seed `breaking_changes` for react@18→19 from the catalog above. | Row count ≥ 13. |
| Thu 14 May | Stub the 4 agents as no-op Node modules with Zod schemas in place. | `bun test` green. |
| Thu 14 May | Build skeleton 4-column live view with mocked SSE. | Demo URL shows 4 columns. |
| Thu 14 May | Write the system design doc (this file). | File committed. |
| Thu EOD | Cover image, slide deck draft 1 (10 slides). | PDFs in `/assets`. |
| Fri 15 May 7:00 AM ET (registration cutoff) | Verify registration confirmation. | Email present in inbox. |
| Fri 15 May AM | Pre-pick demo target repos (§17). Clone each and dry-run `git clone` from worker tmpfs. | 3 repos validated. |
| Fri 15 May 7:30 PM IST | Final pre-flight: env vars set in Vercel, deploy a "Hello Renatus" page. | URL loads; one test Granite call from production succeeds. |
| Fri 15 May 8:30 PM IST | **Hackathon starts. Bob IDE credentials become available; install Bob; sign in; confirm whole-repo reading on the Renatus repo.** | First Bob session exported to `bob_sessions/plan/00-bob-hello/`. |

### 12.2 48-hour build SOP

Times in IST (UTC+5:30). Sleep target: 6h Sat overnight (Sat 2 AM – Sat 8 AM) + 2h power nap Sun afternoon.

| Block | Time (IST) | Focus | Acceptance criterion |
|---|---|---|---|
| 1 | Fri 20:30 – 22:30 | Kickoff. Run a Bob IDE Plan session that scopes Block-1 work and writes `lib/watsonx.ai` adapter (IAM token flow + `text.generate`). Wire a hello-world Granite call. Export this session to `bob_sessions/code/10-watsonx-adapter/`. | First `granite-3-8b-instruct` call from local returns text; one Bob session exported. |
| 2 | Fri 22:30 – 00:30 | Cartographer agent end-to-end via Bob Plan + Code sessions (sessions 01, 02 in §5.5). Granite reads upstream changelog chunks (pgvector retrieved from `@octokit/rest`-fetched files), returns parsed `BreakingChange[]`. Persist to DB. | `breaking_changes` rows populated for react@18→19; both Bob sessions exported. |
| 3 | Sat 00:30 – 02:00 | Surgeon scan phase via Bob sessions 03, 04. Granite reads pgvector-retrieved repo chunks, returns affected files. Persist to `files`. Neo4j `AFFECTS` edges. | Scan returns 10–30 files for demo repo. |
| **SLEEP** | Sat 02:00 – 08:00 | Sleep. Non-negotiable. | Alive. |
| 4 | Sat 08:00 – 10:00 | Surgeon patch phase via Bob session 05. Granite emits unified diff per file; Claude Sonnet 4.6 takes over on >14k-token files. Persist to `patches`. | 3+ patches in DB; one applies cleanly to original. |
| 5 | Sat 10:00 – 12:00 | Examiner agent via Bob sessions 06, 07. Granite generates Vitest spec per file. Baseline run on original code. | At least 3 specs green on baseline. |
| 6 | Sat 12:00 – 13:00 | Lunch + standup with self. Review demo plan. Trim P1 features that drift. | Burndown updated. |
| 7 | Sat 13:00 – 15:00 | Auditor agent + Fly.io sandbox via Bob sessions 08, 09, 21. Apply patch, run tests against post-migration source, classify green/red. Granite summary synthesis. | One file goes green end-to-end. |
| 8 | Sat 15:00 – 17:00 | SSE stream wiring via Bob session 15. 4-column live view animates. Cards bounce between columns. | Demo URL shows live agent activity. |
| 9 | Sat 17:00 – 19:00 | Diff viewer + audit report viewer via Bob sessions 17, 18, 19. react-diff-view integrated. Audit page shows totals + file list + inference trail. | End-to-end works on one demo repo. |
| 10 | Sat 19:00 – 21:00 | 3D codebase knowledge graph via Bob session 16 (R3F + react-force-graph-3d). Nodes from Neo4j query. AFFECTS edges animated. | Graph renders ≥50 nodes from real data. |
| 11 | Sat 21:00 – 23:00 | Audit export. Aggregate `agent_runs` + `inference_calls` into `audit.json`. PDF render. Verify `bob_sessions/` folder has all sessions exported so far. | Endpoint returns file; `bob_sessions/` count ≥ 20. |
| 12 | Sat 23:00 – 00:30 | Polish pass 1: typography, spacing, dark theme, focus rings, skeleton shimmers. | UI screenshot looks like Stripe Docs × GitHub. |
| **SLEEP** | Sun 00:30 – 06:30 | Sleep. Non-negotiable. | Alive. |
| 13 | Sun 06:30 – 08:30 | Disaster recovery: run end-to-end on **all 3 primary demo repos**. Note failures. | At least 2 of 3 work cleanly. |
| 14 | Sun 08:30 – 10:30 | Fix the most likely demo failure. Verify watsonx fallback to Claude on long-context files works. Verify the pre-seeded `catalogs/react-18-to-19.ts` triggers cleanly if Granite refuses. | Hardcoded fallback for cartography ready; one e2e run with Claude-only path succeeds. |
| 15 | Sun 10:30 – 12:00 | Past migrations list, settings, key management via Bob session 20. Audit signature via Bob session 19. | Settings screen functional. |
| 16 | Sun 12:00 – 13:00 | Lunch. Practice the 3-minute pitch out loud. Time it. | Pitch ≤ 3:05. |
| 17 | Sun 13:00 – 15:00 | Record the 3-minute demo video. Loom + OBS. Two takes. Pick best. | MP4 uploaded to YouTube unlisted. |
| 18 | Sun 15:00 – 16:00 | Slide deck final pass (10 slides). PDF export. Cover image v2. | `/assets/deck.pdf` committed. |
| 19 | Sun 16:00 – 17:30 | Run final end-to-end. Commit `/audit/*` to repo. Final pass on `bob_sessions/` — ensure 30+ sessions exported, README updated, every session has the four required files. | Repo green on CI; `bob_sessions/` count ≥ 30. |
| 20 | Sun 17:30 – 18:00 | Submit on lablab.ai. Demo URL pinned to a tag. | Submission confirmation email. |
| 21 | Sun 18:00 – 20:30 | Buffer. Watch for any submission edits required. Re-record video if needed. | Nothing on fire. |

If by Block 7 the end-to-end isn't working, cut: 3D graph (P1), PDF audit (P1), signed audit (P2), retry-file UI (P1).

### 12.3 Pre-demo checklist

Run 30 minutes before recording the video:

- [ ] Vercel deploy green on latest commit.
- [ ] `WATSONX_AI_API_KEY` + `WATSONX_PROJECT_ID` rotated and saved in Vercel + local.
- [ ] `ANTHROPIC_API_KEY` valid (test Surgeon fallback once today).
- [ ] `GITHUB_TOKEN` has `repo` + `read:user` scopes.
- [ ] Demo repo (#1) cloneable, target branch confirmed.
- [ ] Browser cache cleared. Window in 16:9, 1920×1080.
- [ ] Background services running (Fly worker machine awake).
- [ ] Audio: mic level checked.
- [ ] Slides queued.
- [ ] Notes file open in second monitor with cue lines.
- [ ] Audit export tested ≥1 time today.
- [ ] `bob_sessions/` folder count verified ≥ 30; README index in folder is current.

### 12.4 Submission procedure

1. Tag commit: `git tag -a v1.0.0-submission -m "Renatus submission"; git push --tags`.
2. Set Vercel production deployment to that tag.
3. Verify `bob_sessions/` exists at repo root with ≥30 session subfolders. Each session subfolder has `screenshot.png`, `transcript.md`, `summary.md`.
4. Verify `/audit/audit.json` and `/audit/audit.pdf` exist for the recorded demo run.
5. Upload demo video to YouTube (unlisted) and Loom. Note both URLs.
6. Upload slide deck PDF to a public Drive folder. Note URL.
7. Cover image: PNG 1920×1080 uploaded to lablab.ai project page.
8. Fill lablab.ai project page:
   - Project name: **Renatus**
   - Tagline: *Multi-agent migration crew that ships safe cross-version upgrades.*
   - Description: 800 words pulling from §1, §2.
   - GitHub URL: `https://github.com/thisisaman408/renatus`
   - Demo URL: `https://renatus.vercel.app`
   - Video URL: YouTube unlisted.
   - Tech stack: Next.js, watsonx.ai Granite-3, IBM Bob IDE (dev partner), Neo4j, Postgres + pgvector, Redis, R3F, TypeScript.
   - **IBM Bob usage explanation**: dedicated section, 200 words, link directly to the `bob_sessions/` folder in the GitHub repo. Explain Bob is the 48-hour dev partner; watsonx Granite is the runtime LLM.
9. Click Submit. Screenshot the confirmation. Save to `/submission-evidence/`.

### 12.5 Demo failure recovery

Tiered fallback for the live video:

| Failure | Detection signal | Recovery |
|---|---|---|
| watsonx Granite rate-limit during recording | 429 from watsonx endpoint | Auto-route to Claude Sonnet 4.6 for the remainder of the run; if both fail, switch to pre-recorded backup video (Block 19). |
| watsonx IAM token expired | 401 from watsonx endpoint | `lib/watsonx.ts` auto-refreshes the IAM bearer token. If refresh fails, fall back to Claude. |
| Anthropic Claude unavailable too | 5xx from Anthropic | Use pre-recorded backup video. |
| Octokit clone fails | non-200 | Switch to local-cached copy of demo repo (stored in `/.demo-cache/`). |
| Sandbox times out on tests | 60s timeout | Skip Auditor, show pre-computed audit from `/.demo-cache/audit.json`. |
| Graph crashes | React error boundary | Hide graph panel, swap for static screenshot. |
| Entire app down | health check fails | Use pre-recorded video. Submission has the URL anyway. |

Pre-recorded backup video (recorded Sun 13:00–15:00) is the safety net. Live video is the *ideal*, not the *only*, deliverable.

### 12.6 How to export Bob IDE task sessions to `bob_sessions/`

Bob is the AI IDE the solo builder uses for the 48-hour build. Every "task session" in Bob (a Plan-mode, Code-mode, Orchestrator-mode, `/review`, or `/commit` run) needs to be exported and committed to `bob_sessions/` as construction evidence for judging.

Procedure for **each Bob task session** (repeat 30+ times across the build):

1. In Bob IDE, complete the task session normally (Plan, Code, Orchestrator, `/review`, or `/commit`).
2. When the session ends, use Bob's built-in export feature to save the task transcript as markdown. Save into a new folder under the appropriate category in `bob_sessions/`:
   - `bob_sessions/plan/NN-<short-slug>/transcript.md` for Plan-mode
   - `bob_sessions/code/NN-<short-slug>/transcript.md` for Code-mode
   - `bob_sessions/orchestrator/NN-<short-slug>/transcript.md` for Orchestrator-mode
   - `bob_sessions/review-commit/NN-<short-slug>/transcript.md` for `/review` and `/commit`
3. Capture a screenshot of Bob's task console at completion and save as `screenshot.png` in the same folder.
4. Write a 3–5 sentence `summary.md` in the same folder describing what shipped from this session and the resulting commit SHA.
5. Commit the folder. The session counter NN increments globally.
6. Update `bob_sessions/README.md` with a one-line entry for the new session.

The expected layout was sketched in §3.2.

> **Known unknown**: Bob IDE's exact task-export UI is confirmed only at event kickoff (Fri 8:30 PM IST). If Bob ships with built-in JSON export instead of markdown, the procedure adjusts to dump JSON alongside the screenshot. If Bob has no native export, the builder copy-pastes the task console output to `transcript.md` manually.

The submission only requires that `bob_sessions/` contains 30+ session folders, each with a screenshot + transcript + summary. The product itself does not depend on this folder at runtime.

---

## 13. Demo script

### 13.1 The 90-second killer moment (live React 18→19 migration)

Setup before recording:

- Two browser tabs: (a) Renatus app at `/m/new`, (b) the target GitHub repo (e.g. `vitejs/vite-react-ts-template` or `tailwindlabs/headlessui` examples — see §17).
- Terminal at the bottom with `bun run worker` already running.
- Audio cue file ready (subtle keyboard click on each agent transition).

Narration (word-for-word):

> [0:00–0:08] "This is a real React 18 app on GitHub. Eighteen files. Today, React 19 broke seven APIs they used. Migration would normally take a senior engineer most of a week."
>
> [0:08–0:18] "Renatus is a crew of four AI agents — Cartographer, Surgeon, Examiner, Auditor — running on watsonx.ai Granite. Watch."
>
> *(Paste repo URL, click "react@18 → 19", click Start.)*
>
> [0:18–0:30] "The Cartographer reads the React 19 changelog right now, in front of you. Twelve breaking changes." *(Cards animate into column 1.)* "These come from a live Granite call over the indexed `facebook/react` repo, retrieved via pgvector — not a static list."
>
> [0:30–0:45] "The Surgeon now reasons over the entire target repo. Renatus indexed every file into pgvector at submission; Granite gets the right chunks for every breaking change." *(Column 2 starts populating.)* "Surgeon finds nineteen files affected — ReactDOM.render, useRef without an arg, act in test-utils, default props, three more."
>
> [0:45–1:00] "While Surgeon patches, the Examiner pins existing behavior with regression tests, informed by how the rest of the codebase calls these symbols. Same retrieval pipeline."
>
> [1:00–1:15] "The Auditor takes over. Applies the patch in a sandbox. Runs the regression tests against the migrated code."
>
> *(Cards drop into the Auditor column. Most go green. One goes red.)*
>
> [1:15–1:25] "Seventeen green. One red — and that's the point. The red file is honest: Renatus says here's where the breaking change broke behavior that an engineer must review. The full per-agent reasoning trail is one click away."
>
> [1:25–1:35] "Audit report. Signed. Every Granite and Claude call is logged with prompt, response, and retrieved context. This is the artifact you ship to a senior engineer for review — replacing a week of grep-and-pray with thirty minutes of verification."
>
> *(Click a node in the agent timeline; sidebar opens showing the Bob IDE session that built that agent during the 48-hour hackathon.)*
>
> [1:35–1:45] "Every agent in this crew was built in a Bob IDE task session during this hackathon. Thirty-plus sessions in the `bob_sessions/` folder — that's the construction evidence. Renatus runs on Granite; Bob built Renatus."
>
> [1:45–1:50 end] "Renatus. Bring your codebases back."

Total: ~95 seconds of narration, fits the 90-second showcase block with light trim on the closing line.

### 13.2 Full 3-min video structure

| Time | Content |
|---|---|
| 0:00–0:10 | Cold open: a senior eng staring at a `react-dom/render is not a function` stacktrace at 2 AM. Cut to title card: **Renatus**. |
| 0:10–0:25 | The problem in 15 seconds: framework version migrations are expensive, brittle, and PR-review tools that only see diffs can't help. The wedge: a four-role crew with regression-test pinning and a signed audit trail. |
| 0:25–1:50 | The killer 90-second demo (§13.1). |
| 1:50–2:15 | The architecture in 25 seconds: ASCII diagram from §5.1 voiced over. "Runtime: watsonx.ai Granite-3 with pgvector retrieval, Claude long-context fallback. Four agents, BullMQ flow, signed audit." |
| 2:15–2:40 | Why this wedge: "PR review only needs a diff. Documentation only needs a sample. Cross-version migration is the only dev-tools job that requires reasoning across the whole repo with regression-test pinning. Zero teams in this lane." |
| 2:40–2:55 | Bob as the dev partner: "Every agent in this crew was built during the 48-hour hackathon in a Bob IDE task session. Thirty-plus sessions exported to `bob_sessions/` — the receipt that Bob is the dev partner that made building this in 48 hours possible." |
| 2:55–3:00 | "Renatus. Bring your codebases back." Cards fade. Logo. |

### 13.3 Backup plan if live migration fails

- **Tier 1**: Pre-recorded backup video of a known-good run, recorded Sun 13:00–15:00 on **all 3 primary demo repos**. Picked the cleanest run.
- **Tier 2**: Live demo on demo repo #2 (a smaller/simpler one).
- **Tier 3**: A walkthrough of the static audit report from a prior successful run, on a slide.
- **Tier 4**: Slides only with screenshots.

The submitted 3-min video is always the pre-recorded version. Live demo only happens if there's a finalist round.

---

## 14. Risk register

Probabilities/impact: L=low, M=medium, H=high.

| # | Risk | Prob | Impact | Mitigation |
|---|---|---|---|---|
| R1 | **watsonx.ai Granite rate-limits / quota / endpoint outage mid-build or mid-demo** | M | H | All Surgeon long-context paths already route to Claude Sonnet 4.6. If Granite is entirely unavailable, route every agent to Claude. Cartographer falls back to pre-seeded `catalogs/react-18-to-19.ts` with zero LLM calls. |
| R2 | **Bob IDE task-export format is not what we expected** | M | L | The `bob_sessions/` schema (screenshot + transcript + summary per session) is independent of any Bob-specific format. We can transcribe transcripts manually if needed. Procedure documented in §12.6. |
| R3 | **Solo builder fails to export 30+ Bob sessions over 48h** | M | M | Each block in §12.2 explicitly tags which Bob sessions to export. Sun Block 19 has a final-pass to fill any gaps. Minimum bar for a credible submission is 20 sessions; target is 30. |
| R4 | **Demo target repo migration produces 0 affected files** | M | H | 3 primary + 2 backup demo repos pre-validated (§17). At least one is guaranteed to have ReactDOM.render usage. |
| R5 | **GitHub API rate limit (5k/hr)** | M | M | Cache cloned repos in `/.demo-cache/`. Use PAT, not unauthenticated. Demo path doesn't hit GitHub if cache present. |
| R6 | **Sandbox / test runner takes too long** | M | H | 60s wall clock per test run. Skip slow tests. Cap demo at 3 graded files; rest are patched-only. |
| R7 | **Solo builder burnout, sleep loss** | H | H | Hard sleep windows in §12.2. No commits between 02:00–08:00 Sat. Coffee, food, daylight. |
| R8 | **Vercel deployment fails on Sunday** | L | H | Pin Vercel project to a known good tag the night before. Have Cloudflare Pages as a 30-min fallback. |
| R9 | **Neo4j AuraDB free tier hits node limit (200k)** | L | M | Cap graph at 5k nodes per migration. Migrations only insert files actually touched. |
| R10 | **Upstash Redis free tier exhausted (10k cmd/day)** | M | M | Aggressive batching of pubsub messages. SSE pings every 15s, not 1s. |
| R11 | **node-pty / sandbox doesn't run on Fly** | M | H | Fallback: run tests in a VM2 + child_process on Vercel function (less safe, but works for demo's MIT-licensed code). |
| R12 | **Examiner generates flaky tests** | M | M | Baseline must pass; 2 retries; then Gemini fallback; then skip. Skipped files still patched, just not graded. |
| R13 | **Diff doesn't apply (line-number drift)** | M | M | `parse-diff` validates structure; `simple-git apply --3way` for fuzzy application. |
| R14 | **Submission deadline missed** | L | H | Submit 2.5h early at Sun 18:00. Edit till 20:30 if rules allow. |
| R15 | **Cover image / video missing** | L | H | Both produced Thu (cover) and Sun 13:00–15:00 (video). Calendar reminders. |
| R16 | **Per-agent inference trail too large to embed in PDF** | M | L | Truncate each inference_call to the top 4k chars of prompt + 4k of response in the PDF; full JSON always available via `/api/migrations/[id]/audit`. |
| R17 | **Demo repo authors update repo to React 19 before demo** | L | H | Pin to a specific commit SHA recorded in §17. Migration runs against that SHA, not `main`. |
| R18 | **Audit signature broken** | L | L | Drop signature for demo if it breaks. Marketing artifact only. |
| R19 | **TypeScript build fails during deploy** | M | H | `tsc --noEmit` in pre-commit hook. CI on every push to main. |
| R20 | **Lablab.ai project page form has unexpected fields** | M | L | Open the submit form Thu evening, read every field, draft responses early. |

Risks above the line (R1, R4, R7, R8, R11, R14, R15, R17, R19) get monitored hourly. R2, R3 are de-risked by adapter pattern.

---

## 15. Cost estimates

48-hour build, expected usage:

| Service | Free tier / credit | Expected usage | Paid spillover |
|---|---|---|---|
| Vercel Hobby | 100GB bandwidth, 100h build | < 5GB, < 4h | $0 |
| Neon free | 0.5 GB storage, 191.9 compute-hours | < 100MB, < 3h | $0 |
| Upstash Redis free | 10k cmd/day | ~3k cmd/day | $0 |
| Neo4j AuraDB free | 1 DB, 200k nodes | ~6k nodes | $0 |
| Fly.io free | 3 small VMs | 1 VM | $0 |
| **watsonx.ai Granite-3** | **$80 IBM Cloud credit (auto-applied per PDF page 36)** | See watsonx breakdown below | **$0** |
| Anthropic | pay-as-go | 200k input + 50k output tokens (Surgeon long-context fallback only) | ~$3 |
| IBM Bob IDE | hackathon-issued | Heavy use during 48h build (dev-time only, not metered against IBM Cloud credit) | $0 (provided) |
| GitHub | free | repo + Actions | $0 |
| YouTube | free | unlisted video | $0 |
| Domain | optional | none | $0 |
| **Total** | | | **~$3** |

**watsonx.ai Granite-3 token budget** (per PDF guide page 36: 1,000 tokens = 1 RU at $0.0001 USD = $0.10 per 1M tokens):

| Phase | Token estimate (per migration) | RU | Cost |
|---|---:|---:|---:|
| Cartographer (1 call · ~12k in · ~1k out) | ~13k | 13 | $0.0013 |
| Surgeon scan (1 call · ~16k in · ~3k out) | ~19k | 19 | $0.0019 |
| Surgeon patch (20 files × ~10k in · ~2k out) | ~240k | 240 | $0.024 |
| Examiner (20 files × ~8k in · ~2k out) | ~200k | 200 | $0.020 |
| Auditor synthesis (1 call · ~5k in · ~1k out) | ~6k | 6 | $0.0006 |
| Orchestrator routing (~30 calls × ~1k tokens) | ~30k | 30 | $0.003 |
| **Per migration total** | **~508k** | **~508 RU** | **~$0.05** |

Across the 48-hour build, we expect roughly 40 full migration runs (including dev-time smoke tests and Block 13–25 rehearsals): **~20k RU = ~$2 in Granite spend**. The $80 IBM Cloud hackathon credit covers this with ~$78 of headroom. Anthropic spillover (~$3) is the only out-of-pocket cost.

Out-of-pocket cost for the entire build: roughly $3 in Claude fallback tokens. The watsonx $80 credit fully absorbs Granite usage with substantial margin.

---

## 16. Open questions / decisions deferred

| # | Question | When to resolve | Default if unresolved |
|---|---|---|---|
| Q1 | watsonx Granite-3 8b context window in practice | Wed (test call) | Assume 16k effective; route >14k input to Claude fallback. |
| Q2 | Bob IDE task-export UI / format | First 60 min of event | Manual transcript copy-paste into `bob_sessions/<NN>/transcript.md` + screenshot.png. |
| Q3 | watsonx rate limits per IBM Cloud hackathon account | Block 1 of build SOP | Assume 60 req/min; cache aggressively, batch where possible. |
| Q4 | Can watsonx-served Granite reliably return JSON-schema-constrained output? | Block 1 | If not, post-parse with strict Zod + retry up to 2× with stricter prompt. |
| Q5 | Vercel function limit for SSE on Hobby | Wed | Tested; 5min max per stream. SSE reconnects on client. |
| Q6 | Do we need OAuth or is API key fine | Wed | API key for demo. OAuth is post-hackathon. |
| Q7 | Does ed25519 signature add anything for judging | Sun | Drop if behind. Marketing only. |
| Q8 | Does Granite need explicit `</output>` stop sequences to keep JSON clean? | Block 1 | Yes — every agent prompt ends with `</output>` instruction; stop_sequences set. |
| Q9 | Are concurrency caps polite to watsonx infra | Block 1 | Default to 4 concurrent Granite calls; raise if rate limits allow. |
| Q10 | Java/Python/Tailwind catalogs — needed for demo? | Sat | No. React 18→19 only for demo; Tailwind for the "look — multi-target" claim in audit. |

---

## 17. Pre-picked demo repos

Selection criteria:
- Public, MIT or similar license.
- React 18.x in `package.json`.
- Uses at least 2 known-breaking APIs (ReactDOM.render or useRef-without-arg or act-from-test-utils).
- 500–5000 LoC. Small enough to migrate in <5 min, complex enough to feel real.
- No Next.js abstractions (Next masks ReactDOM details).
- Stable history; recent commits but not under active rewriting.
- Demonstrable test coverage already, even if minimal.

Note: candidate repos below are *examples* of the shape we want. The final picks should be re-validated Fri morning against `react@18.x` in `package.json` and freshness of the commit history. Pin the exact commit SHA in `/.demo-config.ts` before the event.

### 17.1 Primary candidates (React 18 → 19)

| # | Repo (example) | Why it fits | Risks |
|---|---|---|---|
| 1 | `vitejs/vite` examples — `packages/create-vite/template-react-ts` | Tiny (<500 LoC), uses `ReactDOM.createRoot` already, but consumer projects copying this template are on React 18.x. Fork a copy, downgrade to 18.x, then migrate. Controlled and reproducible. | Synthetic-feeling. Mitigate by adding 2 hand-written components that use ReactDOM.render explicitly. |
| 2 | A small open-source React 18 component library (e.g. an older snapshot of `streamich/react-use` examples, or a 1k-LoC starter kit) | Real third-party code, uses hooks heavily, `useRef<T>()` likely without explicit `null`. | License must be MIT-compatible. Verify Fri AM. |
| 3 | A user-owned scratch repo intentionally seeded with React 18 + 7 known breaking patterns. (`thisisaman408/renatus-demo-target-1`) | Fully controlled, guaranteed to migrate cleanly, includes regression tests with strong baseline. | Less "wow" because it's our own repo. Use as Tier 2 fallback. |

Demo-day order of preference: Repo #2 (most authentic) → Repo #1 (most controlled) → Repo #3 (last resort).

Each primary repo has a `/.demo-config.ts` entry:

```ts
export const demoRepos = [
  {
    id: "primary-1",
    url: "https://github.com/...",
    pinnedSha: "a7c91b2…",
    expectedAffectedCount: { min: 8, max: 25 },
    expectedGreen: { min: 6 },
    description: "Real OSS React 18 component lib, 1.4k LoC.",
  },
  // …
];
```

### 17.2 Backup candidates (simpler / smaller)

| # | Repo (example) | Why backup | When to use |
|---|---|---|---|
| B1 | `thisisaman408/renatus-demo-target-min` — 5 files, 200 LoC, explicit ReactDOM.render | Smallest possible end-to-end demo. Will always pass cleanly. | Use if watsonx Granite is misbehaving and we need a guaranteed green run on Claude-only or pre-seeded paths. |
| B2 | A simplified fork of an existing template, trimmed to 8 files | Mid-size fallback. | Use if Primary repo #1 fails Friday-morning dry run. |

All 5 (3 primary + 2 backup) are cloned to `/.demo-cache/` on the builder's laptop on Thu evening and re-cloned Fri morning to capture latest SHAs.

---

## Appendix A — file/folder layout

```
renatus/
├── app/
│   ├── (marketing)/
│   │   └── page.tsx               # landing
│   ├── m/
│   │   ├── new/page.tsx           # wizard
│   │   └── [id]/
│   │       ├── page.tsx           # live view
│   │       ├── graph/page.tsx     # R3F graph
│   │       ├── files/[fid]/page.tsx
│   │       └── audit/page.tsx
│   ├── settings/page.tsx
│   ├── actions/
│   │   ├── migrations.ts
│   │   └── api-keys.ts
│   ├── api/
│   │   ├── migrations/
│   │   │   ├── route.ts
│   │   │   └── [id]/
│   │   │       ├── route.ts
│   │   │       ├── stream/route.ts
│   │   │       ├── audit/route.ts
│   │   │       ├── audit.pdf/route.ts
│   │   │       ├── inference-trail/route.ts
│   │   │       └── graph/route.ts
│   │   └── webhooks/github/route.ts
│   ├── layout.tsx
│   └── globals.css
├── agents/
│   ├── _envelope.ts
│   ├── cartographer/
│   │   ├── index.ts
│   │   ├── prompt.ts
│   │   └── schema.ts
│   ├── surgeon/
│   ├── examiner/
│   └── auditor/
├── catalogs/
│   ├── react-18-to-19.ts
│   ├── python-310-to-312.ts
│   ├── tailwind-3-to-4.ts
│   └── drizzle-0x-to-1.ts
├── db/
│   ├── schema.ts
│   ├── client.ts
│   └── migrations/
├── graph/
│   ├── client.ts                  # Neo4j driver
│   └── queries.ts
├── lib/
│   ├── watsonx.ts                 # watsonx.ai Granite adapter (@ibm-cloud/watsonx-ai)
│   ├── anthropic.ts               # Claude Sonnet 4.6 long-context fallback
│   ├── retrieval.ts               # pgvector embedding + top-k query
│   ├── crypto.ts                  # libsodium + ed25519 signing
│   ├── github.ts                  # @octokit/rest wrapper
│   ├── redis.ts
│   ├── queues.ts                  # BullMQ flow defs
│   └── types.ts
├── workers/
│   ├── cartographer.ts
│   ├── surgeon-scan.ts
│   ├── surgeon-patch.ts
│   ├── examiner.ts
│   └── auditor.ts
├── sandbox/
│   ├── apply-patch.ts
│   ├── run-tests.ts
│   └── fly.toml
├── components/
│   ├── ui/                        # shadcn
│   ├── agent-column.tsx
│   ├── file-card.tsx
│   ├── diff-viewer.tsx
│   ├── graph-3d.tsx
│   ├── audit-report.tsx
│   └── inference-trail.tsx        # per-agent prompt + response + retrieved chunks
├── audit/                         # exported audit artifacts for the recorded demo run
│   ├── audit.json
│   ├── audit.pdf
│   └── README.md
├── bob_sessions/                  # MANDATORY: 30+ Bob IDE task exports for judging
│   ├── README.md
│   ├── plan/
│   ├── code/
│   ├── orchestrator/
│   └── review-commit/
├── .bobignore                     # tells Bob to skip bob_sessions/ during new sessions
├── assets/
│   ├── cover.png
│   ├── deck.pdf
│   └── demo-video.mp4
├── .demo-cache/                   # cloned repos for offline demo
├── .demo-config.ts
├── README.md
├── SYSTEM-DESIGN.md               # this file
├── package.json
├── drizzle.config.ts
├── next.config.ts
├── tailwind.config.ts
├── tsconfig.json
└── LICENSE                        # MIT
```

---

## Appendix B — README outline (for the submission repo)

```
# Renatus
Multi-agent code migration crew built in 48 hours with IBM Bob as the
engineering partner. Runs on watsonx.ai Granite-3.

## What it does (1 paragraph)
Renatus takes a public GitHub repo + a migration target (e.g. react@18 → 19)
and produces (1) a file-by-file patch set, (2) a regression test suite pinned
to the original behavior, (3) a signed audit report with the per-agent
reasoning trail. Four agents — Cartographer, Surgeon, Examiner, Auditor —
coordinated by an in-house LangGraph orchestrator.

## Runtime vs. build-time (read this before judging)
- **Runtime LLM**: watsonx.ai Granite-3 (granite-3.0-8b-instruct for the
  agents; granite-3.0-2b-instruct for orchestrator routing). Anthropic
  Claude Sonnet 4.6 is the fallback only for the Surgeon's longest
  cross-file context windows.
- **Dev partner during the 48h hackathon**: IBM Bob IDE. Every agent in
  this repo was designed and implemented in Bob task sessions. The
  `bob_sessions/` folder at the repo root contains 30+ exported task
  sessions (screenshot + transcript + summary per session) — that's the
  construction evidence.
- Bob does NOT run at runtime. End users of Renatus do not call Bob.

## Demo
   - Video: <youtube>
   - Live: https://renatus.vercel.app
   - Sample audit run: /audit/

## How it works
   - 4 agents diagram (ASCII from SYSTEM-DESIGN.md §5.1)
   - Bob IDE session timeline (SYSTEM-DESIGN.md §5.5)

## Bob usage — see /bob_sessions/
   30+ Bob IDE task session exports across Plan, Code, Orchestrator,
   and /review + /commit modes. See bob_sessions/README.md for the
   index.

## Tech stack
   Next.js 16, watsonx.ai Granite-3 (@ibm-cloud/watsonx-ai), Anthropic
   Claude Sonnet 4.6 (long-context fallback), Drizzle + Neon Postgres
   with pgvector, Neo4j, BullMQ on Upstash Redis, R3F, IBM Bob IDE
   (dev partner only).

## Run it yourself
   - env vars (WATSONX_AI_API_KEY, WATSONX_PROJECT_ID, ANTHROPIC_API_KEY,
     GITHUB_TOKEN, plus DB/queue urls)
   - bun install
   - bun run dev

## Architecture deep-dive
   See SYSTEM-DESIGN.md.

## License
   MIT.
```

---

## Appendix C — submission text (lablab.ai project page draft)

**Tagline (140 chars):**
> Renatus is a four-agent migration crew built in 48 hours with IBM Bob. Runs on watsonx.ai Granite. Bring your codebases back.

**Short description (300 chars):**
> Cross-version migration is the only dev-tools task that requires reasoning over the whole codebase with regression-test pinning and a signed audit. Renatus is the four-agent crew that delivers it. Built end-to-end in 48 hours with IBM Bob as the engineering partner; runs at production on watsonx.ai Granite-3.

**IBM Bob usage section (200 words):**
> Bob is the engineering partner that made building Renatus in 48 hours possible — not a runtime dependency of the shipped product. Every agent (Cartographer, Surgeon, Examiner, Auditor), the LangGraph orchestrator, the pgvector retrieval layer, the Fly.io sandbox, the ed25519 audit signing, the R3F knowledge graph, and the SSE plumbing came out of a Bob IDE task session run during the hackathon build window. The `bob_sessions/` folder in this repo contains 30+ exported sessions across Plan mode (agent contracts), Code mode (implementation), Orchestrator mode (end-to-end demo runs), and `/review` + `/commit`. Each session subfolder ships with a screenshot of Bob's task console, the full transcript, a builder-written summary, and the commit SHA the session produced. That folder is the receipt — open any session and read exactly which structural piece of Renatus Bob built. **At runtime**, Renatus calls watsonx.ai Granite-3 (`granite-3.0-8b-instruct` for the agents; `granite-3.0-2b-instruct` for orchestrator routing), with Claude Sonnet 4.6 as the long-context fallback for the Surgeon. Bob is not deployed. Building this product in 48 hours without Bob would have taken three weeks.

---

## Appendix D — agents/_envelope.ts contract verification

Every agent must:
1. Receive an envelope with `migrationId` and emit one `agent_runs` row on entry, one on exit.
2. Insert an `inference_calls` row with provider + model_id before invoking watsonx or Anthropic, and link its id back to `agent_runs.inferenceCallId`.
3. Validate output against its Zod schema. Failure → `status: "retry"` up to 2× → `status: "fail"`.
4. Emit an `audit_events` row for state transitions visible in the UI.
5. Publish a Redis pubsub message on the `migrations:{id}:events` channel for SSE.

Pseudo-code:

```ts
async function runAgent<I, O>(opts: {
  agentId: string;
  agentKind: AgentKind;
  input: I;
  schema: z.ZodType<O>;
  call: (i: I) => Promise<O>;
  publish: (event: string, data: object) => Promise<void>;
}) {
  const run = await db.insert(agentRuns).values({
    agentId: opts.agentId,
    inputDigest: sha256(JSON.stringify(opts.input)),
    status: "ok",
    startedAt: new Date().toISOString(),
  }).returning();
  await opts.publish("agent.started", { kind: opts.agentKind });
  try {
    const raw = await opts.call(opts.input);
    const parsed = opts.schema.parse(raw);
    await db.update(agentRuns).set({
      completedAt: new Date().toISOString(),
      latencyMs: Date.now() - new Date(run[0].startedAt).getTime(),
      outputDigest: sha256(JSON.stringify(parsed)),
      status: "ok",
      rawOutput: parsed,
    }).where(eq(agentRuns.id, run[0].id));
    await opts.publish("agent.done", { kind: opts.agentKind });
    return parsed;
  } catch (err) {
    await db.update(agentRuns).set({
      completedAt: new Date().toISOString(),
      status: "fail",
      errorMessage: (err as Error).message,
    }).where(eq(agentRuns.id, run[0].id));
    await opts.publish("agent.error", { kind: opts.agentKind, message: (err as Error).message });
    throw err;
  }
}
```

---

## Appendix E — Runtime LLM adapter (lib/watsonx.ts + lib/anthropic.ts)

The two runtime adapters Renatus calls at migration time. Both live behind a single internal `generate()` surface so the agents don't care which provider answered.

```ts
// lib/watsonx.ts
// Adapter over @ibm-cloud/watsonx-ai. All Granite calls flow through here.

import { WatsonXAI } from "@ibm-cloud/watsonx-ai";
import { IamAuthenticator } from "ibm-cloud-sdk-core";

const auth = new IamAuthenticator({ apikey: process.env.WATSONX_AI_API_KEY! });
const client = WatsonXAI.newInstance({
  version: "2024-05-31",
  serviceUrl: process.env.WATSONX_ENDPOINT!,
  authenticator: auth,
});

export type GraniteModel =
  | "ibm/granite-3-8b-instruct"
  | "ibm/granite-3-2b-instruct";

export async function graniteGenerate(opts: {
  modelId: GraniteModel;
  input: string;
  maxNewTokens?: number;
  temperature?: number;
  stopSequences?: string[];
}): Promise<{
  generatedText: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}> {
  const t0 = Date.now();
  const response = await client.generateText({
    modelId: opts.modelId,
    projectId: process.env.WATSONX_PROJECT_ID!,
    input: opts.input,
    parameters: {
      decoding_method: "greedy",
      max_new_tokens: opts.maxNewTokens ?? 4096,
      temperature: opts.temperature ?? 0.2,
      stop_sequences: opts.stopSequences ?? ["</output>"],
    },
  });
  const result = response.result.results[0];
  return {
    generatedText: result.generated_text,
    inputTokens: result.input_token_count,
    outputTokens: result.generated_token_count,
    latencyMs: Date.now() - t0,
  };
}
```

```ts
// lib/anthropic.ts
// Surgeon long-context fallback only. ~14k tokens is the routing threshold.

import Anthropic from "@anthropic-ai/sdk";
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! });

export async function claudeGenerate(opts: {
  input: string;
  maxTokens?: number;
  temperature?: number;
}): Promise<{
  generatedText: string;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
}> {
  const t0 = Date.now();
  const response = await anthropic.messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: opts.maxTokens ?? 4096,
    temperature: opts.temperature ?? 0.1,
    messages: [{ role: "user", content: opts.input }],
  });
  const text = response.content[0].type === "text" ? response.content[0].text : "";
  return {
    generatedText: text,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    latencyMs: Date.now() - t0,
  };
}
```

```ts
// lib/retrieval.ts (sketch)
// pgvector top-k retrieval for whole-codebase reasoning. Lives next to the
// runtime adapters because every agent calls one before generating.

export async function retrieveChunks(opts: {
  namespace: string;          // e.g. `target:${migrationId}` or `upstream:${targetSlug}`
  query: string;
  topK?: number;
}): Promise<Array<{ id: string; path: string; chunk: string; score: number }>> {
  // SELECT id, path, chunk, 1 - (embedding <=> $1) AS score
  //   FROM embeddings WHERE namespace = $2 ORDER BY embedding <=> $1 LIMIT $3
  // ...
}
```

Each agent picks its model up-front. Surgeon's per-file logic routes between Granite and Claude based on estimated input tokens. Every call's prompt, response, and retrieved chunks are inserted into `inference_calls` for the audit trail.

---

## Appendix F — Submission acceptance criteria (final go/no-go)

Before clicking Submit on Sun 17 May at 18:00 IST, all of the following must be true:

- [ ] Repo public on GitHub with MIT license.
- [ ] README has IBM Bob usage section with hyperlink to `/bob_sessions/`.
- [ ] `bob_sessions/` exists at the repo root with ≥30 session subfolders, each containing `screenshot.png`, `transcript.md`, `summary.md`.
- [ ] `bob_sessions/README.md` exists and indexes every session.
- [ ] `/audit/audit.json` exists for the recorded demo run and parses as JSON.
- [ ] `/audit/audit.pdf` exists and opens.
- [ ] Demo URL loads. New migration wizard reachable. A test migration completes against watsonx Granite without erroring.
- [ ] At least one past migration visible with green files.
- [ ] 3-minute video uploaded to YouTube (unlisted) and tested in incognito.
- [ ] 10-slide deck PDF in `/assets/deck.pdf`.
- [ ] Cover image 1920×1080 PNG in `/assets/cover.png`.
- [ ] Lablab.ai project page form filled and previewed.
- [ ] Bob is referenced ≥5 times in the project page text (and the dev-partner-not-runtime framing is consistent throughout).
- [ ] watsonx.ai is referenced ≥3 times in the project page text (sponsor stack alignment).
- [ ] Submission confirmation email or screenshot saved.

If any unchecked box exists at 17:30, the submission is delayed until 19:30. Do not submit a broken state.

---

End of system design.
