# Renatus — System Design

> **Audit-grade infrastructure for LLM-driven code changes.** Renatus is the production wrapper around any LLM that touches code: it indexes the repository, hands the LLM the right context, runs the result in an isolated sandbox, and ships a cryptographically signed audit report.
>
> The headline use case is **multi-version code migration** (React 18 → 19, Node 18 → 22, Tailwind 3 → 4, Drizzle 0.x → 1.0, Python 3.10 → 3.12). The same engine extends to refactoring, codebase Q&A, security review, and policy enforcement — same agents, different rule sources.
>
> Two entry points: a **Model Context Protocol server** (Bob IDE, Claude Code, Cursor, Windsurf can drive it) and a **standalone web app** (judges and end users can drive it without an MCP-capable client, bringing no LLM of their own — Renatus uses its configured providers).
>
> Built for the IBM Bob Hackathon, 15–17 May 2026.

---

## Document map

1. Product
2. Why this wins
3. Entry surfaces
4. System architecture
5. The four agents
6. MCP tool surface
7. LLM adapter abstraction
8. Layered architecture
9. Data model
10. End-to-end flows
11. Bob session integration
12. Web app (standalone product surface)
13. Deployment topology
14. Security & governance
15. Performance, scaling, concurrency
16. Failure modes & recovery
17. Observability
18. Demo strategy
19. 48-hour build SOP (high level — detailed roadmap in IMPLEMENTATION-ROADMAP.md)
20. Beyond migration — adjacent use cases
21. Open risks

---

## 1. Product

Renatus is the production layer around LLM-driven code changes. Three claims it makes:

1. **The LLM is not the product.** The bare LLM (Bob, Claude Code, Cursor) can already migrate code. Renatus does not compete with it. Renatus wraps it.
2. **The wrapper is the product.** Cryptographically signed audit, isolated sandbox execution, persistent replayable state, cached cross-user knowledge, and a knowledge graph + semantic index over the repository. Every claim Renatus makes about a migration is auditable.
3. **The wrapper is portable.** Any MCP-compliant client calls the engine. Or the engine drives itself via a standalone web app, using providers it configures (Groq, Gemini, watsonx Granite, OpenAI-compatible).

The hackathon demo focuses on **migration** because (a) it is the most-watched use case, (b) it matches the official Quickstart theme (Node 16 → 22), and (c) the visible diff is easy to render in 90 seconds. The architecture is general; the demo is focused.

### Use cases this same engine supports

| Use case | What changes vs. migration |
| --- | --- |
| **Migration** (headline) | Cartographer reads a version-pair changelog; Surgeon proposes file changes; Auditor runs the new test suite. |
| **Refactoring** (rename across repo, restructure modules) | Cartographer becomes a thin rule source (the user's intent + targets); Surgeon proposes; Auditor runs existing tests. |
| **Codebase Q&A** | Only the indexing layer is used; the LLM answers questions over the knowledge graph + embeddings. |
| **Security review** | Cartographer's rule source is a CVE map; Surgeon proposes mitigations; Auditor adds CVE-replay tests. |
| **Policy enforcement** | Cartographer's rule source is a style/policy doc; Surgeon enforces; Auditor proves enforcement is complete. |

For 48h we ship migration end-to-end. Other use cases are post-hackathon expansions that reuse 100% of the infrastructure.

---

## 2. Why this wins

| Wedge | Source |
| --- | --- |
| **Bob is meaningfully used at runtime, not just during build** | MCP server is one of Renatus's two entry points. Bob calls the tools. Sessions exports are the spine of the audit chain. |
| **Renatus is a real product, not a Bob-only demo** | The standalone web app works without Bob, using Renatus's own LLM providers. Enterprise viability. |
| **Theme match with the hackathon Quickstart** | IBM ships Node 16 → 22 as their quickstart. Renatus generalises that idea to any version pair. |
| **Cryptographically signed audit as a tangible artefact** | Demo prop that outlives the 90s pitch — judges click the URL after, still see the work. |
| **Four Bob extension surfaces, not one** | Slash command, custom mode, skill, MCP server — every door Bob exposes is occupied. |
| **Multi-provider LLM** | Groq for speed, Gemini for 1M-context big repos, watsonx Granite for the IBM signal, MCP elicitation for host-LLM paths. No vendor lock. |
| **WebContainers in the browser** | The audit verification page actually runs the migrated test suite in the visitor's browser. No backend round-trip. Stage-grade demo prop. |
| **Only execution-grade migrator in the field** | One direct competitor (LetUsCook) plans, doesn't execute. Renatus runs and proves. |

---

## 3. Entry surfaces

| Surface | Audience | LLM source | What it does |
| --- | --- | --- | --- |
| **Bob slash command** (`/migrate react-19`) | Bob users | Bob's own LLM (host) | One keystroke → switches mode → calls MCP tool |
| **Bob custom mode** (Migration mode) | Bob users browsing modes | Bob's own LLM (host) | Pre-tunes Bob's reasoning for migration work |
| **Bob skill** (migrate-codebase recipe) | Bob users when the LLM picks it organically | Bob's own LLM (host) | Background prompt that biases Bob toward Renatus's tools |
| **MCP server (stdio)** | Bob, Claude Code, Cursor, Windsurf, any MCP client | Caller's LLM via MCP elicitation | The portable engine. Drives the same pipeline as the web app. |
| **MCP server (HTTP/SSE)** | Hosted demo, web app's progress feed, remote clients | Caller's LLM via MCP elicitation | Same controllers as stdio, different transport |
| **Standalone web app** | Anyone — judges without Bob, F500 evaluators, public demo | Renatus's configured providers (Groq / Gemini / watsonx Granite) | Paste a repo URL + pick migration target + watch it run. Bring no LLM. |

The MCP server and the web app share one execution engine, one database, one audit chain.

---

## 4. System architecture

```
┌──────────────────────────┐    ┌──────────────────────────┐
│  Bob IDE / Claude Code   │    │  Web app visitor         │
│  Cursor / Windsurf       │    │  (no AI client needed)   │
│  via MCP (stdio + SSE)   │    │  via HTTPS               │
└────────────┬─────────────┘    └────────────┬─────────────┘
             │                                │
             ▼                                ▼
┌─────────────────────────────────────────────────────────────┐
│                  RENATUS PLATFORM                           │
│                                                             │
│  Transport     stdio | HTTP/SSE | HTTPS (Next.js routes)   │
│  Controllers   MCP tools, web app route handlers           │
│  Application   Migration orchestrator (Inngest workflows)  │
│  Domain        Cartographer / Surgeon / Examiner / Auditor │
│  LLM           LlmAdapter — MCP elicitation | Groq | Gemini│
│                              | watsonx Granite | OpenAI    │
│  Adapters      GitHub | Sandbox | AST | Embeddings | Sign  │
│  Repositories  Drizzle (Postgres + pgvector)               │
│  Workflows     Inngest (durable, observable)               │
│                                                             │
└──────────┬──────────────────────────┬───────────────────────┘
           │                          │
           ▼                          ▼
┌──────────────────────┐    ┌───────────────────────────┐
│ Neon Postgres        │    │ Vercel AI Gateway         │
│ + pgvector           │    │ multi-provider routing    │
│ + recursive CTEs     │    │ (Groq | Gemini | watsonx) │
│ jobs, patches,       │    │ observability, retries    │
│ audit chain,         │    │                           │
│ knowledge graph,     │    └───────────────────────────┘
│ embeddings           │
└──────────────────────┘    ┌───────────────────────────┐
                            │ Vercel Sandbox            │
                            │ ephemeral test execution  │
                            │                           │
                            │ + WebContainers (browser) │
                            │ in-browser audit replay   │
                            └───────────────────────────┘
```

### Major stack changes vs. earlier drafts

| Was | Now | Reason |
| --- | --- | --- |
| Neo4j AuraDB for the codebase graph | **Postgres recursive CTEs** (with pgGraph as a post-hackathon optimisation) | One fewer external service. Recursive CTEs handle ~200-file demo target fine. Neo4j was overkill. |
| BullMQ on Upstash Redis | **Inngest** for durable workflows | Inngest = the FSM, retries, observability, dead-letter, replay — all natively. Less code, fewer ops. Redis stays only for the idempotency cache. |
| Per-provider LLM SDKs | **Vercel AI SDK + AI Gateway** | One API over Groq / Gemini / watsonx / OpenAI-compat. Gateway gives observability, fallback, retries. |
| Backend-only sandbox | **Vercel Sandbox + WebContainers** (browser) | WebContainers let the audit page run the migrated test suite in the visitor's browser. Visceral demo prop, zero round-trip. |
| Ad-hoc multi-language AST | ts-morph + **ast-grep** | ast-grep is structural pattern matching across languages — Python, Rust, Java all become available without per-language AST libraries. |

---

## 5. The four agents

Each agent is a service class with a Zod-typed contract. Agents do not call each other directly; they read and write through repositories, and the orchestrator advances the job's state. This keeps every agent independently testable, retryable, and replayable.

### 5.1 Cartographer

Maps a rule source into a structured set of changes.

| Use case | What it consumes |
| --- | --- |
| Migration | A `(ecosystem, sourceVersion, targetVersion)` tuple → fetches changelog → parses into `BreakingChange[]` |
| Refactoring | A user-provided intent + targets → produces `RefactorRule[]` |
| Security review | A CVE id → fetches advisory → produces `Mitigation[]` |
| Policy enforcement | A style/policy doc → produces `PolicyRule[]` |

For 48h, only the migration variant ships. The schema (`Rule[]`) is the same; the parser is the variant point.

**Output:** `BreakingChangeMap` — cached per `(ecosystem, source, target)` tuple. Second user pays nothing.

### 5.2 Surgeon — LLM-driven, not codemod-driven

This is the major correction from earlier drafts. The LLM is the primary mechanism. Codemods are an optional cache for well-known patterns.

**Workflow:**

1. **Retrieve.** Pull the affected file set via structural traversal (recursive CTEs over the imports table) ∪ semantic similarity (pgvector cosine search). Rank by combined score.
2. **Context-assemble.** For each candidate file: pull the file + its imports + relevant breaking-change rules + repo's existing test style + any prior elicitation results.
3. **Call the LLM** via `LlmAdapter.reason()`. Two paths:
   - **MCP elicitation** (Bob, Claude Code, etc.): the host LLM does the reasoning, free for the caller.
   - **Direct API** (web app): Renatus uses Groq / Gemini / watsonx through Vercel AI Gateway.
4. **Validate.** Parse the proposed file with ts-morph. Syntactically invalid → reject + retry with feedback (max 2 retries).
5. **Persist.** Patch row with `confidence` (computed from validation pass + retry count + LLM-self-report), `rationale` (LLM's stated reasoning), `humanReasoning` (full LLM transcript).
6. **Cache the rule.** If the LLM proposed an identical transform for ≥3 separate files (a "deterministic pattern"), promote it to a codemod and cache. Next run uses the codemod and skips the LLM.

**Why this design:**
- The LLM (host or configured) is the smartest piece of the system. Let it do the work.
- Codemods grow organically from observed patterns, not hand-written ahead of time.
- The host LLM path is free for Bob/Claude Code users.
- The direct API path stays cheap because of cache promotion.

**Confidence scoring:**
- `1.0` — promoted-to-codemod pattern; deterministic.
- `0.85` — LLM proposed, parsed clean, no retry.
- `0.7` — LLM proposed, needed 1 retry.
- `0.5` — LLM proposed, 2 retries, marginal.
- `0.3` — LLM gave up; site marked `unresolved`.

### 5.3 Examiner

Generates regression tests for each patched file. Detects the existing test framework (Vitest / Jest / Mocha / Playwright) and matches the repo's style.

Two strategies, picked per file:
- **Snapshot:** capture pre-migration behaviour, capture post-migration behaviour, assert equality with documented divergences.
- **Property:** derive an invariant from the change rule and assert it.

Examiner refuses to emit a test it cannot make pass against the patched code. That refusal lowers the originating patch's confidence — early signal that something is wrong.

### 5.4 Auditor

Applies every patch in an isolated sandbox, runs the test suites, captures the outcome, signs the result.

Two sandbox modes:
- **Backend** (Vercel Sandbox or e2b.dev): standard, isolated, server-side.
- **In-browser** (WebContainers via the audit page): the visitor's browser runs the migrated test suite live. Audit signature is server-side; verification is client-side. Demo prop.

**Signing:** ed25519 via `@noble/curves`. Per-job keypair. Public key published on the web app. The signature covers the canonical JSON of the audit report plus the SHA-256 of the patch bundle and the SHA-256 of every Bob session export referenced. Tampering anywhere breaks the signature.

---

## 6. MCP tool surface

Tools in three tiers. Bob's LLM picks the tier matching its planning depth.

### Tier 1 — orchestrator

| Tool | Purpose |
| --- | --- |
| `migrate_repository` | One-shot: clone → index → plan → patch → test → audit. Returns job id + SSE URL. |
| `refactor_repository` | Same pipeline, refactor rule source. (Post-hackathon: stub for now.) |
| `query_codebase` | Use the index without changing code. RAG over the KG + embeddings. (Free side-quest: reuses indexing infra.) |

### Tier 2 — per-phase

| Tool | Purpose |
| --- | --- |
| `plan_migration` | Cartographer only. Returns the rule set + scope estimate. |
| `execute_migration_step` | Run one phase (`map | patch | test | audit`) on an existing job. |
| `pause_migration`, `resume_migration`, `discard_migration` | Lifecycle. |

### Tier 3 — atomic

| Tool | Purpose |
| --- | --- |
| `clone_repository`, `index_repository`, `fetch_changelog`, `find_affected_files`, `propose_patch`, `apply_patch`, `generate_test_for`, `run_test_suite`, `sign_audit` | Each independently safe and idempotent. |

### Read-only

| Tool | Purpose |
| --- | --- |
| `get_job_status`, `get_audit_url`, `list_active_jobs`, `describe_rule` | Status. |

Every tool's request and response is a Zod schema. The schema is the JSON Schema advertisement and the runtime validator. No tool handler receives unvalidated input.

### Elicitation pattern

`propose_patch` and `generate_test_for` may *elicit* from the caller's LLM mid-execution. This is the MCP sampling pattern: tool emits a reasoning request, model answers, tool continues. This is how Renatus borrows the host LLM's intelligence without taking on a token bill.

When the entry surface is the web app (no host LLM), `LlmAdapter` resolves to a configured provider (Groq / Gemini / watsonx) instead of MCP elicitation. Same Surgeon code, different adapter.

---

## 7. LLM adapter abstraction

A single interface decouples the agents from "who is reasoning."

```typescript
interface LlmAdapter {
  reason(request: ReasoningRequest): Promise<ReasoningResponse>;
  stream(request: ReasoningRequest): AsyncIterable<ReasoningChunk>;
  capabilities(): { contextWindow: number; supportsTools: boolean; ... };
}
```

Implementations:

| Implementation | When used | Notes |
| --- | --- | --- |
| `McpElicitationAdapter` | MCP server entry, Bob/Claude Code calls | Uses MCP sampling. Caller's LLM. Free for caller. |
| `VercelAiGatewayAdapter` | Web app entry, or MCP HTTP entry when host LLM is unavailable | Routes via Vercel AI Gateway. Provider-pluggable. Observability built in. |
| `GroqAdapter` | Direct (low-latency tier, no Gateway) | Llama 3.1 70B / 405B. Fast. Generous free tier. |
| `GeminiAdapter` | Direct (large-context tier) | Gemini 2.0 Pro, 1M context. Free with GCP credits. |
| `WatsonxGraniteAdapter` | Direct (IBM signal) | Granite 3 8B. $80 IBM credits ≈ 800k tokens — comfortably covers the demo. |
| `OpenAiCompatibleAdapter` | Fallback / generic | For Together / Fireworks / any OpenAI-protocol endpoint. |

**Routing policy (defined in `LlmRouter`):**
- If MCP elicitation is available → use it (free, host-LLM).
- Else if `WATSONX_API_KEY` present → use watsonx (sponsor signal).
- Else if `GEMINI_API_KEY` present and context > 100k → use Gemini.
- Else → use Groq.

Agents take a router, not a specific adapter. The router decides per call based on context size, latency budget, and configured providers.

---

## 8. Layered architecture

Seven layers + cross-cutting concerns. Each depends only on the layers below it. Tests substitute any layer.

```
┌─────────────────────────────────────────────────────────────────┐
7. Transport            stdio | HTTP/SSE | Next.js routes        │
├─────────────────────────────────────────────────────────────────┤
6. Controllers          MCP tool handlers + web app handlers     │
├─────────────────────────────────────────────────────────────────┤
5. Application          Migration orchestrator (Inngest workflows)│
├─────────────────────────────────────────────────────────────────┤
4. Domain               Cartographer / Surgeon / Examiner /      │
│                       Auditor / Retrieval / Indexing / Signing │
├─────────────────────────────────────────────────────────────────┤
3. LLM                  LlmRouter + LlmAdapter implementations   │
├─────────────────────────────────────────────────────────────────┤
2. Adapters             GitHub | Sandbox | AST | Embeddings      │
├─────────────────────────────────────────────────────────────────┤
1. Repositories + Data  Drizzle (Postgres + pgvector)            │
└─────────────────────────────────────────────────────────────────┘
Cross-cutting: validation (Zod), auth, idempotency, audit trail,
               observability (OpenTelemetry), rate limiting, errors
```

### 7.1 Transport

- **stdio** — local Bob/Claude Code path. MCP SDK's `StdioServerTransport`.
- **HTTP/SSE** — hosted MCP for remote clients + the web app's progress feed. Hono on Vercel functions.
- **Next.js routes** — the web app's own HTTP surface. RSC for static, route handlers for dynamic.

### 7.2 Controllers

One handler per MCP tool; one route handler per web endpoint. Each does: validate → auth → idempotency check → audit-log open → call application service → map errors → audit-log close. No business logic.

### 7.3 Application — Inngest workflows

The migration orchestrator is an Inngest workflow, not a hand-rolled FSM over BullMQ. Inngest provides durable execution, retries, replay, cancellation, observability — for free.

Workflow shape:

```
migrate_repository(input)
  → step: clone_repository
  → step: index_repository
  → step: plan_migration              (Cartographer)
  → step: patch (fan-out per file)    (Surgeon — parallel)
  → step: generate_tests (fan-out)    (Examiner — parallel)
  → step: run_sandbox + sign          (Auditor)
  → return audit URL
```

Inngest handles persistence, retry policy per step, and cancellation. The job FSM state is derived from Inngest's run history; no separate FSM table.

### 7.4 Domain services

The four agents plus three support services (Retrieval, Indexing, Signing). Pure with respect to transport — they don't know they're being called via MCP or the web app.

### 7.5 LLM layer

`LlmRouter` + adapters (see §7).

### 7.6 Adapters

- **GitHubAdapter** — Octokit. Clone, fetch metadata, optionally open PR.
- **SandboxAdapter** — Vercel Sandbox default, e2b.dev fallback, WebContainers for browser-side replay. Same interface.
- **AstAdapter** — ts-morph (TypeScript precision) + ast-grep (multi-language pattern matching). Either can drive a transform; choice per rule.
- **EmbeddingsAdapter** — Vercel AI SDK over Voyage AI / watsonx embeddings / local fallback.

### 7.7 Repositories + data

All in Postgres. See §9.

### 7.8 Cross-cutting

| Concern | Mechanism |
| --- | --- |
| Validation | Zod at every boundary. |
| Auth | MCP stdio: trusted local. MCP HTTP: per-job bearer token. Web app: optional Better Auth for saved-jobs (not in demo scope). |
| Idempotency | Redis cache keyed by `sha256(canonical input + caller id)`. 24h TTL. |
| Audit trail | Append-only `audit_events` table. Every tool call, every workflow step, every elicitation. |
| Observability | OpenTelemetry traces; Axiom for logs; AI Gateway provides LLM-call telemetry natively. |
| Rate limiting | Per session at the controller layer. |
| Error mapping | `toMcpError(domainError)` for MCP; standard JSON error envelope for web. |
| Secrets | Env only; `.bobignore` enforced; pre-push secret-scan gate. |

---

## 9. Data model

### 9.1 Postgres (Neon) — everything lives here

| Table | Purpose |
| --- | --- |
| `users` | Anonymous demo path uses session-only id |
| `mcp_sessions` | Per Bob/Claude Code session; stamps `bob_task_id` |
| `tool_invocations` | Every MCP tool call |
| `web_jobs` | Web app's direct-mode jobs |
| `jobs` | Migration jobs (parent of both above) |
| `repo_snapshots` | Immutable cloned-repo records |
| `files` | Per-snapshot file rows (id, path, language, sha) |
| `imports` | Edge table — file → file (replaces Neo4j) |
| `symbols` | Declared symbols per file |
| `symbol_refs` | Edge table — file → symbol references |
| `code_chunks` | File slices for embedding |
| `embeddings` | pgvector(768), HNSW index, cosine |
| `breaking_change_maps` | Cartographer outputs, keyed by `(ecosystem, source, target)`, cached |
| `breaking_changes` | Individual rules in a map |
| `patches` | Surgeon outputs — file path, before, after, applied rule ids, confidence, status, LLM transcript |
| `generated_tests` | Examiner outputs |
| `audit_runs` | One per Auditor execution |
| `audit_signatures` | Append-only |
| `audit_events` | Append-only, every event in the system |
| `elicitations` | MCP elicitation transcripts |
| `signing_keys` | Per-job ed25519 keypairs (private key encrypted with server KEK) |
| `idempotency_keys` | Idempotency cache (Redis primary, Postgres fallback) |

### 9.2 Graph queries via recursive CTEs

The "every file transitively importing symbol X" query becomes:

```sql
WITH RECURSIVE reachable AS (
  SELECT from_file_id FROM imports WHERE to_file_id = $1
  UNION
  SELECT i.from_file_id FROM imports i JOIN reachable r ON i.to_file_id = r.from_file_id
)
SELECT DISTINCT from_file_id FROM reachable;
```

For demo-scale repos (~200 files, ~1000 import edges), this completes in <100 ms with a B-tree index on `(to_file_id, from_file_id)`. No Neo4j needed. If a real F500 user runs this on a 50k-file monorepo, we promote to pgGraph (post-hackathon).

### 9.3 Redis (idempotency only)

Redis stays in the stack but its job shrinks: just the idempotency cache. Inngest replaced its workflow/queue role.

### 9.4 Blob (Vercel Blob)

Raw repo tarballs, patch bundles, generated test bundles, audit HTML/PDF, sandbox artifacts. Postgres holds the blob URLs.

---

## 10. End-to-end flows

### 10.1 Via Bob/Claude Code (MCP path)

```
User → /migrate react-19
  → Bob mode + skill activate
  → Bob's LLM plans, calls migrate_repository(repoUrl, source: react@18, target: react@19)
  → Renatus MCP controller validates, auths, creates job
  → Inngest workflow starts:
      → clone → index → plan → patch (LLM elicitation back to Bob's LLM)
      → tests → sandbox → sign
  → SSE stream emits state transitions; Bob renders progress
  → Audit URL returned in MCP response
  → User clicks audit URL → web app shows signed report + 3D KG
```

### 10.2 Via web app (standalone path)

```
Visitor → renatus.app → "Migrate a repo"
  → Pastes GitHub URL, picks source/target versions
  → Picks LLM provider (Groq / Gemini / watsonx) — has defaults
  → Web app route handler creates web_job + parent job
  → Same Inngest workflow runs
      → patch step uses VercelAiGatewayAdapter (Groq / Gemini / watsonx)
      → no MCP elicitation needed
  → Web app subscribes to SSE — shows live progress
  → Audit URL rendered when complete
  → Visitor downloads patches as zip, or copies a PR command
```

Same Inngest workflow. Same database. Same audit signature shape. Only the `LlmAdapter` differs.

---

## 11. Bob session integration

The load-bearing detail for hackathon judging.

**Every Bob task that calls Renatus exports to `bob_sessions/`:** markdown task export + screenshot of the task consumption summary. Filenames namespace by surface: `bob_sessions/<timestamp>__<surface>__<short>.md` where surface ∈ `slash-migrate | mode-migration | skill-load | mcp-<tool>`.

**Renatus stamps Bob task ids onto every audit event.** When Bob calls a tool, the MCP transport metadata carries a Bob task id. The controller reads it once and stamps it on `mcp_sessions.bob_task_id`, every `audit_events.bob_task_id`, and the `AuditReport.bobSessionRefs` array.

**The signature covers `bobSessionRefs`.** Tampering with which Bob sessions produced the migration breaks the signature. The audit page renders a list of session ids with deep links to the matching `bob_sessions/<file>.md` files (relative paths so they resolve when judges clone the repo locally).

`bob_sessions/` is read-only by convention. Claude Code (or any non-Bob tool) never edits it.

---

## 12. Web app (standalone product surface)

Next.js 16 App Router on Vercel. Not the marketing site — the actual product.

### Routes

| Route | Rendering | Purpose |
| --- | --- | --- |
| `/` | RSC static | Landing, install MCP snippet, "try the web app" CTA |
| `/run` | RSC + client form | Repo URL + migration target + provider picker → kicks off a job |
| `/jobs/[jobId]` | RSC + EventSource | Live progress (SSE), final audit link |
| `/audit/[jobId]` | RSC + client island | Signed audit report + signature-verification widget + Bob session links + tool-call timeline |
| `/kg/[jobId]` | Client only, dynamic import | 3D codebase knowledge graph (R3F + react-force-graph-3d) |
| `/replay/[jobId]` | Client only | **WebContainers** in-browser replay of the migrated test suite |
| `/verify` | Client only | Paste a signed report + public key → verify locally |
| `/explore/[snapshotId]` | RSC | Codebase Q&A interface (Tier-1 `query_codebase` tool, free side-quest) |

### 3D knowledge graph

Nodes = files; size = LoC; colour = severity of touching rule. Edges = imports. Migration animation pulses each affected file in patch-application order. `react-force-graph-3d` on three.js. Mobile-degraded to 2D.

### WebContainers replay (the demo prop)

The audit page embeds StackBlitz WebContainers. The visitor's browser boots a Node runtime, applies the patches, runs the test suite. Result rendered in <30s for the demo repo. **No backend round-trip.** Judges click → 30s later they see green tests in their own browser. That's the visual heroes of the demo.

---

## 13. Deployment topology

| Component | Where | Why |
| --- | --- | --- |
| MCP server (stdio) | Published as `@renatus/mcp` on npm; runs locally in Bob via stdio | Lowest latency for the Bob path |
| MCP server (HTTP/SSE) | Vercel Functions (Edge or Node runtime) | Same controllers, hosted demo |
| Web app | Vercel | Edge-rendered, fast |
| Workflows | **Inngest Cloud** (free tier; Inngest dev server locally) | Durable, observable, no Redis ops |
| Postgres + pgvector | Neon | Branchable for demos |
| Redis (idempotency only) | Upstash | Generous free tier |
| Blob storage | Vercel Blob | Same vendor surface |
| Backend sandbox | Vercel Sandbox primary; e2b.dev fallback; local Docker for dev | Per-job ephemeral |
| In-browser sandbox | WebContainers via StackBlitz SDK | No infra; runs in visitor's browser |
| LLM routing | Vercel AI Gateway | Multi-provider, observable |

Single region for the hackathon (iad1). Everything that can be co-located is.

---

## 14. Security & governance

### 14.1 Trust model

| Principal | Capabilities |
| --- | --- |
| Local stdio user (Bob) | Full access to their own jobs in their workspace |
| Hosted MCP user (per-job token) | Read/write own job's resources only |
| Web app visitor | Anonymous session; jobs are theirs while the cookie lives |
| Audit URL viewer | Read any audit by id (URLs are unguessable, expirable) |

### 14.2 Secrets

- Loaded from env at boot. Never logged. Never echoed in responses.
- `.bobignore` excludes `.env*`, `secrets/`, `*.key`, `*.pem`, `*.pfx`, `config/credentials*`.
- **Pre-push secret-scan gate** scans staged files for known patterns (`sk-`, `AKIA`, `Bearer `, `ghp_`, `ghs_`, IBM Cloud key prefixes). Hard fail. Hackathon rule (guide p.20): IBM deactivates accounts that leak credentials.
- ed25519 private keys encrypted at rest with a server-wide KEK from `RENATUS_KEK` env var.

### 14.3 Sandbox isolation

- Ephemeral container per job. No network egress except allow-listed package registry.
- Read-only filesystem except `/workspace` and `/tmp`.
- 10-minute hard wall-clock limit.
- All output captured to blob + `audit_runs`.

### 14.4 Patch safety

- Patches apply only inside the per-job scratch workspace.
- `discard_migration` wipes the workspace.
- User must explicitly `materialise_branch` to write to their own checkout.

### 14.5 LLM-output safety

- Surgeon never executes LLM-emitted code without sandbox isolation.
- Test-runner output is read-only to the Auditor; sandbox cannot mutate Renatus's state.
- AI Gateway logs every prompt + response; full LLM transcript in `elicitations` for replay.

---

## 15. Performance, scaling, concurrency

### 15.1 Within a job

- Cartographer: I/O bound, parallelise changelog fetches.
- Indexing: CPU bound on AST parsing. Concurrency = available CPUs.
- Surgeon: fan-out per file via Inngest, capped at 8 concurrent LLM calls (rate-limit-friendly).
- Examiner: fan-out per file.
- Auditor: sequential (one sandbox per job).

### 15.2 Across jobs

- Inngest scales workflows horizontally.
- Postgres connection pool sized by `MAX_CONCURRENT_JOBS × 4`.
- pgvector batched 100-row inserts.

### 15.3 Cache hierarchy

- L1: idempotency cache (Redis) — bare repeats.
- L2: Cartographer's `BreakingChangeMap` cache (Postgres) — version-pair migrations are deduped across users.
- L3: codemod promotion (Postgres) — patterns the LLM has solved 3+ times become deterministic codemods that skip the LLM.
- L4: embedding cache (Postgres) — keyed by `file.sha`.

### 15.4 Hot-path budgets

- `migrate_repository` MCP response: <300 ms (just enqueues).
- First SSE event: <1 s.
- End-to-end migration on demo target (~200 files, React 18→19): target 4–6 minutes.

---

## 16. Failure modes & recovery

| Failure | Detection | Recovery |
| --- | --- | --- |
| Inngest step failure | Inngest's retry policy | Up to 3 retries, exponential backoff, then dead-letter |
| Sandbox container dies | Auditor non-zero exit + timeout | Re-run; 2× failure → mark `failed` with diagnostics |
| LLM provider rate-limit | 429 from AI Gateway | Gateway fails over to next provider in routing policy |
| LLM hallucinated unparseable code | ts-morph throws | Retry with feedback; 2× retry → mark site `unresolved` |
| Bob elicitation timeout | 30 s no-response | Site marked `unresolved`; continue |
| pgvector index corruption | Periodic integrity check | Rebuild (~30 s) |
| Postgres connection lost | Driver error | Retry with backoff; persistent → Inngest pauses dependent runs |
| Audit signing key compromise | Manual / alert | Per-job keys isolate blast radius; revoke individual audits |
| Vercel Sandbox quota | 429 / 503 | Fall back to e2b.dev; if both → local Docker |

The Inngest workflow is the single point that decides terminal state. Workers never set terminal states directly.

---

## 17. Observability

- **Traces:** OpenTelemetry. Every controller call is a root span; every Inngest step is a child; every adapter call is a leaf. Exported to Axiom.
- **AI Gateway telemetry:** every LLM call's tokens, latency, provider, cost — automatic.
- **Metrics:** RED per tool. Per-agent throughput. Sandbox seconds. Provider token spend.
- **Logs:** Pino structured. Correlation id = job id. Shipped to Axiom.
- **Live demo dashboard:** Inngest's own UI shows the job pipeline animating in real time — usable on a second screen during the demo.
- **Audit replay:** the `audit_events` table is the highest-fidelity trace. Replay any past job by reading rows in order.

---

## 18. Demo strategy

The migration is the artefact; the demo is the experience. Plan the 90 seconds first.

### 18.1 The 90-second arc

| Second | Beat |
| --- | --- |
| 0–8 | Bob in a real OSS React 18 repo. Type `/migrate react-19`. |
| 8–20 | Bob's chat narrates Renatus's `plan_migration` output. Cartographer's rules visible. |
| 20–45 | Second screen: the web app's `/jobs/[jobId]` page. 3D KG pulsing as Surgeon patches files. |
| 45–65 | `/audit/[jobId]` opens. Signed audit JSON visible. Click "Replay in browser." |
| 65–80 | **WebContainers boots in the audience's browser.** Tests run live. Green. |
| 80–90 | Pan over signature; closing line: "Four minutes. 47 files. Signed. And the tests are running right now in your browser." |

### 18.2 Backup plan

Pre-record the full flow at quality the moment the first end-to-end migration goes green (Hour ~13). Switch to recording if the live attempt slips its budget by 50%.

### 18.3 Target repository

Primary: a real OSS React 18 codebase, ~200 files, working test suite, no exotic tooling. Two backups pre-staged. Primary pre-migrated and committed under `bob_sessions/` so the demo runs against a clean re-execution.

### 18.4 Second migration (stretch, if time)

Node 18 → 22 on a real OSS package. Demonstrates the architecture is general, not React-specific. Reuses 100% of infrastructure.

---

## 19. 48-hour build SOP

Detailed wave-by-wave plan lives in `IMPLEMENTATION-ROADMAP.md`. Top-level:

| Wave | Hours | Goal |
| --- | --- | --- |
| 1 | 0–5 | Foundation: monorepo, MCP `ping`, Postgres + Drizzle, Inngest dev, web stub deployed, secret gate, demo repo selected, sandbox smoke-tested |
| 2 | 5–13 | First end-to-end migration on a tiny fixture using LLM elicitation. **Backup video recorded here.** |
| 3 | 13–26 | Real demo target migrates end-to-end with tests in sandbox and signed audit |
| 4 | 26–37 | Web app pages: audit, KG, WebContainers replay, SSE progress |
| 5 | 37–44 | Demo rehearsal × 5, final video record, README, secret scan |
| 6 | 44–48 | Submission package; verify; rest |

---

## 20. Beyond migration — adjacent use cases

These reuse the entire stack. Not built in 48h, but the architecture is ready.

| Use case | What plugs in |
| --- | --- |
| **Refactor agent** | A `RefactorRuleSource` implementation. Surgeon unchanged. |
| **Codebase Q&A** (RAG over the index) | Already exposed as the `query_codebase` MCP tool. Free side-quest. |
| **Security review** (CVE → file fixes) | A `CveRuleSource`. Examiner gets CVE-replay tests. |
| **Policy enforcement** | A `PolicyRuleSource` reading a style doc / `.eslintrc` family. |
| **Auto-PR generator** | The `materialise_branch` + GitHub PR creation tool. |
| **Auditable LLM code-review** | Same Auditor wrapping Bob/Claude's PR-review output. |

The pitch generalises: **Renatus is the audit layer for any LLM that touches code.** Migration is the headline; the framework is the product.

---

## 21. Open risks

| Risk | Mitigation |
| --- | --- |
| WebContainers feature flag / browser support | Pre-test on Chrome + Safari; fall back to a static `<video>` of the test run if WebContainers is unavailable |
| Inngest free-tier limits during 48h burst | Inngest dev server runs locally; cloud is the deploy target. Monitor usage. |
| LLM cost during demo | Routing policy prefers free providers (MCP elicitation, Groq) ahead of paid ones |
| AI Gateway as single point of routing failure | Direct adapters bypass Gateway; routing policy can flip to direct in env |
| MCP elicitation latency >5s | Batched per-file elicitations; cached by `(ruleId, fileSha)` |
| Demo target migrates dirtily | Three target candidates pre-staged; cleanest one used |
| Judges asking "why Bob and not just Claude Code" | The standalone web app is the answer — Renatus works either way, but the Bob path has the strongest audit chain |

---

## Appendix A — terminology

- **Snapshot** — an immutable, content-addressed copy of a repo at a git sha.
- **Job** — one execution of the migration pipeline against one snapshot.
- **Patch** — a single file-level transformation produced by Surgeon.
- **Audit run** — one Auditor execution against one patch batch.
- **Elicitation** — a mid-tool callback to the caller's LLM via MCP.
- **Surface** — one of the four Bob extensions (slash, mode, skill, MCP) or the standalone web app.

## Appendix B — external standards

- **MCP** — Renatus implements the Model Context Protocol (tools, resources, elicitation/sampling).
- **Conventional Commits** — generated migration commits follow the convention.
- **SLSA provenance** — the signed audit report adopts SLSA-like provenance shape.
- **OpenTelemetry** — standard span/metric naming.

## Appendix C — out of scope for 48 hours

- Refactor / Q&A / security-review / policy modes (architecture-ready, not built).
- Multi-language codemods beyond TS/JS (ast-grep allows them; no codemod registry built).
- User accounts (per-job tokens only; Better Auth wired post-hackathon).
- Pull-request automation beyond branch materialisation.
- Billing / quotas.

---

*End of system design.*
