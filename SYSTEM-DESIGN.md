# Renatus — System Design

> A Bob-native multi-agent code-migration crew. Drop in a repository, pick a target version, and Renatus reads the upstream breaking-change catalogue, generates the migration patches, writes regression tests against the migrated code, executes them in an isolated sandbox, and ships back a cryptographically signed audit report. Delivered as a Bob Extension Pack: a custom mode + slash command + skill + MCP server, plus a small companion web app for audit hosting and the 3D codebase knowledge graph.
>
> Built for the IBM Bob Hackathon, 15–17 May 2026.

---

## Document map

1. Product
2. Why this wins
3. Bob Extension Pack — the four surfaces
4. System architecture — bird's-eye
5. The four agents
6. MCP tool surface
7. Layered architecture (transport → controller → application → domain → adapter → repository → data → cross-cutting)
8. Data model
9. End-to-end migration flow
10. Bob session integration & audit chain
11. Companion web app
12. Deployment topology
13. Security & governance
14. Performance, scaling, and concurrency
15. Failure modes and recovery
16. Observability
17. Demo strategy
18. 48-hour build SOP
19. Open risks & decisions

---

## 1. Product

Renatus is a **migration crew**. The end user is a platform engineer who needs to take a real repository from version A to version B of a framework or runtime (React 18 → 19, Tailwind 3 → 4, Node 18 → 22, Drizzle 0.x → 1.0, Python 3.10 → 3.12). They open Bob IDE in that repository, type `/migrate react-19`, and walk away. Forty-five minutes later they have:

- A branch with the migration patches applied
- A new test suite locked to the migrated semantics
- A signed, shareable audit report containing every breaking-change rule applied, every file touched, every test run, and every Bob session that contributed to the work
- A 3D knowledge graph visualisation of the codebase, with edges coloured by which breaking-change category touched them

Renatus is not a planner. It is an executor. Planning tools tell you what to do; Renatus does it and proves it worked.

Renatus is delivered as a **Bob Extension Pack**. The migration intelligence runs inside an MCP server, but the user never thinks "I am calling an MCP tool." They think "I am working in Bob and Bob is migrating my codebase." Every surface (slash command, custom mode, skill, MCP tools) is a different door into the same engine.

---

## 2. Why this wins

| Wedge | Where it comes from |
| --- | --- |
| **Bob is meaningfully used at runtime, not just during build** | The pack is installed *into* Bob. Bob's LLM drives the migration. Bob session exports are the audit chain's spine. |
| **Theme match with the hackathon Quickstart** | IBM's own Quickstart upgrades Node 16 → 22. Renatus is that idea, productised, at scale, with audit. |
| **Only execution-grade migrator in the field** | One direct competitor (LetUsCook) does plans, not patches. Renatus runs the migration and shows it green. |
| **Cryptographic audit trail as a tangible artefact** | A signed report URL outlives the 90-second demo. Judges can open it after the pitch and still see the work. |
| **Four extension surfaces, not one** | Every door (slash / mode / skill / MCP) Bob exposes is occupied. No judge can claim Bob is shallowly integrated. |
| **Whole-repo reasoning is the user's own LLM** | No API key burden, no rate limits at demo time, no "which model did you fine-tune" debate. Bob brings its own. |
| **watsonx Granite signal earned, not forced** | Used internally for cheap classification only. Optional sponsor stack box ticked. |

---

## 3. Bob Extension Pack — the four surfaces

| Surface | What the user sees | What it actually is |
| --- | --- | --- |
| **Slash command** | `/migrate react-19` in Bob chat. One keystroke entry. | A markdown command file Bob loads. It expands into a prompt that switches Bob into Migration Mode and calls the MCP `migrate_repository` tool. |
| **Custom mode** | "Migration" mode in Bob's mode picker, next to Plan / Code / Ask / Orchestrator. | A markdown mode definition: role = "migration specialist," tool access = restricted to read + MCP-Renatus, custom instructions tuned for migration reasoning. |
| **Skill** | Bob picks up the skill organically when the user mentions migration intent. | A markdown skill recipe Bob references when planning. It contains the migration playbook (read changelog first, find scope, patch leaves before roots, generate tests, run sandbox). |
| **MCP server** | Invisible to the user. Bob calls its tools. | The actual engine. Hosts the four agents, the job FSM, the knowledge graph, the audit chain. Distributed as an npm package and a hosted HTTP endpoint. |
| **Companion web app** | The audit URL. The 3D KG link. The shareable artefact. | Lightweight Next.js app. Reads from the same Postgres as the MCP server. Renders signed audit reports and the codebase KG. No user accounts; signed URLs only. |

Each surface is a thin shell over the MCP server. The MCP server is the single source of truth.

---

## 4. System architecture — bird's-eye

```
                              ┌─────────────────────────────┐
                              │   User in Bob IDE           │
                              │   types: /migrate react-19  │
                              └──────────────┬──────────────┘
                                             │
                          slash command → mode + skill loaded
                                             │
                                             ▼
                              ┌─────────────────────────────┐
                              │   Bob's own LLM             │
                              │   (Claude / Gemini / etc.)  │
                              │   plans, calls MCP tools    │
                              └──────────────┬──────────────┘
                                             │ MCP stdio (local)
                                             │ MCP HTTP/SSE (hosted)
                                             ▼
            ┌────────────────────────────────────────────────────────────┐
            │ RENATUS MCP SERVER                                         │
            │                                                            │
            │  Transport  │ stdio + HTTP/SSE                             │
            │  Controllers│ tool handlers (Zod-validated)                │
            │  Application│ migration orchestrator (FSM)                 │
            │  Domain     │ Cartographer / Surgeon / Examiner / Auditor  │
            │  Adapters   │ GitHub / watsonx / sandbox / signer / KG     │
            │  Repositories│ Drizzle (Postgres) / Neo4j / Redis / Blob   │
            │  Workers    │ BullMQ consumers, one per agent              │
            │                                                            │
            └───────┬──────────────────┬───────────────────┬─────────────┘
                    │                  │                   │
                    ▼                  ▼                   ▼
           ┌──────────────┐    ┌────────────────┐  ┌────────────────────┐
           │ Neon Postgres│    │ Neo4j AuraDB   │  │ Upstash Redis      │
           │ + pgvector   │    │ codebase KG    │  │ BullMQ + cache     │
           │ jobs, patches│    │ files, symbols │  │ idempotency keys   │
           │ audit chain  │    │ imports, tests │  │                    │
           └──────────────┘    └────────────────┘  └────────────────────┘
                    │
                    ▼
           ┌──────────────────────────────────────────────────┐
           │ Companion web app (Next.js 16, Vercel)           │
           │ /audit/[jobId]   — signed audit report           │
           │ /kg/[jobId]      — 3D codebase knowledge graph   │
           │ /jobs            — live SSE progress              │
           └──────────────────────────────────────────────────┘
```

The MCP server is the centre. It can be reached over stdio (when running locally inside Bob) or over HTTP/SSE (when running as a hosted service for remote demos and the companion web app's progress stream).

---

## 5. The four agents

Each agent is a **service class with a Zod-typed contract**. Agents do not call each other directly; they read and write through repositories, and the migration orchestrator advances the job's state machine. This decouples them and makes every agent independently testable, retryable, and replayable.

### 5.1 Cartographer

Reads the upstream breaking-change catalogue for the target migration and produces a structured map.

| Input | Output |
| --- | --- |
| `{ source: SemverRange, target: SemverRange, ecosystem: "npm"\|"pypi"\|... }` | `BreakingChange[]` — each with `id`, `category`, `severity`, `detection.pattern`, `prescription.codemod`, `prescription.manualNotes`, `references` |

The Cartographer fetches authoritative sources (official changelog, RFCs, blog posts pinned in a curated registry), parses them, normalises into the `BreakingChange` schema, and writes them to Postgres. Where the source is ambiguous, it elicits clarification from Bob's LLM via MCP's elicitation pattern — this is the one place Bob's own reasoning is consumed mid-pipeline.

Cartographer caches per `(ecosystem, source, target)` tuple. The second time anyone migrates React 18 → 19, Cartographer returns in milliseconds.

### 5.2 Surgeon

Identifies the subset of the user's repository that any breaking change touches, and generates the patches.

| Input | Output |
| --- | --- |
| `{ repoSnapshotId, breakingChangeMapId }` | `Patch[]` — each with `filePath`, `before`, `after`, `appliedRuleIds`, `rationale`, `confidence` |

Surgeon's workflow is **structural retrieval + semantic retrieval + codemod**:

1. Pull the codebase graph from Neo4j. Traverse import edges to find every file that transitively depends on a symbol touched by a breaking change.
2. For ambiguous cases (rules that match on usage patterns, not symbol names), query pgvector for files semantically close to a worked example.
3. For each candidate file, run a deterministic codemod first (jscodeshift / ts-morph transforms compiled from the breaking-change prescription). If the codemod cannot resolve a site, emit an *unresolved* marker.
4. Hand unresolved sites back to Bob's LLM via MCP elicitation: "here are five tricky call sites; pick the right transform." The LLM's answer is stored alongside the patch as `humanReasoning` (Bob is, for our purposes, the human in the loop).
5. Persist each patch to Postgres with full provenance.

Surgeon is the only agent that may mutate the codebase. Even then, mutations are written to a scratch workspace, never to the user's working tree.

### 5.3 Examiner

Generates regression tests that lock in the new behaviour and detect any post-migration drift.

| Input | Output |
| --- | --- |
| `{ patchBatchId }` | `GeneratedTest[]` — each with `targetFile`, `testFile`, `before.behaviour`, `after.behaviour`, `harness` |

Examiner reads the existing test patterns in the repo (framework, assertion library, mock style), then for each patched file produces a regression test in the same style. Two strategies:

- **Snapshot-style**: capture pre-migration behaviour by running the original file in a sandbox; capture post-migration behaviour by running the patched file; assert equality with documented divergences.
- **Property-style**: derive invariants from the breaking-change prescription (e.g., "effect cleanups must run before unmount") and emit a test that asserts the invariant.

Examiner refuses to generate a test it cannot make pass against the patched code; failures here surface as patch confidence drops.

### 5.4 Auditor

Applies every patch in an isolated sandbox, runs the full test suite plus the generated tests, records the outcome, and signs the result.

| Input | Output |
| --- | --- |
| `{ patchBatchId, generatedTestBatchId }` | `AuditReport` — JSON, with `runResults`, `divergences`, `bobSessionRefs`, `signature` (ed25519), `signedAt`, `signingKeyFingerprint` |

The sandbox is a per-job ephemeral container (Vercel Sandbox or e2b.dev). Auditor:

1. Materialises the scratch workspace into the sandbox.
2. Applies every patch in dependency order.
3. Runs `pnpm install` / language-equivalent.
4. Runs the existing test suite (baseline).
5. Runs the generated tests (regression lock).
6. Captures runtime errors, test outputs, and resource usage.
7. Assembles the report and signs it with the per-job ed25519 key. Public key is published in the companion web app for verification.

The signature covers the canonical JSON of the report plus the SHA-256 of the patch bundle and the SHA-256 of every Bob session export referenced. Tampering with any of those breaks the signature.

---

## 6. MCP tool surface

Tools are arranged in **three tiers**. Bob's LLM picks the tier matching its planning depth.

### 6.1 Tier 1 — orchestrator

| Tool | Purpose |
| --- | --- |
| `migrate_repository` | One-shot: clone, plan, patch, test, audit. Returns a job id and an SSE stream URL. |

This is what `/migrate react-19` ultimately invokes. For most users, the only tool they ever cause Bob to call.

### 6.2 Tier 2 — per-phase

| Tool | Purpose |
| --- | --- |
| `plan_migration` | Run Cartographer only. Returns the `BreakingChange[]` and a scope estimate. |
| `execute_migration_step` | Run a single phase (`map | patch | test | audit`) on an existing job. |
| `pause_migration` | Halt a running job at the next checkpoint. |
| `resume_migration` | Continue from the last checkpoint. |
| `discard_migration` | Tear down the scratch workspace and mark the job aborted. |

Used when the user wants Bob to drive the pipeline phase by phase and review between steps.

### 6.3 Tier 3 — atomic

| Tool | Purpose |
| --- | --- |
| `clone_repository` | Pull a repo to a scratch workspace; returns a snapshot id. |
| `index_repository` | Build the Neo4j graph + pgvector embeddings for a snapshot. |
| `fetch_changelog` | Cartographer's primitive. |
| `find_affected_files` | Surgeon's structural retrieval primitive. |
| `propose_patch` | Surgeon's codemod primitive for a single file. |
| `apply_patch` | Persist a patch to the scratch workspace. |
| `generate_test_for` | Examiner's per-file primitive. |
| `run_test_suite` | Auditor's sandbox runner. |
| `sign_audit` | Auditor's signing primitive. |

Used by power users and by Bob when it wants to compose unusual flows. Each atomic tool is independently safe and idempotent.

### 6.4 Read-only tools

| Tool | Purpose |
| --- | --- |
| `get_job_status` | Returns the FSM state and a summary. |
| `get_audit_url` | Returns the signed audit URL for a job. |
| `list_active_jobs` | For the current Bob session. |
| `describe_breaking_change` | Returns one `BreakingChange` record with full provenance. |

Every tool's request and response is defined by a Zod schema. The schema doubles as the MCP JSON Schema advertisement and as the runtime validator. No tool handler receives unvalidated input.

### 6.5 Elicitation pattern

Three tools (`propose_patch`, `generate_test_for`, `fetch_changelog`) may *elicit* from Bob's LLM mid-execution. This is the MCP elicitation/sampling pattern: the tool returns a request for the model to reason about a specific question, the model responds, the tool continues. This is how Renatus borrows Bob's intelligence for the genuinely hard sub-problems without taking on an LLM bill.

---

## 7. Layered architecture

The MCP server is structured as seven layers plus cross-cutting concerns. Each layer depends only on the layers below it. Tests can substitute any layer.

```
   ┌─────────────────────────────────────────────────────────────────┐
7. │ Transport            stdio adapter, HTTP/SSE adapter            │
   ├─────────────────────────────────────────────────────────────────┤
6. │ Controllers          MCP tool handlers (one per tool)           │
   ├─────────────────────────────────────────────────────────────────┤
5. │ Application services Migration orchestrator (FSM), session mgr  │
   ├─────────────────────────────────────────────────────────────────┤
4. │ Domain services      Cartographer, Surgeon, Examiner, Auditor   │
   │                      Retrieval, Indexing, Signing               │
   ├─────────────────────────────────────────────────────────────────┤
3. │ Adapters             GitHub, watsonx, sandbox, embeddings, AST  │
   ├─────────────────────────────────────────────────────────────────┤
2. │ Repositories         Drizzle (Postgres), Neo4j driver,          │
   │                      Redis client, Blob client                  │
   ├─────────────────────────────────────────────────────────────────┤
1. │ Data stores          Postgres + pgvector, Neo4j, Redis, Blob    │
   └─────────────────────────────────────────────────────────────────┘
   Cross-cutting: validation, auth, idempotency, audit trail,
                  observability, rate-limiting, error mapping
```

### 7.1 Transport layer

Two adapters:

- **stdio adapter** — for the npm-distributed package Bob runs locally. Speaks the MCP wire format over stdin/stdout. Single-process, lowest latency.
- **HTTP/SSE adapter** — for the hosted demo. Built on Hono (fast, TypeScript-native, edge-runtime friendly). Same controllers, different I/O. SSE streams progress events to the companion web app.

A transport adapter does three things: deserialise an incoming MCP envelope into a typed request, route it to the right controller, serialise the response (including streaming partials).

### 7.2 Controller layer

One handler per MCP tool. Each handler:

1. Validates input through the tool's Zod schema. Invalid input returns an MCP `INVALID_PARAMS` error with the validator message.
2. Authenticates the caller (see §13).
3. Checks the idempotency cache. If this exact request was served in the last 24 hours, replay the cached response.
4. Logs the call into `tool_invocations` (the audit trail).
5. Calls the relevant application service.
6. Maps domain errors to MCP error codes.
7. Returns the response and writes the audit-trail close record.

The handler does not contain business logic. It is the seam between MCP and the rest of the system.

In TypeScript this looks like a thin function wrapped by a `withValidation`, `withAuth`, `withIdempotency`, and `withAudit` higher-order function chain — the moral equivalent of decorators in a framework that has them.

### 7.3 Application service layer

Two main services:

- **Migration orchestrator** — owns the per-job state machine. The FSM transitions are:

  ```
  draft → planning → planned → patching → patched →
  testing → tested → auditing → audited → done
                              ↘ failed (terminal)
                              ↘ aborted (terminal)
                              ↘ paused (resumable)
  ```

  Each transition is a database transaction. Transitions enqueue the next worker job into BullMQ. Compensating transitions (rollback) are explicit, not implicit, so an aborted job leaves Postgres in a sensible state.

- **Session manager** — tracks the live MCP sessions, per-session rate limits, per-session active jobs, and the Bob task id (read from MCP transport metadata) so every audit_event row carries the originating Bob session.

### 7.4 Domain service layer

The agents (Cartographer, Surgeon, Examiner, Auditor) plus three supporting services:

- **RetrievalService** — wraps Neo4j (structural traversal: imports, exports, calls, test references) and pgvector (semantic similarity over code chunk embeddings). Exposes one method, `retrieve(query, mode)`, where `mode` picks structural, semantic, or hybrid.
- **IndexingService** — given a repo snapshot, parses files with the right AST tool (Tree-sitter for breadth, ts-morph for TypeScript precision), extracts symbols and references, writes them to Neo4j, computes embeddings via Granite Embeddings (or a local model), writes them to pgvector.
- **SigningService** — manages per-job ed25519 keypairs (private key never leaves the MCP server's secret store; public key published in the audit report and on the companion web app). Signs canonicalised JSON. Verifies on demand.

Domain services are pure with respect to transport. They take typed inputs, talk only to adapters and repositories, and return typed outputs. They never know they are being called via MCP.

### 7.5 Adapter layer

One adapter per external integration. Each adapter has an interface defined in the domain layer; the adapter implementation lives in this layer.

- **GitHubAdapter** — Octokit. Clone, fetch metadata, optionally open a pull request with the migration patches.
- **WatsonxAdapter** — IBM watsonx.ai client. Used for two narrow purposes: (a) classification calls inside Cartographer when a changelog entry doesn't fit the schema cleanly, (b) embedding generation if the local model is too slow. Wrapped behind a `LlmClassifier` interface so the watsonx implementation can be swapped for a Granite Code or Llama variant without changes upstream.
- **SandboxAdapter** — abstracts the ephemeral container runner. Vercel Sandbox is the default; e2b.dev or a local Docker fallback honour the same interface. Methods: `materialiseWorkspace(snapshotId)`, `applyPatches(patches[])`, `runCommand(cmd, timeout)`, `collectArtifacts(paths[])`, `destroy()`.
- **AstAdapter** — wraps ts-morph, jscodeshift, libcst (Python), and rome/biome (formatting). Exposes a uniform "parse → query → transform → serialise" API. Each underlying engine is plug-in.
- **EmbeddingsAdapter** — granite-embeddings or local. Batched, cached.

Every adapter has a deterministic fake for tests.

### 7.6 Repository layer

Repositories are the only code that touches the data stores. The domain layer holds repository **interfaces**; this layer holds the Drizzle / Neo4j / Redis / Blob implementations.

| Repository | Stored data |
| --- | --- |
| `JobRepository` | jobs, FSM state, timing |
| `BreakingChangeRepository` | Cartographer outputs |
| `PatchRepository` | Surgeon outputs |
| `GeneratedTestRepository` | Examiner outputs |
| `AuditRepository` | Audit reports + signatures (append-only) |
| `SnapshotRepository` | Repo snapshots (metadata in Postgres, blobs in Vercel Blob / R2) |
| `KnowledgeGraphRepository` | Neo4j read/write |
| `EmbeddingRepository` | pgvector read/write |
| `SessionRepository` | mcp_sessions, tool_invocations |
| `IdempotencyRepository` | Redis-backed |
| `QueueRepository` | BullMQ wrapper |

Every repository method is transaction-aware: callers can pass an existing transaction handle so a multi-table mutation either fully commits or fully rolls back.

### 7.7 Data layer

See §8 for the full data model.

### 7.8 Cross-cutting concerns

These do not live in any single layer but are composed into the controller pipeline and the domain services.

| Concern | Mechanism |
| --- | --- |
| **Validation** | Zod schemas at the controller boundary and at every adapter interface. No untyped data crosses a layer. |
| **Authentication** | MCP stdio: the local Bob session is trusted; the server runs in the same process tree. MCP HTTP: bearer token issued per-job, scoped to that job's resources. |
| **Authorization** | A job token can read its own job, patches, tests, audit. It cannot read others. |
| **Idempotency** | Every tool call carries an `idempotencyKey` (sha256 of canonicalised input + caller id). The first call executes; subsequent calls within 24h return the cached response. |
| **Audit trail** | Append-only `audit_events` table. Every tool call, every FSM transition, every elicitation, every patch application writes a row. Rows reference the Bob session id. |
| **Observability** | OpenTelemetry traces wrap every tool call and every agent step. Span attributes include job id, agent name, model used. Logs are structured (pino) and shipped to Axiom or BetterStack. |
| **Rate limiting** | Per MCP session: max active jobs, max tool calls per minute, max tokens elicited per hour. Enforced at the controller layer. |
| **Error mapping** | A central `toMcpError(domainError)` function maps every domain error type to an MCP error code with a stable string code consumers can match on. |
| **Secrets** | All secrets read from environment at boot; nothing written to logs; nothing emitted into responses. `.bobignore` enforces this at the source level. |

---

## 8. Data model

### 8.1 Postgres (Neon) + pgvector

Tables, append-only where flagged:

| Table | Purpose | Notes |
| --- | --- | --- |
| `users` | Hackathon judge accounts (later: real users) | Anonymous demo path uses session-only id |
| `mcp_sessions` | One row per Bob ↔ Renatus session | Bob task id, started at, last seen, transport |
| `tool_invocations` | Every MCP tool call | session id, tool name, input hash, response hash, duration, error code |
| `jobs` | The migration job | session id, repo url, source/target spec, FSM state, started/ended timestamps |
| `repo_snapshots` | A frozen view of the cloned repo | snapshot id, git sha, file count, total bytes, blob url |
| `breaking_change_maps` | Cartographer outputs, keyed by `(ecosystem, source, target)` | Cached |
| `breaking_changes` | Individual breaking-change rules within a map | category, severity, detection pattern, prescription |
| `code_chunks` | Files split into semantic chunks for embedding | path, range, sha, language |
| `embeddings` | pgvector column | code_chunk_id, vector(768) |
| `patches` | Surgeon's outputs | job id, file path, before/after, applied rule ids, confidence, status |
| `generated_tests` | Examiner's outputs | job id, target patch id, test file content, harness, status |
| `audit_runs` | One per Auditor execution | job id, sandbox image, started, finished, baseline test results, regression test results, divergences |
| `audit_signatures` | append-only | audit_run id, public key fingerprint, signature, signed bundle sha |
| `audit_events` | append-only | event type, job id, session id, payload (jsonb), bob_task_id |
| `elicitations` | Records of MCP elicitation calls | tool, prompt sent, response received, model claimed |
| `signing_keys` | Per-job ed25519 keypairs | job id, public key, encrypted private key |

pgvector extension is enabled on the `embeddings.vector` column with an HNSW index on cosine distance. The vector dimensionality matches the embedding model in use (768 for granite-embeddings-30m-english).

### 8.2 Neo4j (AuraDB)

Node labels and relationships:

```
(:File { snapshotId, path, language, sha })
(:Symbol { name, kind, signature })
(:Import { from, to, kind })
(:Test { framework, file, target })
(:BreakingChange { id })

(:File)-[:DECLARES]->(:Symbol)
(:File)-[:IMPORTS { specifier }]->(:File)
(:File)-[:REFERENCES]->(:Symbol)
(:Test)-[:COVERS]->(:File)
(:Test)-[:COVERS]->(:Symbol)
(:BreakingChange)-[:AFFECTS]->(:Symbol)
(:BreakingChange)-[:AFFECTS]->(:File)
```

Cypher queries Surgeon runs:

- "Every file transitively importing a symbol affected by any breaking change in map X."
- "Every test covering a file we are about to patch — these need re-running."
- "Strongly-connected import components — patch them as an atomic batch."

The graph is rebuilt fresh per snapshot. Snapshots are immutable.

### 8.3 Redis (Upstash)

- **BullMQ queues**: `cartographer`, `surgeon`, `examiner`, `auditor`, plus a high-priority `orchestrator` queue.
- **Idempotency cache**: keyed by `idempotencyKey`, value is the response JSON, 24h TTL.
- **Session rate-limit counters**: rolling windows per session id.
- **Job FSM lock**: a Redis lock prevents two workers transitioning the same job concurrently.

### 8.4 Blob storage (Vercel Blob or Cloudflare R2)

- Raw cloned repo tarballs (snapshot_id → tarball).
- Patch bundles (patch_batch_id → bundle).
- Generated test bundles.
- Audit reports rendered to HTML and PDF.
- Sandbox artefacts (test logs, stack traces).

Blob URLs in Postgres are signed and short-lived. The companion web app re-signs on the fly when serving an audit page.

---

## 9. End-to-end migration flow

```
User                Bob                       MCP Server                  Workers                    Stores
 │                   │                              │                          │                          │
 │  /migrate react-19│                              │                          │                          │
 ├──────────────────►│                              │                          │                          │
 │                   │ load mode + skill            │                          │                          │
 │                   │ plan with own LLM            │                          │                          │
 │                   │ tool: migrate_repository     │                          │                          │
 │                   ├─────────────────────────────►│                          │                          │
 │                   │                              │ validate, auth, idem     │                          │
 │                   │                              │ create job (DRAFT)       │                          │
 │                   │                              ├─────────────────────────►│ enqueue: orchestrator    │
 │                   │                              │ return { jobId, sse }    │                          │
 │                   │◄─────────────────────────────┤                          │                          │
 │                   │ stream SSE                   │                          │                          │
 │                   │◄─────────────────────────────┤◄─────────────────────────┤ orchestrator: PLANNING   │
 │                   │                              │                          │ enqueue: cartographer    │
 │                   │                              │                          │ Cartographer runs        │
 │                   │                              │                          │   fetches changelog      │
 │                   │                              │                          │   elicits Bob on ambig.  │
 │                   │                              │ elicitation request      │                          │
 │                   │◄─────────────────────────────┤                          │                          │
 │                   │ LLM answers                  │                          │                          │
 │                   ├─────────────────────────────►│                          │                          │
 │                   │                              │                          │   writes breaking_changes│
 │                   │                              │                          │ orchestrator: PATCHING   │
 │                   │                              │                          │ Surgeon                  │
 │                   │                              │                          │   clones, indexes        │
 │                   │                              │                          │   structural retrieval   │
 │                   │                              │                          │   semantic retrieval     │
 │                   │                              │                          │   runs codemods          │
 │                   │                              │                          │   elicits on unresolved  │
 │                   │                              │                          │   writes patches         │
 │                   │                              │                          │ orchestrator: TESTING    │
 │                   │                              │                          │ Examiner                 │
 │                   │                              │                          │   generates tests        │
 │                   │                              │                          │ orchestrator: AUDITING   │
 │                   │                              │                          │ Auditor                  │
 │                   │                              │                          │   sandbox up             │
 │                   │                              │                          │   apply, install, run    │
 │                   │                              │                          │   capture, sign          │
 │                   │                              │                          │   writes audit_signatures│
 │                   │                              │                          │ orchestrator: DONE       │
 │                   │ stream final                 │                          │                          │
 │                   │◄─────────────────────────────┤                          │                          │
 │ "done — audit at  │                              │                          │                          │
 │  audit/abc123"    │                              │                          │                          │
 │◄──────────────────┤                              │                          │                          │
 │ clicks URL                                                                                              │
 │ ────────────────────────────────────────────────────────────►   companion web app: signed audit page   │
```

Each `orchestrator: STATE` transition is one Postgres transaction plus one BullMQ enqueue. The system survives any single worker dying — BullMQ will redeliver, the FSM is idempotent against re-entry into the current state, and every adapter call is wrapped with a retry policy.

---

## 10. Bob session integration & audit chain

This is the load-bearing detail for hackathon judging.

### 10.1 What gets exported

Every Bob task that touches Renatus produces an export under `bob_sessions/`:

- Markdown export of the task history (`bob_sessions/<timestamp>__<surface>__<short-desc>.md`)
- Screenshot of the task consumption summary (`bob_sessions/<timestamp>__<surface>__<short-desc>.png`)

Surfaces include `slash-migrate`, `mode-migration`, `skill-load`, and `mcp-tool-<tool-name>`.

### 10.2 How Renatus ties exports back

When Bob calls an MCP tool, the MCP transport metadata carries a Bob task id. The controller layer reads it once and stamps it on:

- The `mcp_sessions.bob_task_id` row (one row per Bob task across all the tool calls inside it).
- Every `audit_events.bob_task_id` written during that session.
- The `AuditReport.bobSessionRefs` array — a list of every Bob task id that contributed to this job.

When the auditor signs the report, the signature covers the canonical JSON including `bobSessionRefs`. So tampering with which Bob sessions produced the migration breaks the signature.

### 10.3 What the audit URL shows

On `companion/audit/<jobId>`:

- The signed report JSON (pretty-printed).
- A signature verification widget — paste the public key, paste the JSON, hit Verify.
- A list of Bob task ids with deep links to the corresponding `bob_sessions/<file>.md` in the repo (relative paths so they resolve when judges clone the repo locally).
- A timeline of every tool call (from `tool_invocations`) interleaved with every elicitation.
- The 3D codebase KG link.

A judge who opens the audit URL can verify, in one screen, that Bob did the work, what tools were called, and what changed.

---

## 11. Companion web app

A focused Next.js 16 App Router app. Not the product surface — just the artefact host.

### 11.1 Routes

| Route | Rendering | Purpose |
| --- | --- | --- |
| `/` | RSC static | Landing: what is Renatus, install instructions, public key, GitHub link |
| `/audit/[jobId]` | RSC + small client island | Signed audit report (see §10.3) |
| `/kg/[jobId]` | client only, dynamic import | 3D codebase knowledge graph, React Three Fiber + react-force-graph-3d |
| `/jobs/[jobId]/live` | client + EventSource | Live SSE feed of orchestrator state transitions, for demos |
| `/verify` | client only | Paste a signed report and the public key, verify the signature client-side |
| `/api/audit/[jobId]/sign-url` | route handler | Issue a short-lived signed URL for the audit blob |

### 11.2 3D knowledge graph rendering

Nodes are files. Node size = lines of code. Node colour by category of breaking change touching it (red = high-severity rule, amber = mid, green = unchanged). Edges are imports. The migration animation pulses each affected file in the order Surgeon patched it.

Built with `react-force-graph-3d` on top of three.js. Camera controls, hover tooltips, keyboard navigation, screenshot export. Mobile-degraded to a 2D fallback.

### 11.3 Why this exists in the design at all

Two reasons. First, it gives the audit a permanent home — the report URL outlives the demo. Second, the KG is the visual centrepiece of the 90-second demo; migrations don't demo well as text, but a pulsing 3D graph of "here's everything Surgeon touched" does.

---

## 12. Deployment topology

| Component | Where it runs | Why |
| --- | --- | --- |
| **MCP server (stdio)** | npm package, executed locally by Bob via `npx -y @renatus/mcp` | Lowest latency for the user's primary workflow |
| **MCP server (HTTP/SSE)** | Hosted on Fly.io or Railway, persistent container | Required for the companion web app's SSE stream and for remote/judge demos |
| **Workers (BullMQ consumers)** | Same container as the HTTP MCP server, on a dedicated worker pool | One process, multiple worker classes |
| **Companion web app** | Vercel | Edge-rendered marketing + dynamic audit pages |
| **Postgres + pgvector** | Neon | Managed, branchable for demos |
| **Neo4j** | AuraDB free tier | Managed, sufficient for demo-scale graphs |
| **Redis** | Upstash | Managed, generous free tier |
| **Blob storage** | Vercel Blob (or Cloudflare R2 if cost spikes) | Same vendor surface as the web app |
| **Sandbox runtime** | Vercel Sandbox (or e2b.dev) | Per-job ephemeral, billed per second |

Single-region deployment to start (us-east-1 / iad1). The MCP server and the web app share the same Postgres so audit data is the single source of truth.

### 12.1 Why a hosted MCP server at all

The npm/stdio path is the production path for end users. The hosted HTTP path exists for two reasons:

1. **Demo reliability** — judges installing the npm package live on stage is fragile. A hosted endpoint they can hit with one config line de-risks the demo.
2. **Companion web app** — the SSE progress feed has to come from somewhere persistent.

Both transports run the exact same code. Only the transport adapter differs.

---

## 13. Security & governance

### 13.1 Trust model

| Principal | What they can do |
| --- | --- |
| Local user running stdio MCP | Full access to their own jobs in their workspace |
| Hosted user (per-job token) | Read/write their own job's resources; read their own audit; no cross-job visibility |
| Anonymous web visitor | Read any audit by jobId (audit URLs are unguessable + expirable) |
| Renatus admin | Full access (for support); audited |

### 13.2 Secrets

- Loaded from environment at boot. Never logged. Never echoed in responses.
- `.bobignore` excludes any path matching `.env*`, `secrets/`, `*.key`, `config/credentials.json` from Bob's read scope. Enforced by check-in commit hook.
- ed25519 private keys are encrypted at rest with a server-wide KEK held in the platform secret store (Fly.io / Vercel). Decrypted only inside SigningService.

### 13.3 Sandbox isolation

- Every Auditor run gets a fresh container.
- No network egress except to the package registry, on an allow-list.
- Filesystem is read-only except for `/workspace` and `/tmp`.
- 10-minute hard wall-clock limit.
- All process output captured to blob and into `audit_runs`.

### 13.4 Patch safety

- Patches apply only inside the per-job scratch workspace, never to the user's working tree.
- A `discard_migration` call deletes the workspace.
- The user has to explicitly export the migrated branch with `materialise_branch`; until then nothing touches their checkout.

### 13.5 Hackathon-specific governance

- `bob_sessions/` is read-only via convention and `.gitattributes`; modifications generate a CI warning.
- The repo's pre-push hook runs a secret-scan over `bob_sessions/*.md` exports — IBM's security team deactivates accounts that leak credentials to a public repo (hackathon guide p.20), so this is non-negotiable.
- The Cartographer output cache is keyed by source URL; if a source URL no longer resolves, the cache entry is invalidated so we never serve stale prescriptions.

---

## 14. Performance, scaling, and concurrency

### 14.1 Within a single job

- Cartographer is mostly I/O. Parallelise changelog fetches.
- Indexing is CPU-bound on AST parsing. Worker concurrency = available CPUs.
- Surgeon patches files in parallel where their import subgraphs are independent (computed from Neo4j). Dependent files are batched.
- Examiner generates tests in parallel per file.
- Auditor is sequential by necessity (one sandbox, one run).

### 14.2 Across jobs

- BullMQ workers scale horizontally. Heuristic concurrency: 4 cartographer, 8 surgeon, 8 examiner, 2 auditor (sandboxes are expensive).
- Neo4j writes are serialised per snapshot via a Redis lock keyed by snapshotId.
- pgvector writes are batched (100-row inserts).

### 14.3 Cache strategy

- Cartographer's `BreakingChangeMap` is fully cached. Demo of React 18→19 is instant after the first user.
- IndexingService caches per `(snapshotId, fileSha)`. Re-indexing a tweaked branch only re-parses the changed files.
- Embeddings cached per `code_chunk.sha`.
- Idempotency cache absorbs Bob's natural retry pattern.

### 14.4 Hot path budgets

- MCP `migrate_repository` returns within 300 ms (just enqueues).
- First SSE event within 1 s.
- End-to-end migration for the demo target (~50 files, React 18→19): target 6 minutes; hard ceiling 15 minutes.

---

## 15. Failure modes and recovery

| Failure | Detection | Recovery |
| --- | --- | --- |
| Worker crashes mid-step | BullMQ heartbeat | Redeliver up to 3 times with exponential backoff |
| Sandbox container dies | Auditor non-zero exit + timeout | Re-create sandbox, re-run; on 2nd failure mark `failed` with diagnostics |
| Cartographer source unreachable | HTTP error | Try alternate source from the curated registry; if all fail, emit `partial-map` and require elicitation |
| Surgeon's codemod fails on a site | Local exception in the AST transform | Emit `unresolved` patch; elicit Bob's LLM for that site |
| Examiner cannot make test pass | Test runs but asserts fail | Lower patch confidence; flag for human review in audit |
| pgvector index corruption | Periodic integrity check | Rebuild index (a 30s op) |
| Neo4j connection lost | Driver error | Retry with backoff; if persistent, pause affected jobs |
| Audit signing key compromise | Manual or alert | Rotate per-job keys are isolated; re-sign or revoke individual audits |
| MCP elicitation timeout (Bob unresponsive) | 30s timeout | Mark site `unresolved`, continue; surface in audit |

The orchestrator is the single point that decides what state to put a failed job into. Workers never set terminal states directly.

---

## 16. Observability

- **Traces** — OpenTelemetry. Every tool call is a root span. Every agent step is a child span. Every adapter call is a leaf span. Exported to Axiom or Honeycomb.
- **Metrics** — RED (rate, errors, duration) per tool. Per-agent throughput. Sandbox seconds consumed. Embeddings tokens consumed. watsonx classification calls.
- **Logs** — structured (pino), one log line per significant event, correlation id = job id. Shipped to Axiom.
- **Live dashboard** — for the demo: a Grafana board showing the live SSE feed translated into a job pipeline view, on a second monitor.
- **Audit replay** — `audit_events` is the highest-fidelity trace. Any past job can be replayed for inspection by reading rows in order.

---

## 17. Demo strategy

The migration is the artefact; the demo is the experience. Plan the 90 seconds first.

### 17.1 The 90-second arc

| Second | Beat |
| --- | --- |
| 0–8 | Open Bob in a real OSS React 18 repo. Type `/migrate react-19`. |
| 8–20 | Bob's chat narrates the plan it just read from Renatus's `plan_migration` tool. Visible: a list of breaking changes Cartographer mapped. |
| 20–45 | The companion web app's 3D KG opens on a second screen. Files pulse red as Surgeon patches them. (This is the visual hero.) |
| 45–70 | Auditor's sandbox runs. Terminal output streams. Tests turn green. |
| 70–82 | Audit URL pops up in Bob's chat. Click. Signed report renders. Pan over the signature. |
| 82–90 | Hover the 3D KG. Land on the closing line: "Six minutes. Forty-seven files. Signed." |

### 17.2 Backup plan

- Pre-record the full flow as a 60-second screen capture at the highest possible quality.
- During the live attempt, if any step exceeds its time budget by 50%, fall back to the recording without breaking eye contact.
- The audit URL from the pre-recorded run is permanent and clickable; judges can verify after.

### 17.3 Target repository

Primary: a real OSS React 18 codebase with ~50 source files, full test suite, no exotic build tooling. Two backups pre-staged. All three pre-migrated in `bob_sessions/` so the demo runs against a clean re-execution.

---

## 18. 48-hour build SOP

The SOP exists to make scope decisions in advance. Build in waves; each wave is a checkpoint where we ship-or-cut.

### 18.1 Hour 0–4 — foundation

- Repo skeleton (monorepo, pnpm workspaces, Turbo, shared TS config, Drizzle workspace).
- MCP server skeleton: stdio transport, one no-op tool, end-to-end "Bob can talk to us."
- Postgres up, basic `jobs` + `tool_invocations` schemas.
- `bob_sessions/` discipline: every Bob task exported the moment it ends.

**Checkpoint:** Bob can call a Renatus MCP tool and we log it. If we miss this, the project is in trouble.

### 18.2 Hour 4–12 — Surgeon end-to-end on a trivial migration

- Cartographer minimal: hardcoded React 18→19 breaking-change map (skip live fetching).
- Indexing minimal: file list + ts-morph imports only (no embeddings, no Neo4j yet).
- Surgeon minimal: one codemod (the `useEffect` cleanup-return-undefined rule).
- Apply patch to scratch workspace, return as MCP response.
- Slash command + custom mode + skill scaffolded (markdown files only).

**Checkpoint:** `/migrate react-19` on a tiny repo produces a working patch. If we miss this, fall back to "Test Crew" pivot — but that decision is made HERE, not later.

### 18.3 Hour 12–24 — depth

- Neo4j integration: structural retrieval.
- pgvector + embeddings: semantic retrieval.
- Surgeon scales to ~5 codemod rules.
- Examiner v1: generate snapshot-style regression tests for each patched file.
- Auditor v1: apply patches, run tests in Vercel Sandbox, capture results.
- Audit signing wired up. End-to-end now returns a signed report JSON.

**Checkpoint:** A real OSS React 18 repo migrates end-to-end, green. If we miss this, cut Neo4j or embeddings (one of them), not both.

### 18.4 Hour 24–36 — the experience

- Companion web app deployed.
- `/audit/[jobId]` renders the signed report.
- `/kg/[jobId]` renders the 3D graph.
- SSE progress feed live.
- Cartographer caching and a second migration target (Tailwind 3→4) wired up.

**Checkpoint:** Demo runs end-to-end against the primary target repo in ≤10 minutes. If not, cut the second migration target.

### 18.5 Hour 36–44 — polish + demo prep

- Pre-record the demo. Twice.
- Run the demo 5 times start to finish. Time every iteration.
- Write the README install snippet. Verify it works on a fresh machine.
- Walk through `bob_sessions/` and make sure every export is clean (no secrets, descriptive filenames).
- Commit, push, double-check the public repo renders.

### 18.6 Hour 44–48 — submission

- Cover image. Video presentation. Slide presentation.
- Submission form on lablab.ai.
- Verify the demo URL is up.
- Sleep before judging.

---

## 19. Open risks & decisions

| Risk / open question | Mitigation / decision deadline |
| --- | --- |
| Vercel Sandbox quota during 48h burst | Pre-check quotas before hour 12; have e2b.dev fallback wired |
| Bob's MCP elicitation latency | Tested at hour 4; if >5s round-trip on average, restructure to avoid mid-pipeline elicitation |
| 3D KG performance on the demo repo | If frame rate drops below 30fps on a 200-node graph, downgrade to 2D viz |
| watsonx Granite credits actually arriving on time | Decouple — internal classifier defaults to a local model; Granite is a swap-in if credits land |
| Audit signing key management on Vercel | Use Vercel Environment Variables (encrypted) for the KEK; per-job keys stored encrypted in Postgres |
| Demo repo not migrating cleanly | Pre-stage 3 candidates; commit "known-good" baseline runs to `bob_sessions/` before stage |
| Judges asking "why MCP not Bob skill" | Section §3 of this doc is the answer, with PDF page references |

---

## Appendix A — terminology

- **Snapshot** — an immutable, content-addressed copy of a repo at a specific git sha.
- **Job** — one execution of the migration pipeline against one snapshot for one target.
- **Patch** — a single file-level transformation produced by Surgeon.
- **Patch batch** — all patches for a job.
- **Audit run** — one Auditor execution against one patch batch.
- **Elicitation** — a mid-tool callback to Bob's LLM via MCP, to borrow its reasoning for a hard sub-question.
- **Surface** — one of the four Bob extension types Renatus occupies (slash command, mode, skill, MCP server).

## Appendix B — relationships to external standards

- **MCP** — Renatus is a strict implementer of the Model Context Protocol spec, including tools, resources (audit reports are MCP resources), and elicitation.
- **Conventional Commits** — Renatus's generated migration commits follow the convention so they integrate with downstream changelog tooling.
- **SLSA provenance** — the signed audit report adopts SLSA-like provenance shape so it's recognisable to enterprises already running supply-chain attestations.
- **OpenTelemetry** — traces and metrics emit standard names; no custom convention.

## Appendix C — what is intentionally NOT in scope for the 48 hours

- Multi-language support beyond JS/TS for the demo (Python codemods designed but not implemented).
- Authentication beyond per-job tokens (no Auth0 / Clerk integration).
- A general "ChatOps" surface (Slack / Discord bots).
- Pull-request automation beyond branch materialisation.
- Plan-mode pricing / billing.

These are post-hackathon work. The system is designed so they slot in without rework.

---

*End of system design.*
