# Renatus — Multi-Agent Code Migration Crew

> Codebases die not from age but from version drift. Renatus is the crew that brings them back.

Project: **Renatus** · Event: **IBM Bob Hackathon** · Window: **Fri 15 May 8:30 PM IST → Sun 17 May 8:30 PM IST** · Builder: solo · Stack: Next.js 16 + R3F + Bob SDK.

---

## 1. Product statement

Renatus is a single-page web app that takes a public GitHub repository URL and a migration target (e.g. `react@18 → react@19`), and produces:

1. A complete, reviewable, file-by-file migration patch set.
2. A regression test suite generated from the *original* behavior.
3. A signed audit report containing the IBM Bob session log proving how each change was reasoned.

The product is operated by a crew of **four specialist AI agents** orchestrated by IBM Bob:

| Agent | Role | Output artifact |
|---|---|---|
| **Cartographer** | Reads the *upstream* release notes / changelog / breaking-change docs. Produces a structured map of every API surface that changed. | `breaking_changes.json` |
| **Surgeon** | Reads *your* repository via Bob's whole-repo context. Locates every callsite, import, JSX use, hook use, type reference, or pattern that intersects a breaking change. Generates patches. | `patches.diff` |
| **Examiner** | Generates regression tests that pin original behavior of every touched module. Runs them against the original code to confirm green-baseline. | `tests/*.spec.ts` + `baseline.json` |
| **Auditor** | Runs migrated code against Examiner's tests in a sandbox. Diff-classifies every deviation. Exports signed audit report including Bob session log. | `audit.json` + `audit.pdf` |

The product's only reason to exist is that **Bob can read the whole repo**. Diff-only PR review tools cannot do cross-version migration because the breaking change at file A may only be detectable from how file B and file C *use* the symbol exported by A. Renatus is the proof case that Bob's whole-repo context is the unique enabler.

Renatus does not replace a senior engineer. It produces a migration draft that a senior engineer can verify in 30 minutes instead of authoring in 2 weeks. Every patch carries a `bob_session_id` so the engineer can replay the reasoning.

Demo target: live React 18 → 19 migration of a real OSS repo on stage, in under 5 minutes, with regression tests turning green at the end.

---

## 2. Why this wins

### 2.1 Direct competitor analysis (PR review, docs, onboarding)

The IBM Bob field has 282 teams with specific pitches. 35 are explicitly in "developer tools." Their pitches cluster into four lanes:

| Lane | Sample competitors | What they do | Gap |
|---|---|---|---|
| PR review / merge gate | PRism Labs, ShieldOps (BobMerge Shield), DevPilot AI, Eclipse Lab, CodeSheriff | Score a diff. Comment on a PR. Maybe block merge. | They only see the diff hunk. Bob's whole-repo superpower is wasted. |
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

### 2.3 Bob's superpower mapping (whole-repo context = migrations)

Bob's description: *AI-powered development partner, reads complete repository context, explains logic with clarity, automates complex transformations, streamlines multi-step work.*

Map each phrase to a Renatus moving part:

| Bob capability | Renatus use |
|---|---|
| reads complete repository context | Surgeon walks the entire tree to find affected files. PR-review tools cannot — they see a diff. |
| explains logic with clarity | Every patch carries a Bob-generated rationale embedded in the audit report. |
| automates complex transformations | The patches themselves. Bob is the transformation engine; Renatus is the orchestrator. |
| streamlines multi-step work | The 4-agent pipeline. Each agent is a Bob session with a narrow role. |

PR-review tools need *one* hunk. Documentation tools need *one* file. Migration is the **only** dev-tools use case where reading every file is structurally required. Renatus is the maximally Bob-aligned product in the dev-tools lane.

### 2.4 Judging criteria mapping

The submission rubric (inferred from "meaningful use of Bob may be disqualified" and the standard lablab.ai rubric):

| Criterion | Score path |
|---|---|
| Meaningful use of Bob | 4 Bob sessions per run, each tracked, exported in audit report. Bob is **runtime infrastructure**, not just dev-time. |
| Technical depth | 4 agents, BullMQ queue, Neo4j graph, sandbox execution, Drizzle schema, Zod-typed I/O. |
| Innovation | Multi-agent migration crew. Zero teams in this lane. |
| Business value | F500 framework migrations cost $500K–$5M in consultants. Auditable migration is the unlock. |
| Demo quality | Live React 18 → 19 migration on a real public repo, tests turning green. |
| Polish | Dark Stripe-Docs × GitHub aesthetic, R3F knowledge graph, side-by-side diff viewer, embedded Bob session log. |
| Documentation | README + system design + Bob report exported as artifact in repo. |

---

## 3. Prize eligibility & submission checklist

Prize pool: $10K (1st $5K, 2nd $3K, 3rd $2K). All three are realistically reachable from this scope. Target: 1st.

### 3.1 Mandatory: meaningful use of Bob

> *"All submissions must clearly demonstrate how IBM Bob is used in the solution. Projects that do not show meaningful use of Bob may be disqualified."*

Renatus uses Bob at five distinct points:

| # | Where | What Bob does | Why it's meaningful |
|---:|---|---|---|
| 1 | Cartographer agent | Reads the *upstream framework's* changelog repo (e.g. `facebook/react` `CHANGELOG.md` + RFC repo + breaking-change docs). | Whole-repo reading of a foreign repo. |
| 2 | Surgeon agent | Reads the *target user's* repo. Identifies every file affected by every breaking change. | Whole-repo reading is the entire reason this works. |
| 3 | Surgeon agent (per file) | Generates the migration patch with rationale tied to one or more breaking changes. | Complex transformation. |
| 4 | Examiner agent (per file) | Generates regression tests informed by repo-wide call patterns of the symbol under test. | Bob sees how the symbol is used elsewhere. |
| 5 | Auditor agent | Synthesizes the final report. Reads Bob's own session log via the SDK to embed reasoning. | Bob's session memory becomes part of the audit chain. |

Each Bob call is logged with `bob_session_id`, `task_id`, `input_hash`, `output_hash`, `latency_ms`, `tool_calls[]`. Stored in the `bob_sessions` table. Exported in the audit PDF and as JSON.

### 3.2 Mandatory: exported Bob report in repo

The submission GitHub repo includes:

- `/audit/bob-session-export.json` — machine-readable export of every Bob session run during the demo.
- `/audit/bob-session-export.pdf` — human-readable PDF version with screenshots of Bob's task console.
- `/audit/README.md` — explains how the export was produced (procedure in §12.6).

Until Bob's actual export tool is documented at event kickoff, this section's exact procedure is a **known unknown** (§16). The system is designed to accept whatever export format Bob ships.

### 3.3 Lablab.ai submission requirements

Confirmed required artifacts:

| Artifact | Where | Status path |
|---|---|---|
| Public GitHub repo | `github.com/thisisaman408/renatus` (MIT license) | scaffold Wed–Thu, freeze Sun 5 PM IST |
| Exported Bob report | `/audit/*` in repo | produced during final live run Sun afternoon |
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
2. **Cartographer agent**: ingests breaking changes for at least React 18 → 19. (Pre-seeded JSON if Bob upstream call fails — see §14 R5.)
3. **Surgeon agent**: reads target repo via Bob, emits patches as unified diffs with rationale.
4. **Examiner agent**: generates Vitest specs for at least 3 affected files.
5. **Auditor agent**: runs Examiner specs against `pre/` and `post/` versions of each file, emits `audit.json`.
6. **Live work view**: 4 columns, one per agent, streaming progress via SSE. Cards bounce in as files move through stages.
7. **File-by-file diff viewer**: side-by-side with `react-diff-view`.
8. **Audit report viewer**: web view with embedded Bob session log per file.
9. **Bob report export**: button that produces `bob-session-export.json` and offers PDF download.
10. **Past migrations list**: minimal table showing prior runs.
11. **Settings**: paste Bob API key + GitHub token + (optional) Anthropic key.
12. **Deploy on Vercel**, MIT license, public repo.

Acceptance criterion for P0: can run `react@18 → 19` on one of the three pre-picked demo repos end-to-end in under 5 minutes on a warm cache. Audit shows ≥1 file with green regression tests post-migration.

### 4.2 P1 — Differentiators

1. **3D Codebase Knowledge Graph** (R3F + react-force-graph): nodes = files, edges = imports, highlight = files touched by current migration.
2. **Parallel agent execution**: BullMQ workers run Surgeon and Examiner across files concurrently, capped at 4 workers.
3. **Second migration target wired**: Tailwind 3 → 4 catalog populated. Demo backup.
4. **PDF audit export**: pretty PDF via `@react-pdf/renderer`.
5. **Bob session log embed**: collapsible per-file panel showing Bob's reasoning steps.
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
│   /api/migrations/[id]/audit    /api/migrations/[id]/export-bob               │
│                                                                               │
│   server actions: startMigration, cancelMigration, retryFile                  │
└─────┬─────────────────────┬─────────────────────┬───────────────────┬────────┘
      │                     │                     │                   │
      ▼                     ▼                     ▼                   ▼
┌─────────────┐      ┌──────────────┐     ┌──────────────┐    ┌────────────────┐
│ Neon        │      │ Upstash      │     │ Neo4j        │    │ IBM Bob API    │
│ Postgres    │      │ Redis +      │     │ AuraDB       │    │ (orchestrator  │
│ (Drizzle)   │      │ BullMQ       │     │ (Graph)      │    │ + per-agent)   │
│             │      │              │     │              │    │                │
│ migrations  │      │ queues:      │     │ File, Symbol │    │ + Claude       │
│ agents      │      │ - cartog     │     │ Module, Test │    │ Sonnet 4.6     │
│ files       │      │ - surgeon    │     │ BreakingCh.  │    │ fallback       │
│ patches     │      │ - examiner   │     │              │    │ + Gemini Flash │
│ tests       │      │ - auditor    │     │ IMPORTS      │    │ for Examiner   │
│ audit_evt   │      │              │     │ DEFINES      │    └────────────────┘
│ bob_sess    │      │              │     │ TESTS        │
│ repos       │      │              │     │ AFFECTS      │
│ users       │      │              │     │              │
│ api_keys    │      │              │     │              │
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
                  │                     │
                  │ sandbox: node-pty   │
                  │ inside isolated     │
                  │ tmpfs               │
                  └─────────────────────┘
```

### 5.2 Component breakdown

| Layer | Component | Tech | Responsibility |
|---|---|---|---|
| UI | App shell | Next 16 App Router | Routing, server components, layouts |
| UI | New migration | Server action + form | Validate inputs, create migration row, enqueue Cartographer job |
| UI | Live view | RSC + Client + EventSource | Render 4-column board, subscribe to SSE per migration |
| UI | Graph | R3F + react-force-graph-3d | Render codebase as 3D force graph, animate `AFFECTS` edges |
| UI | Diff viewer | react-diff-view | Side-by-side unified diff per file |
| UI | Audit | Server component | Stream `audit.json` + embed Bob session log |
| API | Route handlers | Next 16 Route Handlers | REST surface |
| API | SSE | Native ReadableStream | Push agent state changes to client |
| Orchestration | Job queue | BullMQ on Upstash Redis | Parallel agent execution, retries, backoff |
| Worker | Cartographer | Node worker | Bob session reading upstream changelog repo |
| Worker | Surgeon | Node worker | Bob session reading target repo, emitting patches |
| Worker | Examiner | Node worker | Bob session generating tests, Gemini Flash fallback |
| Worker | Auditor | Node worker | Spawn sandbox, run tests, classify, emit audit |
| Sandbox | Test runner | node-pty in tmpfs, network-off | Run Vitest against pre/ and post/ versions |
| Data | Postgres | Neon | Source of truth for migration state |
| Data | Redis | Upstash | Queue + ephemeral pubsub for SSE |
| Data | Neo4j | AuraDB | Code knowledge graph, queried for impact analysis and visualization |
| External | IBM Bob | API/SDK | Whole-repo reading + transformations |
| External | GitHub | Octokit | Clone target repo into worker tmpfs |
| External | Anthropic | Claude Sonnet 4.6 | Fallback when Bob rate-limits |
| External | Google | Gemini Flash | Examiner fallback / cheap test generation |
| Infra | Hosting | Vercel | Next.js app + cron + edge |
| Infra | Long-running workers | Fly.io machine | BullMQ workers that exceed Vercel function limits |

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
 │                      │                                      │                  ├── Bob.session(upstream-repo)
 │                      │                                      │                  │   read CHANGELOG.md, RFCs
 │                      │                                      │                  │   emit breaking_changes.json
 │                      │                                      │                  ├── INSERT breaking_changes
 │                      │                                      │                  ├── enqueue clone job
 │  EventSource subscribe ───→ stream agent state
 │                                                                                                     ├── Octokit clone target repo to tmpfs
 │                                                                                                     ├── Bob.session(target-repo)
 │                                                                                                     │   for each breaking change:
 │                                                                                                     │     find affected files
 │                                                                                                     │   write affected files to `files` table
 │                                                                                                     │                                                       ├── upsert File nodes + IMPORTS edges
 │                                                                                                     │                                                       ├── upsert AFFECTS edges (BreakingChange → File)
 │                                                                                                     ├── for each affected file (concurrency 4):
 │                                                                                                     │     Bob.patch(file, breaking_change_ids)
 │                                                                                                     │     INSERT patches row
 │                                                                                                     │     enqueue examiner job for that file
 │                                                                                                                          ├── Bob.tests(file, original_source, repo_context)
 │                                                                                                                          │   emit *.spec.ts
 │                                                                                                                          ├── INSERT tests row, mark file ready_for_audit
 │                                                                                                                          ├── enqueue auditor job
 │                                                                                                                                                ├── sandbox: write pre/ tree, apply patch to post/ tree
 │                                                                                                                                                ├── run Vitest in pre/
 │                                                                                                                                                ├── run Vitest in post/
 │                                                                                                                                                ├── classify deviations
 │                                                                                                                                                ├── INSERT test_runs + audit_events
 │                                                                                                                                                ├── when all files done: emit audit.json + audit.pdf
 │  ←─── SSE: migration.completed
 │
 ├── GET /api/migrations/[id]/export-bob ───→ aggregate bob_sessions → bob-session-export.json
```

### 5.4 Sequence: single file migration lifecycle

```
file row (status=detected)
   │
   ├─ Surgeon worker picks up
   │     └─ Bob session: surgeon-{migrationId}
   │         tool: read_file(path)
   │         tool: read_related_imports(path)
   │         tool: search_symbol_usage(symbol)
   │         → generate unified diff
   │     └─ INSERT patches { file_id, diff, rationale, bob_session_id }
   │
   ├─ status=patched
   │
   ├─ Examiner worker picks up
   │     └─ Bob session: examiner-{migrationId}-{fileId}
   │         tool: read_file(path)
   │         tool: search_symbol_usage(symbol)
   │         tool: read_existing_tests(path)
   │         → generate Vitest spec
   │     └─ INSERT tests { file_id, source, bob_session_id }
   │     └─ Run spec against ORIGINAL source in sandbox (baseline must pass)
   │           if baseline fails: mark test as `unsuitable`, regenerate up to 2×, then fallback to Gemini Flash
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

### 5.5 Bob session topology (which Bob session does what)

| Session ID pattern | Owner | Lifespan | Repo context | Approximate tokens |
|---|---|---|---|---|
| `bob:cartographer:{migrationId}` | Cartographer | One per migration | Upstream framework repo (e.g. `facebook/react`) | 30k–80k |
| `bob:surgeon:scan:{migrationId}` | Surgeon (scan phase) | One per migration | Target repo | 60k–200k |
| `bob:surgeon:patch:{migrationId}:{fileId}` | Surgeon (patch phase) | One per file | Target repo (cached) | 8k–25k |
| `bob:examiner:{migrationId}:{fileId}` | Examiner | One per file | Target repo (cached) | 8k–25k |
| `bob:auditor:{migrationId}` | Auditor | One per migration | Audit synthesizer; no repo | 12k–30k |

For a 20-file React 18 → 19 migration: roughly 42 Bob sessions, ~1.2M cumulative tokens. Budget assumes Bob's hackathon credits allow this; §14 R1 documents fallback.

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
| Postgres | Neon (free tier) | Serverless HTTP, fits Vercel |
| Graph DB | Neo4j AuraDB (free tier) | 1 instance, 200k nodes, enough for demo |
| Queue | BullMQ on Upstash Redis (free tier) | 10k commands/day plenty |
| Bob | IBM Bob SDK/API | Mandatory |
| LLM fallback | Anthropic Claude Sonnet 4.6 | If Bob rate-limits |
| LLM cheap | Gemini Flash | Examiner fallback (test generation is cheaper) |
| GitHub | Octokit + `simple-git` | Clone target repo |
| Sandbox | node-pty + tmpfs + network-namespace | Run untrusted code |
| PDF | @react-pdf/renderer | Audit PDF |
| Auth | none (single-user demo) | Speed |
| Hosting | Vercel | Next.js native |
| Long-running | Fly.io 1× shared-cpu-1x machine | BullMQ workers |
| Telemetry | Sentry free + console | Capture failures during demo |
| Package manager | bun | Faster local dev |

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
  provider: varchar("provider", { length: 32 }).notNull(), // bob | anthropic | google | github
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
  bobSessionId: uuid("bob_session_id"),
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
  bobSessionId: uuid("bob_session_id"),
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
  byBobSession: index("agent_runs_bob_session_idx").on(t.bobSessionId),
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
  bobSessionId: uuid("bob_session_id"),
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
  bobSessionId: uuid("bob_session_id"),
  generatorModel: varchar("generator_model", { length: 48 }).notNull(), // bob | claude-sonnet-4.6 | gemini-flash
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

export const bobSessions = pgTable("bob_sessions", {
  id: uuid("id").primaryKey().defaultRandom(),
  migrationId: uuid("migration_id").references(() => migrations.id, { onDelete: "cascade" }),
  bobSessionRef: text("bob_session_ref").notNull(), // Bob's own session identifier
  agentKind: agentKindEnum("agent_kind").notNull(),
  purpose: text("purpose").notNull(),
  inputTokens: integer("input_tokens"),
  outputTokens: integer("output_tokens"),
  toolCallCount: integer("tool_call_count"),
  startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
  completedAt: timestamp("completed_at", { withTimezone: true }),
  // The raw export blob from Bob, used in the audit PDF
  exportPayload: jsonb("export_payload"),
}, (t) => ({
  byMigration: index("bob_sessions_migration_idx").on(t.migrationId),
  byRef: uniqueIndex("bob_sessions_ref_idx").on(t.bobSessionRef),
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
- `bobSessions.exportPayload` is the blob Bob's export API returns. Schema TBD until kickoff.
- All `bob_session_id` columns are nullable so the system stays usable if Bob is unreachable and Claude fallback runs.

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
| `bob_sessions` | unique | `bob_session_ref` | dedupe Bob refs |
| `bob_sessions` | btree | `migration_id` | export aggregation |
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
  bobSessionRef: z.string().optional(),
  startedAt: z.string().datetime(),
  completedAt: z.string().datetime().optional(),
  status: z.enum(["ok", "retry", "fail"]),
  payload: z.unknown(),
});
export type AgentEnvelope<T> = z.infer<typeof AgentEnvelope> & { payload: T };
```

### 8.1 Orchestrator

- **Role**: state machine that walks migrations through `queued → cartography → scanning → patching → testing → auditing → completed`. Not an LLM agent — a plain Node module. Owns BullMQ flow definitions.
- **LLM/Bob calls**: none directly.
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

- **Role**: read the upstream framework's repo via Bob, produce a structured `breaking_changes.json` for the target.
- **LLM/Bob calls**: one Bob session per migration target (cached across migrations).
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

Bob integration:

```ts
const session = await bob.openSession({
  ref: `bob:cartographer:${migrationId}`,
  repos: [target.upstreamRepoUrl],
});
await session.readPaths(target.changelogPaths);
const raw = await session.complete({ system: prompt, expectedSchema: CartographerOutput });
```

Constraints:

- No invented breaking changes. Schema-validate output; on parse failure, retry up to 2× with stricter prompt.
- Cache result per `targetSlug`. Subsequent migrations skip Cartographer.

Failure modes + fallbacks:

| Failure | Fallback |
|---|---|
| Bob session refuses upstream repo (rate limit / quota) | Pre-seeded catalog file (`catalogs/react-18-to-19.ts` above) is shipped in the repo. Cartographer falls back to it. |
| Bob returns malformed JSON | 2 retries with `gemini-2.0-flash` and a stricter prompt. |
| Both fail | Mark migration `failed` with reason `cartography_unavailable` and surface in UI. |

### 8.3 Surgeon

- **Role**: read target repo via Bob, identify affected files, generate patches.
- Two phases:
  1. **Scan** (one Bob session per migration): walk repo, classify which files match which breaking changes.
  2. **Patch** (one Bob session per affected file): emit unified diff + rationale.
- **LLM/Bob calls**: 1 scan + N patch sessions where N = affected file count (cap 30 for demo).

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

Use Bob's whole-repo reading. Look at imports, JSX, hook usage, call sites,
type references. A file is affected if it USES a changed API anywhere, not
just if it imports it. Cross-check usage sites via repo-wide search.

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

Constraints:

- Diff must be valid unified format (`---`/`+++`/`@@` markers).
- We re-parse with `parse-diff` and reject malformed.
- Cap patch context to ±5 lines around hunks.
- Skip files >2000 LoC (out of scope for demo).

Failure modes + fallbacks:

| Failure | Fallback |
|---|---|
| Scan returns 0 affected files | Surface as "no migration needed" to user (rare on demo repos). |
| Patch session timeout (>60s) | Retry once; then fallback to Claude Sonnet 4.6 with same prompt. |
| Diff doesn't apply cleanly to original | Mark file `error`, exclude from audit, show in UI with raw diff. |
| Bob rate-limit mid-run | Backoff with jitter; secondary failure → switch worker pool to Claude. |

### 8.4 Examiner

- **Role**: generate regression tests informed by repo-wide call patterns. Run them against ORIGINAL code (baseline) before declaring tests valid.
- **LLM/Bob calls**: 1 per file. For demo we cap at 5 files tested. Other files still get patched, just not green/red graded.

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

Constraints:

- Spec must declare its own deps; we install Vitest + RTL into the sandbox.
- If baseline run is red, regenerate twice with stricter prompt. Then fall back to Gemini Flash with a simpler "smoke test only" prompt that just verifies the module imports cleanly and a few obvious assertions hold.
- Skip tests entirely (mark file `tested` with `baselineOk=false` and `generatorModel=skipped`) if both retries fail. The patch is still applied; we just don't grade it green/red.

Failure modes + fallbacks:

| Failure | Fallback |
|---|---|
| Baseline test fails | Retry up to 2× with adjusted prompt → Gemini Flash smoke test → skip. |
| Vitest dependency conflict in repo | Use `--isolate` mode and a separate `package.json` in `/tests-renatus`. |
| Test takes >30s | Kill and mark skipped. |

### 8.5 Auditor

- **Role**: apply patch in sandbox, run tests against post-migration source, classify deviations, emit signed audit report.
- **LLM/Bob calls**: 1 Bob session at the end to synthesize a human-readable summary.

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
  bobReasoningRef: z.string().optional(),
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
  bobSessions: z.array(z.object({
    ref: z.string(),
    agentKind: z.string(),
    purpose: z.string(),
    inputTokens: z.number().nullable(),
    outputTokens: z.number().nullable(),
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
| Bob synthesis fails | Build summary deterministically from totals; mark `auditor.synthesizedBy=template`. |
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
  provider: "bob" | "anthropic" | "google" | "github";
  value: string;
  label?: string;
}): Promise<{ id: string }> { /* ... */ }
```

### 9.2 Route handlers

```
POST   /api/migrations                    -> { migrationId }
GET    /api/migrations/[id]               -> Migration (full state)
GET    /api/migrations/[id]/files         -> FileRow[]
GET    /api/migrations/[id]/files/[fid]   -> FileDetail (patch+tests+runs)
GET    /api/migrations/[id]/audit         -> AuditorOutput
GET    /api/migrations/[id]/audit.pdf     -> binary PDF
GET    /api/migrations/[id]/export-bob    -> bob-session-export.json
POST   /api/migrations/[id]/cancel        -> 204
GET    /api/migrations/[id]/graph         -> { nodes, links } (Neo4j projection)
GET    /api/migrations/[id]/stream        -> text/event-stream (SSE)
POST   /api/webhooks/github               -> 204 (optional, P2)
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
| Rationale (Bob)                                                   |
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
|     [ open diff ]   [ Bob reasoning ]   [ retry ]                 |
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
|  src/main.tsx              green   ⤓ patch  ⤓ tests  ⤓ bob log    |
|  src/Layout.tsx            green   ⤓ patch  ⤓ tests  ⤓ bob log    |
|  …                                                                 |
|  src/hooks/useFetch.tsx    red     ⤓ patch  ⤓ tests  ⤓ bob log    |
+-------------------------------------------------------------------+
| Bob sessions (42)                                                 |
|  bob:cartographer:m-… · react@18→19 · 12.4k tokens · 38 tools     |
|  bob:surgeon:scan:m-…  · target repo · 87.1k tokens · 142 tools   |
|  …                                                                 |
+-------------------------------------------------------------------+
| Export                                                            |
| [ download bob-session-export.json ]  [ download audit.pdf ]      |
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
| IBM Bob       [ ●●●●●●●●●●●●●●●●●● ]   added 12:04 PM   [ rotate ]|
| Anthropic     [ ●●●●●●●●●●●●●●●●●● ]   added Wed         [ rotate ]|
| Google AI     [ paste key… ]                              [ save ] |
| GitHub PAT    [ ●●●●●●●●●●●●●●●●●● ]   scope: repo        [ rotate ]|
+-------------------------------------------------------------------+
| Keys are encrypted at rest with libsodium secretbox. Nonce stored |
| separately.                                                       |
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
| IBM Bob | hackathon-issued | Mandatory orchestrator + agents | provided at event kickoff |
| Neo4j AuraDB | Free | Knowledge graph | 5 min |
| Neon | Free | Postgres | 3 min |
| Upstash Redis | Free | BullMQ | 3 min |
| Vercel | Hobby | Hosting | 2 min |
| GitHub | existing | Repo + Octokit token | n/a |
| Fly.io | Free | Long-running BullMQ workers (Vercel limit) | 5 min |
| Anthropic | pay-as-go | Claude Sonnet 4.6 fallback | 5 min |
| Google AI Studio | Free | Gemini Flash fallback | 5 min |
| Sentry | Developer | Error tracking | 3 min |
| Resend (optional) | Free | Email on migration complete | 3 min |
| Lablab.ai | existing | Submission | n/a (registered Wed) |

All accounts should be live and tested by **Thu 14 May EOD**.

### 11.2 API keys & secrets management

`.env.local` template:

```
# database
DATABASE_URL=postgresql://...neon.tech/renatus
NEO4J_URI=neo4j+s://....neo4j.io
NEO4J_USER=neo4j
NEO4J_PASS=...

# queue
REDIS_URL=rediss://default:...@...upstash.io:6379

# AI providers
IBM_BOB_API_KEY=...
IBM_BOB_BASE_URL=https://...
ANTHROPIC_API_KEY=sk-ant-...
GOOGLE_GENERATIVE_AI_API_KEY=...

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
| Wed 13 May AM | Read all hackathon rules. Verify submission format on lablab.ai page. | Notes file written. |
| Wed 13 May AM | **Register on lablab.ai for IBM Bob hackathon BEFORE Fri 1 PM CET cutoff.** | Confirmation email received. |
| Wed PM | Create accounts: Neon, Upstash, Neo4j AuraDB, Vercel, Fly.io, Anthropic, Google AI Studio. | Each dashboard accessible. |
| Wed PM | Reserve `renatus.vercel.app` subdomain. | Vercel project exists. |
| Wed PM | Scaffold Next.js 16 app, install shadcn, Tailwind v4, Drizzle, BullMQ, R3F. Commit. | `bun run dev` shows the empty shell. |
| Thu 14 May | Write `db/schema.ts` (full), `bun run db:push`. | Tables exist in Neon. |
| Thu 14 May | Pre-seed `breaking_changes` for react@18→19 from the catalog above. | Row count ≥ 13. |
| Thu 14 May | Stub the 4 agents as no-op Node modules with Zod schemas in place. | `bun test` green. |
| Thu 14 May | Build skeleton 4-column live view with mocked SSE. | Demo URL shows 4 columns. |
| Thu 14 May | Write the system design doc (this file). | File committed. |
| Thu EOD | Cover image, slide deck draft 1 (10 slides). | PDFs in `/assets`. |
| Fri 15 May 7:00 AM ET (registration cutoff) | Verify registration confirmation. | Email present in inbox. |
| Fri 15 May AM | Pre-pick demo target repos (§17). Clone each and dry-run `git clone` from worker tmpfs. | 3 repos validated. |
| Fri 15 May 7:30 PM IST | Final pre-flight: env vars set in Vercel, deploy a "Hello Renatus" page. | URL loads. |
| Fri 15 May 8:30 PM IST | **Hackathon starts. Bob credentials become available.** | Bob API ping returns 200. |

### 12.2 48-hour build SOP

Times in IST (UTC+5:30). Sleep target: 6h Sat overnight (Sat 2 AM – Sat 8 AM) + 2h power nap Sun afternoon.

| Block | Time (IST) | Focus | Acceptance criterion |
|---|---|---|---|
| 1 | Fri 20:30 – 22:30 | Kickoff. Read Bob's published guide. Wire up Bob SDK with a hello-world `session.complete()`. Confirm Bob can read a public GitHub repo. | Bob returns text from `facebook/react` CHANGELOG. |
| 2 | Fri 22:30 – 00:30 | Cartographer agent end-to-end. Bob reads upstream changelog, returns parsed `BreakingChange[]`. Persist to DB. | `breaking_changes` rows populated for react@18→19. |
| 3 | Sat 00:30 – 02:00 | Surgeon scan phase. Bob reads target repo, returns affected files. Persist to `files`. Neo4j `AFFECTS` edges. | Scan returns 10–30 files for demo repo. |
| **SLEEP** | Sat 02:00 – 08:00 | Sleep. Non-negotiable. | Alive. |
| 4 | Sat 08:00 – 10:00 | Surgeon patch phase. Bob emits unified diff per file. Persist to `patches`. | 3+ patches in DB; one applies cleanly to original. |
| 5 | Sat 10:00 – 12:00 | Examiner agent. Bob generates Vitest spec per file. Baseline run on original code. | At least 3 specs green on baseline. |
| 6 | Sat 12:00 – 13:00 | Lunch + standup with self. Review demo plan. Trim P1 features that drift. | Burndown updated. |
| 7 | Sat 13:00 – 15:00 | Auditor agent + Fly.io sandbox. Apply patch, run tests against post-migration source, classify green/red. | One file goes green end-to-end. |
| 8 | Sat 15:00 – 17:00 | SSE stream wiring. 4-column live view animates. Cards bounce between columns. | Demo URL shows live agent activity. |
| 9 | Sat 17:00 – 19:00 | Diff viewer + audit report viewer. react-diff-view integrated. Audit page shows totals + file list. | End-to-end works on one demo repo. |
| 10 | Sat 19:00 – 21:00 | 3D codebase knowledge graph (R3F + react-force-graph-3d). Nodes from Neo4j query. AFFECTS edges animated. | Graph renders ≥50 nodes from real data. |
| 11 | Sat 21:00 – 23:00 | Bob report export. Aggregate `bob_sessions` table into `bob-session-export.json`. PDF render. | Endpoint returns file. |
| 12 | Sat 23:00 – 00:30 | Polish pass 1: typography, spacing, dark theme, focus rings, skeleton shimmers. | UI screenshot looks like Stripe Docs × GitHub. |
| **SLEEP** | Sun 00:30 – 06:30 | Sleep. Non-negotiable. | Alive. |
| 13 | Sun 06:30 – 08:30 | Disaster recovery: run end-to-end on **all 3 primary demo repos**. Note failures. | At least 2 of 3 work cleanly. |
| 14 | Sun 08:30 – 10:30 | Fix the most likely demo failure. Add fallback paths (mock Bob if rate-limited). | Hardcoded fallback for cartography ready. |
| 15 | Sun 10:30 – 12:00 | Past migrations list, settings, key management. Audit signature. | Settings screen functional. |
| 16 | Sun 12:00 – 13:00 | Lunch. Practice the 3-minute pitch out loud. Time it. | Pitch ≤ 3:05. |
| 17 | Sun 13:00 – 15:00 | Record the 3-minute demo video. Loom + OBS. Two takes. Pick best. | MP4 uploaded to YouTube unlisted. |
| 18 | Sun 15:00 – 16:00 | Slide deck final pass (10 slides). PDF export. Cover image v2. | `/assets/deck.pdf` committed. |
| 19 | Sun 16:00 – 17:30 | Run final end-to-end. Export Bob report. Commit `/audit/*` to repo. Update README. | Repo green on CI. |
| 20 | Sun 17:30 – 18:00 | Submit on lablab.ai. Demo URL pinned to a tag. | Submission confirmation email. |
| 21 | Sun 18:00 – 20:30 | Buffer. Watch for any submission edits required. Re-record video if needed. | Nothing on fire. |

If by Block 7 the end-to-end isn't working, cut: 3D graph (P1), PDF audit (P1), signed audit (P2), retry-file UI (P1).

### 12.3 Pre-demo checklist

Run 30 minutes before recording the video:

- [ ] Vercel deploy green on latest commit.
- [ ] `IBM_BOB_API_KEY` rotated and saved in Vercel + local.
- [ ] `GITHUB_TOKEN` has `repo` + `read:user` scopes.
- [ ] Demo repo (#1) cloneable, target branch confirmed.
- [ ] Browser cache cleared. Window in 16:9, 1920×1080.
- [ ] Background services running (Fly worker machine awake).
- [ ] Audio: mic level checked.
- [ ] Slides queued.
- [ ] Notes file open in second monitor with cue lines.
- [ ] Bob report export tested ≥1 time today.

### 12.4 Submission procedure

1. Tag commit: `git tag -a v1.0.0-submission -m "Renatus submission"; git push --tags`.
2. Set Vercel production deployment to that tag.
3. Verify `/audit/bob-session-export.json` and `/audit/bob-session-export.pdf` exist in repo `main`.
4. Upload demo video to YouTube (unlisted) and Loom. Note both URLs.
5. Upload slide deck PDF to a public Drive folder. Note URL.
6. Cover image: PNG 1920×1080 uploaded to lablab.ai project page.
7. Fill lablab.ai project page:
   - Project name: **Renatus**
   - Tagline: *Multi-agent migration crew that ships safe cross-version upgrades.*
   - Description: 800 words pulling from §1, §2.
   - GitHub URL: `https://github.com/thisisaman408/renatus`
   - Demo URL: `https://renatus.vercel.app`
   - Video URL: YouTube unlisted.
   - Tech stack: Next.js, IBM Bob, Neo4j, Postgres, Redis, R3F, TypeScript.
   - **IBM Bob usage explanation**: dedicated section, 200 words, link directly to `/audit/bob-session-export.json`.
8. Click Submit. Screenshot the confirmation. Save to `/submission-evidence/`.

### 12.5 Demo failure recovery

Tiered fallback for the live video:

| Failure | Detection signal | Recovery |
|---|---|---|
| Bob API rate-limit during recording | 429 response | Switch to pre-recorded backup video (recorded in Block 19) of a known-good run. |
| Octokit clone fails | non-200 | Switch to local-cached copy of demo repo (stored in `/.demo-cache/`). |
| Sandbox times out on tests | 60s timeout | Skip Auditor, show pre-computed audit from `/.demo-cache/audit.json`. |
| Graph crashes | React error boundary | Hide graph panel, swap for static screenshot. |
| Entire app down | health check fails | Use pre-recorded video. Submission has the URL anyway. |

Pre-recorded backup video (recorded Sun 13:00–15:00) is the safety net. Live video is the *ideal*, not the *only*, deliverable.

### 12.6 How to export the Bob report

> **Known unknown**: Bob's exact export procedure is documented in the official guide published at event kickoff (Fri 8:30 PM IST). The procedure below is the *expected* shape based on Bob's described capabilities and may need adjustment within the first 30 minutes of the event.

Expected procedure:

1. For each migration run, every Bob SDK call writes a `bobSessionRef` to the `bob_sessions` table along with `inputTokens`, `outputTokens`, `toolCallCount`, and the raw export payload returned by Bob.
2. The export endpoint `GET /api/migrations/[id]/export-bob` queries `bob_sessions WHERE migration_id = $1 ORDER BY started_at`, transforms into Bob's required schema, and returns JSON.
3. For the PDF version, `@react-pdf/renderer` builds a 5–15 page PDF: cover, per-session summary, full task transcripts (one section per session), totals.
4. Both artifacts are committed to `/audit/bob-session-export.{json,pdf}` in the submission repo.

If Bob's actual export API differs (e.g. requires calling a specific endpoint or downloading from Bob's dashboard):

- Within first 30 min of kickoff, replace the contents of `lib/bob.ts` `exportSession()` with the correct call.
- The DB schema (`bob_sessions.exportPayload jsonb`) is intentionally untyped to absorb whatever Bob returns.
- If Bob requires a manual web download, store the artifact in `/audit/` and reference it from the README.

The product is designed to be **resilient to Bob's specific export format** — the only thing we need is some stable reference per session.

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
> [0:08–0:18] "Renatus is a crew of four AI agents orchestrated by IBM Bob. Watch."
>
> *(Paste repo URL, click "react@18 → 19", click Start.)*
>
> [0:18–0:30] "The Cartographer reads the React 19 changelog right now, in front of you. Twelve breaking changes." *(Cards animate into column 1.)* "These aren't from a static list — Bob just read facebook/react's CHANGELOG and parsed them live."
>
> [0:30–0:45] "The Surgeon now reads the entire target repo. Not the diff. The whole repo." *(Column 2 starts populating.)* "This is the move that PR-review tools cannot make. Surgeon finds nineteen files affected — ReactDOM.render, useRef without an arg, act in test-utils, default props, three more."
>
> [0:45–1:00] "While Surgeon patches, the Examiner pins existing behavior with regression tests. Generated from how the rest of the codebase calls these symbols. Bob's whole-repo context, again."
>
> [1:00–1:15] "The Auditor takes over. Applies the patch in a sandbox. Runs the regression tests against the migrated code."
>
> *(Cards drop into the Auditor column. Most go green. One goes red.)*
>
> [1:15–1:25] "Seventeen green. One red — and that's the point. The red file is honest: Renatus says here's where the breaking change broke behavior that an engineer must review. With the full Bob reasoning trail."
>
> [1:25–1:35] "Audit report. Signed. Bob session log embedded. This is the artifact you ship to a senior engineer for review — replacing a week of grep-and-pray with thirty minutes of verification."
>
> [1:35–1:30 end] "Renatus. The migration crew Bob makes possible."

Total: ~85 seconds of narration, fits the 90-second showcase block with 5s of breathing room.

### 13.2 Full 3-min video structure

| Time | Content |
|---|---|
| 0:00–0:10 | Cold open: a senior eng staring at a `react-dom/render is not a function` stacktrace at 2 AM. Cut to title card: **Renatus**. |
| 0:10–0:25 | The problem in 15 seconds: framework version migrations are expensive, brittle, and AI tools that only see diffs can't help. Cite IBM Bob's whole-repo reading. |
| 0:25–1:50 | The killer 90-second demo (§13.1). |
| 1:50–2:15 | The architecture in 25 seconds: ASCII diagram from §5.1 voiced over. "Four Bob sessions per file. Audit signed. Knowledge graph in Neo4j." |
| 2:15–2:40 | Why Bob: "PR review only needs a diff. Onboarding only needs a sample. Migration is the only dev-tools job that *requires* whole-repo reading. Bob is the unique enabler." |
| 2:40–2:55 | Business value: F500 framework migration consulting is $500K–$5M per engagement. Renatus's audit is the deliverable that closes that loop. |
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
| R1 | **IBM Bob hits rate limit / quota mid-build** | H | H | Switch agent workers to Claude Sonnet 4.6 fallback for the patch phase. Cartographer falls back to pre-seeded catalog. Demo still runs with "1 Bob session per agent" instead of N. |
| R2 | **Bob's actual SDK shape differs from expectation** | H | M | All Bob calls behind a single `lib/bob.ts` adapter. First 30 min of event = wire the real shape; downstream code unchanged. |
| R3 | **Bob's export format unknown** | H | M | `bob_sessions.exportPayload jsonb` untyped. README documents that the artifact's exact shape adapts to Bob's spec. |
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
| R16 | **Bob session log too large to embed in PDF** | M | L | Truncate to top 50 tool calls per session in PDF; full JSON always available via JSON export. |
| R17 | **Demo repo authors update repo to React 19 before demo** | L | H | Pin to a specific commit SHA recorded in §17. Migration runs against that SHA, not `main`. |
| R18 | **Audit signature broken** | L | L | Drop signature for demo if it breaks. Marketing artifact only. |
| R19 | **TypeScript build fails during deploy** | M | H | `tsc --noEmit` in pre-commit hook. CI on every push to main. |
| R20 | **Lablab.ai project page form has unexpected fields** | M | L | Open the submit form Thu evening, read every field, draft responses early. |

Risks above the line (R1, R4, R7, R8, R11, R14, R15, R17, R19) get monitored hourly. R2, R3 are de-risked by adapter pattern.

---

## 15. Cost estimates

48-hour build, expected usage:

| Service | Free tier ceiling | Expected usage | Paid spillover |
|---|---|---|---|
| Vercel Hobby | 100GB bandwidth, 100h build | < 5GB, < 4h | $0 |
| Neon free | 0.5 GB storage, 191.9 compute-hours | < 100MB, < 3h | $0 |
| Upstash Redis free | 10k cmd/day | ~3k cmd/day | $0 |
| Neo4j AuraDB free | 1 DB, 200k nodes | ~6k nodes | $0 |
| Fly.io free | 3 small VMs | 1 VM | $0 |
| Anthropic | pay-as-go | 200k input + 50k output tokens (fallback only) | ~$2 |
| Google Gemini Flash | free | < 1M tokens | $0 |
| IBM Bob | hackathon-issued | Heavy use, all 4 agents | $0 (provided) |
| GitHub | free | repo + Actions | $0 |
| YouTube | free | unlisted video | $0 |
| Domain | optional | none | $0 |
| **Total** | | | **~$2** |

Out-of-pocket cost for the entire build: roughly $2 in Claude fallback tokens, assuming Bob credits cover the rest.

---

## 16. Open questions / decisions deferred

| # | Question | When to resolve | Default if unresolved |
|---|---|---|---|
| Q1 | Bob's exact SDK shape and session object | First 30 min of event | Assume OpenAI-style chat completions with a `read_file` tool. |
| Q2 | Bob's export procedure / format | First 60 min of event | JSON dump of `bob_sessions` table + per-session raw transcripts. |
| Q3 | Bob rate limits per hackathon participant | Block 1 of build SOP | Assume 100 req/hr; cache aggressively. |
| Q4 | Whether Bob can read arbitrary GitHub repos or only repos you own | First 30 min | If "only own", we fork demo repos into builder's account beforehand. |
| Q5 | Vercel function limit for SSE on Hobby | Wed | Tested; 5min max per stream. SSE reconnects on client. |
| Q6 | Do we need OAuth or is API key fine | Wed | API key for demo. OAuth is post-hackathon. |
| Q7 | Does ed25519 signature add anything for judging | Sun | Drop if behind. Marketing only. |
| Q8 | What language Bob outputs unified diffs in (or do we ask for JSON wrapping them) | Block 4 | Wrap in JSON `{ "diff": "..." }` to force schema compliance. |
| Q9 | Are concurrency caps polite to Bob's infra | Block 1 | Default to 2 concurrent Bob sessions; raise if rate limits allow. |
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
| B1 | `thisisaman408/renatus-demo-target-min` — 5 files, 200 LoC, explicit ReactDOM.render | Smallest possible end-to-end demo. Will always pass cleanly. | Use if Bob is misbehaving and we need a guaranteed green run. |
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
│   │   │       ├── export-bob/route.ts
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
│   ├── bob.ts                     # Bob SDK adapter
│   ├── anthropic.ts
│   ├── gemini.ts
│   ├── crypto.ts                  # libsodium + signing
│   ├── github.ts                  # Octokit wrapper
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
│   └── bob-session-log.tsx
├── audit/                         # exported artifacts (gitignored except for demo run)
│   ├── bob-session-export.json
│   ├── bob-session-export.pdf
│   └── README.md
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
Multi-agent code migration crew, powered by IBM Bob.

## What it does (1 paragraph)
## Why Bob (1 paragraph, explicit)
## Demo
   - Video: <youtube>
   - Live: https://renatus.vercel.app
   - Sample run: /audit/

## How it works
   - 4 agents diagram (ASCII from §5.1)
   - Bob session topology (§5.5)

## Bob usage report
   See /audit/bob-session-export.json and /audit/bob-session-export.pdf
   produced from the demo run on Sun 17 May at <UTC time>.

## Tech stack
## Run it yourself
   - env vars
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
> Renatus is a crew of four AI agents that migrates your codebase safely across major version boundaries. Powered by IBM Bob.

**Short description (300 chars):**
> Cross-version migration is the only dev-tools task that requires reading the entire repository — which is exactly what IBM Bob does. Renatus orchestrates four specialist Bob sessions (Cartographer, Surgeon, Examiner, Auditor) to deliver a verified, audited migration patch set in minutes.

**IBM Bob usage section (200 words):**
> Bob is **runtime infrastructure** for Renatus, not just dev-time. Every migration triggers four to forty Bob sessions: one Cartographer session reads the upstream framework's CHANGELOG and RFC repo; one Surgeon-scan session reads the user's full repo to identify affected files; N Surgeon-patch sessions emit a unified diff per file; N Examiner sessions generate regression tests informed by repo-wide call patterns; one Auditor session synthesizes the final human-readable report. Bob's whole-repo reading is the *unique* enabler — a diff-only PR-review tool cannot find that a breaking change in `react-dom/client` affects file A only because of how files B and C consume the symbol exported by A. Every Bob session ID, token count, tool call count, and full transcript is logged to the `bob_sessions` Postgres table and exported in `/audit/bob-session-export.json` and `/audit/bob-session-export.pdf` with the submission. The audit report viewer embeds the per-file Bob session log inline so judges can verify exactly how each transformation was reasoned. PR review only needs a diff; documentation only needs a sample; migration is the only dev-tools job that requires Bob's whole-repo superpower.

---

## Appendix D — agents/_envelope.ts contract verification

Every agent must:
1. Receive an envelope with `migrationId` and emit one `agent_runs` row on entry, one on exit.
2. Persist the Bob session ID before making the Bob call.
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

## Appendix E — Bob adapter (lib/bob.ts) expected shape

```ts
// lib/bob.ts
// Adapter layer. All other modules import from here.
// First 30 minutes of the event = align this with Bob's actual SDK.

export interface BobSession {
  ref: string;                          // Bob's session identifier
  agentKind: AgentKind;
  purpose: string;

  readPath(path: string): Promise<string>;
  readPaths(paths: string[]): Promise<Record<string, string>>;
  searchSymbol(symbol: string): Promise<Array<{ path: string; line: number }>>;

  complete<T>(opts: {
    system: string;
    user?: string;
    expectedSchema: z.ZodType<T>;
    temperature?: number;
    maxTokens?: number;
  }): Promise<T>;

  exportTranscript(): Promise<{
    inputTokens: number;
    outputTokens: number;
    toolCallCount: number;
    rawPayload: unknown;
  }>;

  close(): Promise<void>;
}

export interface BobClient {
  openSession(opts: {
    ref: string;
    agentKind: AgentKind;
    repos?: string[];                   // repo URLs Bob is allowed to read
    purpose: string;
  }): Promise<BobSession>;
}

export const bob: BobClient = /* … instantiated at module load … */;
```

When Bob's actual SDK is known, only this file changes. Every agent imports `{ bob }` from here.

---

## Appendix F — Submission acceptance criteria (final go/no-go)

Before clicking Submit on Sun 17 May at 18:00 IST, all of the following must be true:

- [ ] Repo public on GitHub with MIT license.
- [ ] README has IBM Bob usage section with hyperlink to audit export.
- [ ] `/audit/bob-session-export.json` exists and parses as JSON.
- [ ] `/audit/bob-session-export.pdf` exists and opens.
- [ ] Demo URL loads. New migration wizard reachable.
- [ ] At least one past migration visible with green files.
- [ ] 3-minute video uploaded to YouTube (unlisted) and tested in incognito.
- [ ] 10-slide deck PDF in `/assets/deck.pdf`.
- [ ] Cover image 1920×1080 PNG in `/assets/cover.png`.
- [ ] Lablab.ai project page form filled and previewed.
- [ ] Bob is referenced ≥5 times in the project page text.
- [ ] Submission confirmation email or screenshot saved.

If any unchecked box exists at 17:30, the submission is delayed until 19:30. Do not submit a broken state.

---

End of system design.
