**User:**

<task>
Hi read this system design that i have built 'SYSTEM-DESIGN.md' (see below for file content)
</task>

<file_content path="SYSTEM-DESIGN.md">
  1 | # Renatus — System Design
  2 | 
  3 | > A Bob-native multi-agent code-migration crew. Drop in a repository, pick a target version, and Renatus reads the upstream breaking-change catalogue, generates the migration patches, writes regression tests against the migrated code, executes them in an isolated sandbox, and ships back a cryptographically signed audit report. Delivered as a Bob Extension Pack: a custom mode + slash command + skill + MCP server, plus a small companion web app for audit hosting and the 3D codebase knowledge graph.
  4 | >
  5 | > Built for the IBM Bob Hackathon, 15–17 May 2026.
  6 | 
  7 | ---
  8 | 
  9 | ## Document map
 10 | 
 11 | 1. Product
 12 | 2. Why this wins
 13 | 3. Bob Extension Pack — the four surfaces
 14 | 4. System architecture — bird's-eye
 15 | 5. The four agents
 16 | 6. MCP tool surface
 17 | 7. Layered architecture (transport → controller → application → domain → adapter → repository → data → cross-cutting)
 18 | 8. Data model
 19 | 9. End-to-end migration flow
 20 | 10. Bob session integration & audit chain
 21 | 11. Companion web app
 22 | 12. Deployment topology
 23 | 13. Security & governance
 24 | 14. Performance, scaling, and concurrency
 25 | 15. Failure modes and recovery
 26 | 16. Observability
 27 | 17. Demo strategy
 28 | 18. 48-hour build SOP
 29 | 19. Open risks & decisions
 30 | 
 31 | ---
 32 | 
 33 | ## 1. Product
 34 | 
 35 | Renatus is a **migration crew**. The end user is a platform engineer who needs to take a real repository from version A to version B of a framework or runtime (React 18 → 19, Tailwind 3 → 4, Node 18 → 22, Drizzle 0.x → 1.0, Python 3.10 → 3.12). They open Bob IDE in that repository, type `/migrate react-19`, and walk away. Forty-five minutes later they have:
 36 | 
 37 | - A branch with the migration patches applied
 38 | - A new test suite locked to the migrated semantics
 39 | - A signed, shareable audit report containing every breaking-change rule applied, every file touched, every test run, and every Bob session that contributed to the work
 40 | - A 3D knowledge graph visualisation of the codebase, with edges coloured by which breaking-change category touched them
 41 | 
 42 | Renatus is not a planner. It is an executor. Planning tools tell you what to do; Renatus does it and proves it worked.
 43 | 
 44 | Renatus is delivered as a **Bob Extension Pack**. The migration intelligence runs inside an MCP server, but the user never thinks "I am calling an MCP tool." They think "I am working in Bob and Bob is migrating my codebase." Every surface (slash command, custom mode, skill, MCP tools) is a different door into the same engine.
 45 | 
 46 | ---
 47 | 
 48 | ## 2. Why this wins
 49 | 
 50 | | Wedge | Where it comes from |
 51 | | --- | --- |
 52 | | **Bob is meaningfully used at runtime, not just during build** | The pack is installed *into* Bob. Bob's LLM drives the migration. Bob session exports are the audit chain's spine. |
 53 | | **Theme match with the hackathon Quickstart** | IBM's own Quickstart upgrades Node 16 → 22. Renatus is that idea, productised, at scale, with audit. |
 54 | | **Only execution-grade migrator in the field** | One direct competitor (LetUsCook) does plans, not patches. Renatus runs the migration and shows it green. |
 55 | | **Cryptographic audit trail as a tangible artefact** | A signed report URL outlives the 90-second demo. Judges can open it after the pitch and still see the work. |
 56 | | **Four extension surfaces, not one** | Every door (slash / mode / skill / MCP) Bob exposes is occupied. No judge can claim Bob is shallowly integrated. |
 57 | | **Whole-repo reasoning is the user's own LLM** | No API key burden, no rate limits at demo time, no "which model did you fine-tune" debate. Bob brings its own. |
 58 | | **watsonx Granite signal earned, not forced** | Used internally for cheap classification only. Optional sponsor stack box ticked. |
 59 | 
 60 | ---
 61 | 
 62 | ## 3. Bob Extension Pack — the four surfaces
 63 | 
 64 | | Surface | What the user sees | What it actually is |
 65 | | --- | --- | --- |
 66 | | **Slash command** | `/migrate react-19` in Bob chat. One keystroke entry. | A markdown command file Bob loads. It expands into a prompt that switches Bob into Migration Mode and calls the MCP `migrate_repository` tool. |
 67 | | **Custom mode** | "Migration" mode in Bob's mode picker, next to Plan / Code / Ask / Orchestrator. | A markdown mode definition: role = "migration specialist," tool access = restricted to read + MCP-Renatus, custom instructions tuned for migration reasoning. |
 68 | | **Skill** | Bob picks up the skill organically when the user mentions migration intent. | A markdown skill recipe Bob references when planning. It contains the migration playbook (read changelog first, find scope, patch leaves before roots, generate tests, run sandbox). |
 69 | | **MCP server** | Invisible to the user. Bob calls its tools. | The actual engine. Hosts the four agents, the job FSM, the knowledge graph, the audit chain. Distributed as an npm package and a hosted HTTP endpoint. |
 70 | | **Companion web app** | The audit URL. The 3D KG link. The shareable artefact. | Lightweight Next.js app. Reads from the same Postgres as the MCP server. Renders signed audit reports and the codebase KG. No user accounts; signed URLs only. |
 71 | 
 72 | Each surface is a thin shell over the MCP server. The MCP server is the single source of truth.
 73 | 
 74 | ---
 75 | 
 76 | ## 4. System architecture — bird's-eye
 77 | 
 78 | ```
 79 |                               ┌─────────────────────────────┐
 80 |                               │   User in Bob IDE           │
 81 |                               │   types: /migrate react-19  │
 82 |                               └──────────────┬──────────────┘
 83 |                                              │
 84 |                           slash command → mode + skill loaded
 85 |                                              │
 86 |                                              ▼
 87 |                               ┌─────────────────────────────┐
 88 |                               │   Bob's own LLM             │
 89 |                               │   (Claude / Gemini / etc.)  │
 90 |                               │   plans, calls MCP tools    │
 91 |                               └──────────────┬──────────────┘
 92 |                                              │ MCP stdio (local)
 93 |                                              │ MCP HTTP/SSE (hosted)
 94 |                                              ▼
 95 |             ┌────────────────────────────────────────────────────────────┐
 96 |             │ RENATUS MCP SERVER                                         │
 97 |             │                                                            │
 98 |             │  Transport  │ stdio + HTTP/SSE                             │
 99 |             │  Controllers│ tool handlers (Zod-validated)                │
100 |             │  Application│ migration orchestrator (FSM)                 │
101 |             │  Domain     │ Cartographer / Surgeon / Examiner / Auditor  │
102 |             │  Adapters   │ GitHub / watsonx / sandbox / signer / KG     │
103 |             │  Repositories│ Drizzle (Postgres) / Neo4j / Redis / Blob   │
104 |             │  Workers    │ BullMQ consumers, one per agent              │
105 |             │                                                            │
106 |             └───────┬──────────────────┬───────────────────┬─────────────┘
107 |                     │                  │                   │
108 |                     ▼                  ▼                   ▼
109 |            ┌──────────────┐    ┌────────────────┐  ┌────────────────────┐
110 |            │ Neon Postgres│    │ Neo4j AuraDB   │  │ Upstash Redis      │
111 |            │ + pgvector   │    │ codebase KG    │  │ BullMQ + cache     │
112 |            │ jobs, patches│    │ files, symbols │  │ idempotency keys   │
113 |            │ audit chain  │    │ imports, tests │  │                    │
114 |            └──────────────┘    └────────────────┘  └────────────────────┘
115 |                     │
116 |                     ▼
117 |            ┌──────────────────────────────────────────────────┐
118 |            │ Companion web app (Next.js 16, Vercel)           │
119 |            │ /audit/[jobId]   — signed audit report           │
120 |            │ /kg/[jobId]      — 3D codebase knowledge graph   │
121 |            │ /jobs            — live SSE progress              │
122 |            └──────────────────────────────────────────────────┘
123 | ```
124 | 
125 | The MCP server is the centre. It can be reached over stdio (when running locally inside Bob) or over HTTP/SSE (when running as a hosted service for remote demos and the companion web app's progress stream).
126 | 
127 | ---
128 | 
129 | ## 5. The four agents
130 | 
131 | Each agent is a **service class with a Zod-typed contract**. Agents do not call each other directly; they read and write through repositories, and the migration orchestrator advances the job's state machine. This decouples them and makes every agent independently testable, retryable, and replayable.
132 | 
133 | ### 5.1 Cartographer
134 | 
135 | Reads the upstream breaking-change catalogue for the target migration and produces a structured map.
136 | 
137 | | Input | Output |
138 | | --- | --- |
139 | | `{ source: SemverRange, target: SemverRange, ecosystem: "npm"\|"pypi"\|... }` | `BreakingChange[]` — each with `id`, `category`, `severity`, `detection.pattern`, `prescription.codemod`, `prescription.manualNotes`, `references` |
140 | 
141 | The Cartographer fetches authoritative sources (official changelog, RFCs, blog posts pinned in a curated registry), parses them, normalises into the `BreakingChange` schema, and writes them to Postgres. Where the source is ambiguous, it elicits clarification from Bob's LLM via MCP's elicitation pattern — this is the one place Bob's own reasoning is consumed mid-pipeline.
142 | 
143 | Cartographer caches per `(ecosystem, source, target)` tuple. The second time anyone migrates React 18 → 19, Cartographer returns in milliseconds.
144 | 
145 | ### 5.2 Surgeon
146 | 
147 | Identifies the subset of the user's repository that any breaking change touches, and generates the patches.
148 | 
149 | | Input | Output |
150 | | --- | --- |
151 | | `{ repoSnapshotId, breakingChangeMapId }` | `Patch[]` — each with `filePath`, `before`, `after`, `appliedRuleIds`, `rationale`, `confidence` |
152 | 
153 | Surgeon's workflow is **structural retrieval + semantic retrieval + codemod**:
154 | 
155 | 1. Pull the codebase graph from Neo4j. Traverse import edges to find every file that transitively depends on a symbol touched by a breaking change.
156 | 2. For ambiguous cases (rules that match on usage patterns, not symbol names), query pgvector for files semantically close to a worked example.
157 | 3. For each candidate file, run a deterministic codemod first (jscodeshift / ts-morph transforms compiled from the breaking-change prescription). If the codemod cannot resolve a site, emit an *unresolved* marker.
158 | 4. Hand unresolved sites back to Bob's LLM via MCP elicitation: "here are five tricky call sites; pick the right transform." The LLM's answer is stored alongside the patch as `humanReasoning` (Bob is, for our purposes, the human in the loop).
159 | 5. Persist each patch to Postgres with full provenance.
160 | 
161 | Surgeon is the only agent that may mutate the codebase. Even then, mutations are written to a scratch workspace, never to the user's working tree.
162 | 
163 | ### 5.3 Examiner
164 | 
165 | Generates regression tests that lock in the new behaviour and detect any post-migration drift.
166 | 
167 | | Input | Output |
168 | | --- | --- |
169 | | `{ patchBatchId }` | `GeneratedTest[]` — each with `targetFile`, `testFile`, `before.behaviour`, `after.behaviour`, `harness` |
170 | 
171 | Examiner reads the existing test patterns in the repo (framework, assertion library, mock style), then for each patched file produces a regression test in the same style. Two strategies:
172 | 
173 | - **Snapshot-style**: capture pre-migration behaviour by running the original file in a sandbox; capture post-migration behaviour by running the patched file; assert equality with documented divergences.
174 | - **Property-style**: derive invariants from the breaking-change prescription (e.g., "effect cleanups must run before unmount") and emit a test that asserts the invariant.
175 | 
176 | Examiner refuses to generate a test it cannot make pass against the patched code; failures here surface as patch confidence drops.
177 | 
178 | ### 5.4 Auditor
179 | 
180 | Applies every patch in an isolated sandbox, runs the full test suite plus the generated tests, records the outcome, and signs the result.
181 | 
182 | | Input | Output |
183 | | --- | --- |
184 | | `{ patchBatchId, generatedTestBatchId }` | `AuditReport` — JSON, with `runResults`, `divergences`, `bobSessionRefs`, `signature` (ed25519), `signedAt`, `signingKeyFingerprint` |
185 | 
186 | The sandbox is a per-job ephemeral container (Vercel Sandbox or e2b.dev). Auditor:
187 | 
188 | 1. Materialises the scratch workspace into the sandbox.
189 | 2. Applies every patch in dependency order.
190 | 3. Runs `pnpm install` / language-equivalent.
191 | 4. Runs the existing test suite (baseline).
192 | 5. Runs the generated tests (regression lock).
193 | 6. Captures runtime errors, test outputs, and resource usage.
194 | 7. Assembles the report and signs it with the per-job ed25519 key. Public key is published in the companion web app for verification.
195 | 
196 | The signature covers the canonical JSON of the report plus the SHA-256 of the patch bundle and the SHA-256 of every Bob session export referenced. Tampering with any of those breaks the signature.
197 | 
198 | ---
199 | 
200 | ## 6. MCP tool surface
201 | 
202 | Tools are arranged in **three tiers**. Bob's LLM picks the tier matching its planning depth.
203 | 
204 | ### 6.1 Tier 1 — orchestrator
205 | 
206 | | Tool | Purpose |
207 | | --- | --- |
208 | | `migrate_repository` | One-shot: clone, plan, patch, test, audit. Returns a job id and an SSE stream URL. |
209 | 
210 | This is what `/migrate react-19` ultimately invokes. For most users, the only tool they ever cause Bob to call.
211 | 
212 | ### 6.2 Tier 2 — per-phase
213 | 
214 | | Tool | Purpose |
215 | | --- | --- |
216 | | `plan_migration` | Run Cartographer only. Returns the `BreakingChange[]` and a scope estimate. |
217 | | `execute_migration_step` | Run a single phase (`map | patch | test | audit`) on an existing job. |
218 | | `pause_migration` | Halt a running job at the next checkpoint. |
219 | | `resume_migration` | Continue from the last checkpoint. |
220 | | `discard_migration` | Tear down the scratch workspace and mark the job aborted. |
221 | 
222 | Used when the user wants Bob to drive the pipeline phase by phase and review between steps.
223 | 
224 | ### 6.3 Tier 3 — atomic
225 | 
226 | | Tool | Purpose |
227 | | --- | --- |
228 | | `clone_repository` | Pull a repo to a scratch workspace; returns a snapshot id. |
229 | | `index_repository` | Build the Neo4j graph + pgvector embeddings for a snapshot. |
230 | | `fetch_changelog` | Cartographer's primitive. |
231 | | `find_affected_files` | Surgeon's structural retrieval primitive. |
232 | | `propose_patch` | Surgeon's codemod primitive for a single file. |
233 | | `apply_patch` | Persist a patch to the scratch workspace. |
234 | | `generate_test_for` | Examiner's per-file primitive. |
235 | | `run_test_suite` | Auditor's sandbox runner. |
236 | | `sign_audit` | Auditor's signing primitive. |
237 | 
238 | Used by power users and by Bob when it wants to compose unusual flows. Each atomic tool is independently safe and idempotent.
239 | 
240 | ### 6.4 Read-only tools
241 | 
242 | | Tool | Purpose |
243 | | --- | --- |
244 | | `get_job_status` | Returns the FSM state and a summary. |
245 | | `get_audit_url` | Returns the signed audit URL for a job. |
246 | | `list_active_jobs` | For the current Bob session. |
247 | | `describe_breaking_change` | Returns one `BreakingChange` record with full provenance. |
248 | 
249 | Every tool's request and response is defined by a Zod schema. The schema doubles as the MCP JSON Schema advertisement and as the runtime validator. No tool handler receives unvalidated input.
250 | 
251 | ### 6.5 Elicitation pattern
252 | 
253 | Three tools (`propose_patch`, `generate_test_for`, `fetch_changelog`) may *elicit* from Bob's LLM mid-execution. This is the MCP elicitation/sampling pattern: the tool returns a request for the model to reason about a specific question, the model responds, the tool continues. This is how Renatus borrows Bob's intelligence for the genuinely hard sub-problems without taking on an LLM bill.
254 | 
255 | ---
256 | 
257 | ## 7. Layered architecture
258 | 
259 | The MCP server is structured as seven layers plus cross-cutting concerns. Each layer depends only on the layers below it. Tests can substitute any layer.
260 | 
261 | ```
262 |    ┌─────────────────────────────────────────────────────────────────┐
263 | 7. │ Transport            stdio adapter, HTTP/SSE adapter            │
264 |    ├─────────────────────────────────────────────────────────────────┤
265 | 6. │ Controllers          MCP tool handlers (one per tool)           │
266 |    ├─────────────────────────────────────────────────────────────────┤
267 | 5. │ Application services Migration orchestrator (FSM), session mgr  │
268 |    ├─────────────────────────────────────────────────────────────────┤
269 | 4. │ Domain services      Cartographer, Surgeon, Examiner, Auditor   │
270 |    │                      Retrieval, Indexing, Signing               │
271 |    ├─────────────────────────────────────────────────────────────────┤
272 | 3. │ Adapters             GitHub, watsonx, sandbox, embeddings, AST  │
273 |    ├─────────────────────────────────────────────────────────────────┤
274 | 2. │ Repositories         Drizzle (Postgres), Neo4j driver,          │
275 |    │                      Redis client, Blob client                  │
276 |    ├─────────────────────────────────────────────────────────────────┤
277 | 1. │ Data stores          Postgres + pgvector, Neo4j, Redis, Blob    │
278 |    └─────────────────────────────────────────────────────────────────┘
279 |    Cross-cutting: validation, auth, idempotency, audit trail,
280 |                   observability, rate-limiting, error mapping
281 | ```
282 | 
283 | ### 7.1 Transport layer
284 | 
285 | Two adapters:
286 | 
287 | - **stdio adapter** — for the npm-distributed package Bob runs locally. Speaks the MCP wire format over stdin/stdout. Single-process, lowest latency.
288 | - **HTTP/SSE adapter** — for the hosted demo. Built on Hono (fast, TypeScript-native, edge-runtime friendly). Same controllers, different I/O. SSE streams progress events to the companion web app.
289 | 
290 | A transport adapter does three things: deserialise an incoming MCP envelope into a typed request, route it to the right controller, serialise the response (including streaming partials).
291 | 
292 | ### 7.2 Controller layer
293 | 
294 | One handler per MCP tool. Each handler:
295 | 
296 | 1. Validates input through the tool's Zod schema. Invalid input returns an MCP `INVALID_PARAMS` error with the validator message.
297 | 2. Authenticates the caller (see §13).
298 | 3. Checks the idempotency cache. If this exact request was served in the last 24 hours, replay the cached response.
299 | 4. Logs the call into `tool_invocations` (the audit trail).
300 | 5. Calls the relevant application service.
301 | 6. Maps domain errors to MCP error codes.
302 | 7. Returns the response and writes the audit-trail close record.
303 | 
304 | The handler does not contain business logic. It is the seam between MCP and the rest of the system.
305 | 
306 | In TypeScript this looks like a thin function wrapped by a `withValidation`, `withAuth`, `withIdempotency`, and `withAudit` higher-order function chain — the moral equivalent of decorators in a framework that has them.
307 | 
308 | ### 7.3 Application service layer
309 | 
310 | Two main services:
311 | 
312 | - **Migration orchestrator** — owns the per-job state machine. The FSM transitions are:
313 | 
314 |   ```
315 |   draft → planning → planned → patching → patched →
316 |   testing → tested → auditing → audited → done
317 |                               ↘ failed (terminal)
318 |                               ↘ aborted (terminal)
319 |                               ↘ paused (resumable)
320 |   ```
321 | 
322 |   Each transition is a database transaction. Transitions enqueue the next worker job into BullMQ. Compensating transitions (rollback) are explicit, not implicit, so an aborted job leaves Postgres in a sensible state.
323 | 
324 | - **Session manager** — tracks the live MCP sessions, per-session rate limits, per-session active jobs, and the Bob task id (read from MCP transport metadata) so every audit_event row carries the originating Bob session.
325 | 
326 | ### 7.4 Domain service layer
327 | 
328 | The agents (Cartographer, Surgeon, Examiner, Auditor) plus three supporting services:
329 | 
330 | - **RetrievalService** — wraps Neo4j (structural traversal: imports, exports, calls, test references) and pgvector (semantic similarity over code chunk embeddings). Exposes one method, `retrieve(query, mode)`, where `mode` picks structural, semantic, or hybrid.
331 | - **IndexingService** — given a repo snapshot, parses files with the right AST tool (Tree-sitter for breadth, ts-morph for TypeScript precision), extracts symbols and references, writes them to Neo4j, computes embeddings via Granite Embeddings (or a local model), writes them to pgvector.
332 | - **SigningService** — manages per-job ed25519 keypairs (private key never leaves the MCP server's secret store; public key published in the audit report and on the companion web app). Signs canonicalised JSON. Verifies on demand.
333 | 
334 | Domain services are pure with respect to transport. They take typed inputs, talk only to adapters and repositories, and return typed outputs. They never know they are being called via MCP.
335 | 
336 | ### 7.5 Adapter layer
337 | 
338 | One adapter per external integration. Each adapter has an interface defined in the domain layer; the adapter implementation lives in this layer.
339 | 
340 | - **GitHubAdapter** — Octokit. Clone, fetch metadata, optionally open a pull request with the migration patches.
341 | - **WatsonxAdapter** — IBM watsonx.ai client. Used for two narrow purposes: (a) classification calls inside Cartographer when a changelog entry doesn't fit the schema cleanly, (b) embedding generation if the local model is too slow. Wrapped behind a `LlmClassifier` interface so the watsonx implementation can be swapped for a Granite Code or Llama variant without changes upstream.
342 | - **SandboxAdapter** — abstracts the ephemeral container runner. Vercel Sandbox is the default; e2b.dev or a local Docker fallback honour the same interface. Methods: `materialiseWorkspace(snapshotId)`, `applyPatches(patches[])`, `runCommand(cmd, timeout)`, `collectArtifacts(paths[])`, `destroy()`.
343 | - **AstAdapter** — wraps ts-morph, jscodeshift, libcst (Python), and rome/biome (formatting). Exposes a uniform "parse → query → transform → serialise" API. Each underlying engine is plug-in.
344 | - **EmbeddingsAdapter** — granite-embeddings or local. Batched, cached.
345 | 
346 | Every adapter has a deterministic fake for tests.
347 | 
348 | ### 7.6 Repository layer
349 | 
350 | Repositories are the only code that touches the data stores. The domain layer holds repository **interfaces**; this layer holds the Drizzle / Neo4j / Redis / Blob implementations.
351 | 
352 | | Repository | Stored data |
353 | | --- | --- |
354 | | `JobRepository` | jobs, FSM state, timing |
355 | | `BreakingChangeRepository` | Cartographer outputs |
356 | | `PatchRepository` | Surgeon outputs |
357 | | `GeneratedTestRepository` | Examiner outputs |
358 | | `AuditRepository` | Audit reports + signatures (append-only) |
359 | | `SnapshotRepository` | Repo snapshots (metadata in Postgres, blobs in Vercel Blob / R2) |
360 | | `KnowledgeGraphRepository` | Neo4j read/write |
361 | | `EmbeddingRepository` | pgvector read/write |
362 | | `SessionRepository` | mcp_sessions, tool_invocations |
363 | | `IdempotencyRepository` | Redis-backed |
364 | | `QueueRepository` | BullMQ wrapper |
365 | 
366 | Every repository method is transaction-aware: callers can pass an existing transaction handle so a multi-table mutation either fully commits or fully rolls back.
367 | 
368 | ### 7.7 Data layer
369 | 
370 | See §8 for the full data model.
371 | 
372 | ### 7.8 Cross-cutting concerns
373 | 
374 | These do not live in any single layer but are composed into the controller pipeline and the domain services.
375 | 
376 | | Concern | Mechanism |
377 | | --- | --- |
378 | | **Validation** | Zod schemas at the controller boundary and at every adapter interface. No untyped data crosses a layer. |
379 | | **Authentication** | MCP stdio: the local Bob session is trusted; the server runs in the same process tree. MCP HTTP: bearer token issued per-job, scoped to that job's resources. |
380 | | **Authorization** | A job token can read its own job, patches, tests, audit. It cannot read others. |
381 | | **Idempotency** | Every tool call carries an `idempotencyKey` (sha256 of canonicalised input + caller id). The first call executes; subsequent calls within 24h return the cached response. |
382 | | **Audit trail** | Append-only `audit_events` table. Every tool call, every FSM transition, every elicitation, every patch application writes a row. Rows reference the Bob session id. |
383 | | **Observability** | OpenTelemetry traces wrap every tool call and every agent step. Span attributes include job id, agent name, model used. Logs are structured (pino) and shipped to Axiom or BetterStack. |
384 | | **Rate limiting** | Per MCP session: max active jobs, max tool calls per minute, max tokens elicited per hour. Enforced at the controller layer. |
385 | | **Error mapping** | A central `toMcpError(domainError)` function maps every domain error type to an MCP error code with a stable string code consumers can match on. |
386 | | **Secrets** | All secrets read from environment at boot; nothing written to logs; nothing emitted into responses. `.bobignore` enforces this at the source level. |
387 | 
388 | ---
389 | 
390 | ## 8. Data model
391 | 
392 | ### 8.1 Postgres (Neon) + pgvector
393 | 
394 | Tables, append-only where flagged:
395 | 
396 | | Table | Purpose | Notes |
397 | | --- | --- | --- |
398 | | `users` | Hackathon judge accounts (later: real users) | Anonymous demo path uses session-only id |
399 | | `mcp_sessions` | One row per Bob ↔ Renatus session | Bob task id, started at, last seen, transport |
400 | | `tool_invocations` | Every MCP tool call | session id, tool name, input hash, response hash, duration, error code |
401 | | `jobs` | The migration job | session id, repo url, source/target spec, FSM state, started/ended timestamps |
402 | | `repo_snapshots` | A frozen view of the cloned repo | snapshot id, git sha, file count, total bytes, blob url |
403 | | `breaking_change_maps` | Cartographer outputs, keyed by `(ecosystem, source, target)` | Cached |
404 | | `breaking_changes` | Individual breaking-change rules within a map | category, severity, detection pattern, prescription |
405 | | `code_chunks` | Files split into semantic chunks for embedding | path, range, sha, language |
406 | | `embeddings` | pgvector column | code_chunk_id, vector(768) |
407 | | `patches` | Surgeon's outputs | job id, file path, before/after, applied rule ids, confidence, status |
408 | | `generated_tests` | Examiner's outputs | job id, target patch id, test file content, harness, status |
409 | | `audit_runs` | One per Auditor execution | job id, sandbox image, started, finished, baseline test results, regression test results, divergences |
410 | | `audit_signatures` | append-only | audit_run id, public key fingerprint, signature, signed bundle sha |
411 | | `audit_events` | append-only | event type, job id, session id, payload (jsonb), bob_task_id |
412 | | `elicitations` | Records of MCP elicitation calls | tool, prompt sent, response received, model claimed |
413 | | `signing_keys` | Per-job ed25519 keypairs | job id, public key, encrypted private key |
414 | 
415 | pgvector extension is enabled on the `embeddings.vector` column with an HNSW index on cosine distance. The vector dimensionality matches the embedding model in use (768 for granite-embeddings-30m-english).
416 | 
417 | ### 8.2 Neo4j (AuraDB)
418 | 
419 | Node labels and relationships:
420 | 
421 | ```
422 | (:File { snapshotId, path, language, sha })
423 | (:Symbol { name, kind, signature })
424 | (:Import { from, to, kind })
425 | (:Test { framework, file, target })
426 | (:BreakingChange { id })
427 | 
428 | (:File)-[:DECLARES]->(:Symbol)
429 | (:File)-[:IMPORTS { specifier }]->(:File)
430 | (:File)-[:REFERENCES]->(:Symbol)
431 | (:Test)-[:COVERS]->(:File)
432 | (:Test)-[:COVERS]->(:Symbol)
433 | (:BreakingChange)-[:AFFECTS]->(:Symbol)
434 | (:BreakingChange)-[:AFFECTS]->(:File)
435 | ```
436 | 
437 | Cypher queries Surgeon runs:
438 | 
439 | - "Every file transitively importing a symbol affected by any breaking change in map X."
440 | - "Every test covering a file we are about to patch — these need re-running."
441 | - "Strongly-connected import components — patch them as an atomic batch."
442 | 
443 | The graph is rebuilt fresh per snapshot. Snapshots are immutable.
444 | 
445 | ### 8.3 Redis (Upstash)
446 | 
447 | - **BullMQ queues**: `cartographer`, `surgeon`, `examiner`, `auditor`, plus a high-priority `orchestrator` queue.
448 | - **Idempotency cache**: keyed by `idempotencyKey`, value is the response JSON, 24h TTL.
449 | - **Session rate-limit counters**: rolling windows per session id.
450 | - **Job FSM lock**: a Redis lock prevents two workers transitioning the same job concurrently.
451 | 
452 | ### 8.4 Blob storage (Vercel Blob or Cloudflare R2)
453 | 
454 | - Raw cloned repo tarballs (snapshot_id → tarball).
455 | - Patch bundles (patch_batch_id → bundle).
456 | - Generated test bundles.
457 | - Audit reports rendered to HTML and PDF.
458 | - Sandbox artefacts (test logs, stack traces).
459 | 
460 | Blob URLs in Postgres are signed and short-lived. The companion web app re-signs on the fly when serving an audit page.
461 | 
462 | ---
463 | 
464 | ## 9. End-to-end migration flow
465 | 
466 | ```
467 | User                Bob                       MCP Server                  Workers                    Stores
468 |  │                   │                              │                          │                          │
469 |  │  /migrate react-19│                              │                          │                          │
470 |  ├──────────────────►│                              │                          │                          │
471 |  │                   │ load mode + skill            │                          │                          │
472 |  │                   │ plan with own LLM            │                          │                          │
473 |  │                   │ tool: migrate_repository     │                          │                          │
474 |  │                   ├─────────────────────────────►│                          │                          │
475 |  │                   │                              │ validate, auth, idem     │                          │
476 |  │                   │                              │ create job (DRAFT)       │                          │
477 |  │                   │                              ├─────────────────────────►│ enqueue: orchestrator    │
478 |  │                   │                              │ return { jobId, sse }    │                          │
479 |  │                   │◄─────────────────────────────┤                          │                          │
480 |  │                   │ stream SSE                   │                          │                          │
481 |  │                   │◄─────────────────────────────┤◄─────────────────────────┤ orchestrator: PLANNING   │
482 |  │                   │                              │                          │ enqueue: cartographer    │
483 |  │                   │                              │                          │ Cartographer runs        │
484 |  │                   │                              │                          │   fetches changelog      │
485 |  │                   │                              │                          │   elicits Bob on ambig.  │
486 |  │                   │                              │ elicitation request      │                          │
487 |  │                   │◄─────────────────────────────┤                          │                          │
488 |  │                   │ LLM answers                  │                          │                          │
489 |  │                   ├─────────────────────────────►│                          │                          │
490 |  │                   │                              │                          │   writes breaking_changes│
491 |  │                   │                              │                          │ orchestrator: PATCHING   │
492 |  │                   │                              │                          │ Surgeon                  │
493 |  │                   │                              │                          │   clones, indexes        │
494 |  │                   │                              │                          │   structural retrieval   │
495 |  │                   │                              │                          │   semantic retrieval     │
496 |  │                   │                              │                          │   runs codemods          │
497 |  │                   │                              │                          │   elicits on unresolved  │
498 |  │                   │                              │                          │   writes patches         │
499 |  │                   │                              │                          │ orchestrator: TESTING    │
500 |  │                   │                              │                          │ Examiner                 │
501 |  │                   │                              │                          │   generates tests        │
502 |  │                   │                              │                          │ orchestrator: AUDITING   │
503 |  │                   │                              │                          │ Auditor                  │
504 |  │                   │                              │                          │   sandbox up             │
505 |  │                   │                              │                          │   apply, install, run    │
506 |  │                   │                              │                          │   capture, sign          │
507 |  │                   │                              │                          │   writes audit_signatures│
508 |  │                   │                              │                          │ orchestrator: DONE       │
509 |  │                   │ stream final                 │                          │                          │
510 |  │                   │◄─────────────────────────────┤                          │                          │
511 |  │ "done — audit at  │                              │                          │                          │
512 |  │  audit/abc123"    │                              │                          │                          │
513 |  │◄──────────────────┤                              │                          │                          │
514 |  │ clicks URL                                                                                              │
515 |  │ ────────────────────────────────────────────────────────────►   companion web app: signed audit page   │
516 | ```
517 | 
518 | Each `orchestrator: STATE` transition is one Postgres transaction plus one BullMQ enqueue. The system survives any single worker dying — BullMQ will redeliver, the FSM is idempotent against re-entry into the current state, and every adapter call is wrapped with a retry policy.
519 | 
520 | ---
521 | 
522 | ## 10. Bob session integration & audit chain
523 | 
524 | This is the load-bearing detail for hackathon judging.
525 | 
526 | ### 10.1 What gets exported
527 | 
528 | Every Bob task that touches Renatus produces an export under `bob_sessions/`:
529 | 
530 | - Markdown export of the task history (`bob_sessions/<timestamp>__<surface>__<short-desc>.md`)
531 | - Screenshot of the task consumption summary (`bob_sessions/<timestamp>__<surface>__<short-desc>.png`)
532 | 
533 | Surfaces include `slash-migrate`, `mode-migration`, `skill-load`, and `mcp-tool-<tool-name>`.
534 | 
535 | ### 10.2 How Renatus ties exports back
536 | 
537 | When Bob calls an MCP tool, the MCP transport metadata carries a Bob task id. The controller layer reads it once and stamps it on:
538 | 
539 | - The `mcp_sessions.bob_task_id` row (one row per Bob task across all the tool calls inside it).
540 | - Every `audit_events.bob_task_id` written during that session.
541 | - The `AuditReport.bobSessionRefs` array — a list of every Bob task id that contributed to this job.
542 | 
543 | When the auditor signs the report, the signature covers the canonical JSON including `bobSessionRefs`. So tampering with which Bob sessions produced the migration breaks the signature.
544 | 
545 | ### 10.3 What the audit URL shows
546 | 
547 | On `companion/audit/<jobId>`:
548 | 
549 | - The signed report JSON (pretty-printed).
550 | - A signature verification widget — paste the public key, paste the JSON, hit Verify.
551 | - A list of Bob task ids with deep links to the corresponding `bob_sessions/<file>.md` in the repo (relative paths so they resolve when judges clone the repo locally).
552 | - A timeline of every tool call (from `tool_invocations`) interleaved with every elicitation.
553 | - The 3D codebase KG link.
554 | 
555 | A judge who opens the audit URL can verify, in one screen, that Bob did the work, what tools were called, and what changed.
556 | 
557 | ---
558 | 
559 | ## 11. Companion web app
560 | 
561 | A focused Next.js 16 App Router app. Not the product surface — just the artefact host.
562 | 
563 | ### 11.1 Routes
564 | 
565 | | Route | Rendering | Purpose |
566 | | --- | --- | --- |
567 | | `/` | RSC static | Landing: what is Renatus, install instructions, public key, GitHub link |
568 | | `/audit/[jobId]` | RSC + small client island | Signed audit report (see §10.3) |
569 | | `/kg/[jobId]` | client only, dynamic import | 3D codebase knowledge graph, React Three Fiber + react-force-graph-3d |
570 | | `/jobs/[jobId]/live` | client + EventSource | Live SSE feed of orchestrator state transitions, for demos |
571 | | `/verify` | client only | Paste a signed report and the public key, verify the signature client-side |
572 | | `/api/audit/[jobId]/sign-url` | route handler | Issue a short-lived signed URL for the audit blob |
573 | 
574 | ### 11.2 3D knowledge graph rendering
575 | 
576 | Nodes are files. Node size = lines of code. Node colour by category of breaking change touching it (red = high-severity rule, amber = mid, green = unchanged). Edges are imports. The migration animation pulses each affected file in the order Surgeon patched it.
577 | 
578 | Built with `react-force-graph-3d` on top of three.js. Camera controls, hover tooltips, keyboard navigation, screenshot export. Mobile-degraded to a 2D fallback.
579 | 
580 | ### 11.3 Why this exists in the design at all
581 | 
582 | Two reasons. First, it gives the audit a permanent home — the report URL outlives the demo. Second, the KG is the visual centrepiece of the 90-second demo; migrations don't demo well as text, but a pulsing 3D graph of "here's everything Surgeon touched" does.
583 | 
584 | ---
585 | 
586 | ## 12. Deployment topology
587 | 
588 | | Component | Where it runs | Why |
589 | | --- | --- | --- |
590 | | **MCP server (stdio)** | npm package, executed locally by Bob via `npx -y @renatus/mcp` | Lowest latency for the user's primary workflow |
591 | | **MCP server (HTTP/SSE)** | Hosted on Fly.io or Railway, persistent container | Required for the companion web app's SSE stream and for remote/judge demos |
592 | | **Workers (BullMQ consumers)** | Same container as the HTTP MCP server, on a dedicated worker pool | One process, multiple worker classes |
593 | | **Companion web app** | Vercel | Edge-rendered marketing + dynamic audit pages |
594 | | **Postgres + pgvector** | Neon | Managed, branchable for demos |
595 | | **Neo4j** | AuraDB free tier | Managed, sufficient for demo-scale graphs |
596 | | **Redis** | Upstash | Managed, generous free tier |
597 | | **Blob storage** | Vercel Blob (or Cloudflare R2 if cost spikes) | Same vendor surface as the web app |
598 | | **Sandbox runtime** | Vercel Sandbox (or e2b.dev) | Per-job ephemeral, billed per second |
599 | 
600 | Single-region deployment to start (us-east-1 / iad1). The MCP server and the web app share the same Postgres so audit data is the single source of truth.
601 | 
602 | ### 12.1 Why a hosted MCP server at all
603 | 
604 | The npm/stdio path is the production path for end users. The hosted HTTP path exists for two reasons:
605 | 
606 | 1. **Demo reliability** — judges installing the npm package live on stage is fragile. A hosted endpoint they can hit with one config line de-risks the demo.
607 | 2. **Companion web app** — the SSE progress feed has to come from somewhere persistent.
608 | 
609 | Both transports run the exact same code. Only the transport adapter differs.
610 | 
611 | ---
612 | 
613 | ## 13. Security & governance
614 | 
615 | ### 13.1 Trust model
616 | 
617 | | Principal | What they can do |
618 | | --- | --- |
619 | | Local user running stdio MCP | Full access to their own jobs in their workspace |
620 | | Hosted user (per-job token) | Read/write their own job's resources; read their own audit; no cross-job visibility |
621 | | Anonymous web visitor | Read any audit by jobId (audit URLs are unguessable + expirable) |
622 | | Renatus admin | Full access (for support); audited |
623 | 
624 | ### 13.2 Secrets
625 | 
626 | - Loaded from environment at boot. Never logged. Never echoed in responses.
627 | - `.bobignore` excludes any path matching `.env*`, `secrets/`, `*.key`, `config/credentials.json` from Bob's read scope. Enforced by check-in commit hook.
628 | - ed25519 private keys are encrypted at rest with a server-wide KEK held in the platform secret store (Fly.io / Vercel). Decrypted only inside SigningService.
629 | 
630 | ### 13.3 Sandbox isolation
631 | 
632 | - Every Auditor run gets a fresh container.
633 | - No network egress except to the package registry, on an allow-list.
634 | - Filesystem is read-only except for `/workspace` and `/tmp`.
635 | - 10-minute hard wall-clock limit.
636 | - All process output captured to blob and into `audit_runs`.
637 | 
638 | ### 13.4 Patch safety
639 | 
640 | - Patches apply only inside the per-job scratch workspace, never to the user's working tree.
641 | - A `discard_migration` call deletes the workspace.
642 | - The user has to explicitly export the migrated branch with `materialise_branch`; until then nothing touches their checkout.
643 | 
644 | ### 13.5 Hackathon-specific governance
645 | 
646 | - `bob_sessions/` is read-only via convention and `.gitattributes`; modifications generate a CI warning.
647 | - The repo's pre-push hook runs a secret-scan over `bob_sessions/*.md` exports — IBM's security team deactivates accounts that leak credentials to a public repo (hackathon guide p.20), so this is non-negotiable.
648 | - The Cartographer output cache is keyed by source URL; if a source URL no longer resolves, the cache entry is invalidated so we never serve stale prescriptions.
649 | 
650 | ---
651 | 
652 | ## 14. Performance, scaling, and concurrency
653 | 
654 | ### 14.1 Within a single job
655 | 
656 | - Cartographer is mostly I/O. Parallelise changelog fetches.
657 | - Indexing is CPU-bound on AST parsing. Worker concurrency = available CPUs.
658 | - Surgeon patches files in parallel where their import subgraphs are independent (computed from Neo4j). Dependent files are batched.
659 | - Examiner generates tests in parallel per file.
660 | - Auditor is sequential by necessity (one sandbox, one run).
661 | 
662 | ### 14.2 Across jobs
663 | 
664 | - BullMQ workers scale horizontally. Heuristic concurrency: 4 cartographer, 8 surgeon, 8 examiner, 2 auditor (sandboxes are expensive).
665 | - Neo4j writes are serialised per snapshot via a Redis lock keyed by snapshotId.
666 | - pgvector writes are batched (100-row inserts).
667 | 
668 | ### 14.3 Cache strategy
669 | 
670 | - Cartographer's `BreakingChangeMap` is fully cached. Demo of React 18→19 is instant after the first user.
671 | - IndexingService caches per `(snapshotId, fileSha)`. Re-indexing a tweaked branch only re-parses the changed files.
672 | - Embeddings cached per `code_chunk.sha`.
673 | - Idempotency cache absorbs Bob's natural retry pattern.
674 | 
675 | ### 14.4 Hot path budgets
676 | 
677 | - MCP `migrate_repository` returns within 300 ms (just enqueues).
678 | - First SSE event within 1 s.
679 | - End-to-end migration for the demo target (~50 files, React 18→19): target 6 minutes; hard ceiling 15 minutes.
680 | 
681 | ---
682 | 
683 | ## 15. Failure modes and recovery
684 | 
685 | | Failure | Detection | Recovery |
686 | | --- | --- | --- |
687 | | Worker crashes mid-step | BullMQ heartbeat | Redeliver up to 3 times with exponential backoff |
688 | | Sandbox container dies | Auditor non-zero exit + timeout | Re-create sandbox, re-run; on 2nd failure mark `failed` with diagnostics |
689 | | Cartographer source unreachable | HTTP error | Try alternate source from the curated registry; if all fail, emit `partial-map` and require elicitation |
690 | | Surgeon's codemod fails on a site | Local exception in the AST transform | Emit `unresolved` patch; elicit Bob's LLM for that site |
691 | | Examiner cannot make test pass | Test runs but asserts fail | Lower patch confidence; flag for human review in audit |
692 | | pgvector index corruption | Periodic integrity check | Rebuild index (a 30s op) |
693 | | Neo4j connection lost | Driver error | Retry with backoff; if persistent, pause affected jobs |
694 | | Audit signing key compromise | Manual or alert | Rotate per-job keys are isolated; re-sign or revoke individual audits |
695 | | MCP elicitation timeout (Bob unresponsive) | 30s timeout | Mark site `unresolved`, continue; surface in audit |
696 | 
697 | The orchestrator is the single point that decides what state to put a failed job into. Workers never set terminal states directly.
698 | 
699 | ---
700 | 
701 | ## 16. Observability
702 | 
703 | - **Traces** — OpenTelemetry. Every tool call is a root span. Every agent step is a child span. Every adapter call is a leaf span. Exported to Axiom or Honeycomb.
704 | - **Metrics** — RED (rate, errors, duration) per tool. Per-agent throughput. Sandbox seconds consumed. Embeddings tokens consumed. watsonx classification calls.
705 | - **Logs** — structured (pino), one log line per significant event, correlation id = job id. Shipped to Axiom.
706 | - **Live dashboard** — for the demo: a Grafana board showing the live SSE feed translated into a job pipeline view, on a second monitor.
707 | - **Audit replay** — `audit_events` is the highest-fidelity trace. Any past job can be replayed for inspection by reading rows in order.
708 | 
709 | ---
710 | 
711 | ## 17. Demo strategy
712 | 
713 | The migration is the artefact; the demo is the experience. Plan the 90 seconds first.
714 | 
715 | ### 17.1 The 90-second arc
716 | 
717 | | Second | Beat |
718 | | --- | --- |
719 | | 0–8 | Open Bob in a real OSS React 18 repo. Type `/migrate react-19`. |
720 | | 8–20 | Bob's chat narrates the plan it just read from Renatus's `plan_migration` tool. Visible: a list of breaking changes Cartographer mapped. |
721 | | 20–45 | The companion web app's 3D KG opens on a second screen. Files pulse red as Surgeon patches them. (This is the visual hero.) |
722 | | 45–70 | Auditor's sandbox runs. Terminal output streams. Tests turn green. |
723 | | 70–82 | Audit URL pops up in Bob's chat. Click. Signed report renders. Pan over the signature. |
724 | | 82–90 | Hover the 3D KG. Land on the closing line: "Six minutes. Forty-seven files. Signed." |
725 | 
726 | ### 17.2 Backup plan
727 | 
728 | - Pre-record the full flow as a 60-second screen capture at the highest possible quality.
729 | - During the live attempt, if any step exceeds its time budget by 50%, fall back to the recording without breaking eye contact.
730 | - The audit URL from the pre-recorded run is permanent and clickable; judges can verify after.
731 | 
732 | ### 17.3 Target repository
733 | 
734 | Primary: a real OSS React 18 codebase with ~50 source files, full test suite, no exotic build tooling. Two backups pre-staged. All three pre-migrated in `bob_sessions/` so the demo runs against a clean re-execution.
735 | 
736 | ---
737 | 
738 | ## 18. 48-hour build SOP
739 | 
740 | The SOP exists to make scope decisions in advance. Build in waves; each wave is a checkpoint where we ship-or-cut.
741 | 
742 | ### 18.1 Hour 0–4 — foundation
743 | 
744 | - Repo skeleton (monorepo, pnpm workspaces, Turbo, shared TS config, Drizzle workspace).
745 | - MCP server skeleton: stdio transport, one no-op tool, end-to-end "Bob can talk to us."
746 | - Postgres up, basic `jobs` + `tool_invocations` schemas.
747 | - `bob_sessions/` discipline: every Bob task exported the moment it ends.
748 | 
749 | **Checkpoint:** Bob can call a Renatus MCP tool and we log it. If we miss this, the project is in trouble.
750 | 
751 | ### 18.2 Hour 4–12 — Surgeon end-to-end on a trivial migration
752 | 
753 | - Cartographer minimal: hardcoded React 18→19 breaking-change map (skip live fetching).
754 | - Indexing minimal: file list + ts-morph imports only (no embeddings, no Neo4j yet).
755 | - Surgeon minimal: one codemod (the `useEffect` cleanup-return-undefined rule).
756 | - Apply patch to scratch workspace, return as MCP response.
757 | - Slash command + custom mode + skill scaffolded (markdown files only).
758 | 
759 | **Checkpoint:** `/migrate react-19` on a tiny repo produces a working patch. If we miss this, fall back to "Test Crew" pivot — but that decision is made HERE, not later.
760 | 
761 | ### 18.3 Hour 12–24 — depth
762 | 
763 | - Neo4j integration: structural retrieval.
764 | - pgvector + embeddings: semantic retrieval.
765 | - Surgeon scales to ~5 codemod rules.
766 | - Examiner v1: generate snapshot-style regression tests for each patched file.
767 | - Auditor v1: apply patches, run tests in Vercel Sandbox, capture results.
768 | - Audit signing wired up. End-to-end now returns a signed report JSON.
769 | 
770 | **Checkpoint:** A real OSS React 18 repo migrates end-to-end, green. If we miss this, cut Neo4j or embeddings (one of them), not both.
771 | 
772 | ### 18.4 Hour 24–36 — the experience
773 | 
774 | - Companion web app deployed.
775 | - `/audit/[jobId]` renders the signed report.
776 | - `/kg/[jobId]` renders the 3D graph.
777 | - SSE progress feed live.
778 | - Cartographer caching and a second migration target (Tailwind 3→4) wired up.
779 | 
780 | **Checkpoint:** Demo runs end-to-end against the primary target repo in ≤10 minutes. If not, cut the second migration target.
781 | 
782 | ### 18.5 Hour 36–44 — polish + demo prep
783 | 
784 | - Pre-record the demo. Twice.
785 | - Run the demo 5 times start to finish. Time every iteration.
786 | - Write the README install snippet. Verify it works on a fresh machine.
787 | - Walk through `bob_sessions/` and make sure every export is clean (no secrets, descriptive filenames).
788 | - Commit, push, double-check the public repo renders.
789 | 
790 | ### 18.6 Hour 44–48 — submission
791 | 
792 | - Cover image. Video presentation. Slide presentation.
793 | - Submission form on lablab.ai.
794 | - Verify the demo URL is up.
795 | - Sleep before judging.
796 | 
797 | ---
798 | 
799 | ## 19. Open risks & decisions
800 | 
801 | | Risk / open question | Mitigation / decision deadline |
802 | | --- | --- |
803 | | Vercel Sandbox quota during 48h burst | Pre-check quotas before hour 12; have e2b.dev fallback wired |
804 | | Bob's MCP elicitation latency | Tested at hour 4; if >5s round-trip on average, restructure to avoid mid-pipeline elicitation |
805 | | 3D KG performance on the demo repo | If frame rate drops below 30fps on a 200-node graph, downgrade to 2D viz |
806 | | watsonx Granite credits actually arriving on time | Decouple — internal classifier defaults to a local model; Granite is a swap-in if credits land |
807 | | Audit signing key management on Vercel | Use Vercel Environment Variables (encrypted) for the KEK; per-job keys stored encrypted in Postgres |
808 | | Demo repo not migrating cleanly | Pre-stage 3 candidates; commit "known-good" baseline runs to `bob_sessions/` before stage |
809 | | Judges asking "why MCP not Bob skill" | Section §3 of this doc is the answer, with PDF page references |
810 | 
811 | ---
812 | 
813 | ## Appendix A — terminology
814 | 
815 | - **Snapshot** — an immutable, content-addressed copy of a repo at a specific git sha.
816 | - **Job** — one execution of the migration pipeline against one snapshot for one target.
817 | - **Patch** — a single file-level transformation produced by Surgeon.
818 | - **Patch batch** — all patches for a job.
819 | - **Audit run** — one Auditor execution against one patch batch.
820 | - **Elicitation** — a mid-tool callback to Bob's LLM via MCP, to borrow its reasoning for a hard sub-question.
821 | - **Surface** — one of the four Bob extension types Renatus occupies (slash command, mode, skill, MCP server).
822 | 
823 | ## Appendix B — relationships to external standards
824 | 
825 | - **MCP** — Renatus is a strict implementer of the Model Context Protocol spec, including tools, resources (audit reports are MCP resources), and elicitation.
826 | - **Conventional Commits** — Renatus's generated migration commits follow the convention so they integrate with downstream changelog tooling.
827 | - **SLSA provenance** — the signed audit report adopts SLSA-like provenance shape so it's recognisable to enterprises already running supply-chain attestations.
828 | - **OpenTelemetry** — traces and metrics emit standard names; no custom convention.
829 | 
830 | ## Appendix C — what is intentionally NOT in scope for the 48 hours
831 | 
832 | - Multi-language support beyond JS/TS for the demo (Python codemods designed but not implemented).
833 | - Authentication beyond per-job tokens (no Auth0 / Clerk integration).
834 | - A general "ChatOps" surface (Slack / Discord bots).
835 | - Pull-request automation beyond branch materialisation.
836 | - Plan-mode pricing / billing.
837 | 
838 | These are post-hackathon work. The system is designed so they slot in without rework.
839 | 
840 | ---
841 | 
842 | *End of system design.*

</file_content>
<environment_details>
# VSCode Visible Files


# VSCode Open Tabs


# Current Time
Current time in ISO 8601 UTC format: 2026-05-16T10:04:43.962Z
User time zone: Asia/Calcutta, UTC+5:30

# Current Cost
$0.00

# Review Exclusions
The following file patterns are excluded from code reviews:
- .vscode/**
- .env
- .env.*
- secrets/
- *.key
- *.pem
- *.p12
- *.crt
- config/credentials.json
- .next/
- node_modules/
- dist/
- build/
- .turbo/
- coverage/
- .DS_Store
- bob_sessions/

# Current Mode
<slug>plan</slug>
<name>📝 Plan</name>


# Current Workspace Directory (/Users/thisisaman408/Downloads/hackathons/renatus) Files
.gitignore
AGENTS.md
LICENSE
README.md
SYSTEM-DESIGN.md
.claude/
bob_sessions/
You have not created a todo list yet. Create one with `update_todo_list` if your task is complicated or involves multiple steps.
</environment_details>

---

**Assistant:**

I've read through your comprehensive system design for Renatus. This is an exceptionally well-architected multi-agent code migration system built for the IBM Bob Hackathon. Let me gather some additional context about your current project state and then create a detailed implementation plan.

<read_file>
<args>
  <file>
    <path>README.md</path>
  </file>
  <file>
    <path>AGENTS.md</path>
  </file>
  <file>
    <path>.gitignore</path>
  </file>
</args>
</read_file>

---

**User:**

[read_file for 'README.md', 'AGENTS.md', '.gitignore'] Result:
<files>
<file><path>README.md</path>
<content lines="1-43">
 1 | # Renatus
 2 | 
 3 | > Multi-agent code migration crew, orchestrated by IBM Bob. Drop in a repository, pick a target version (React 18 → 19, Python 3.10 → 3.12, Tailwind 3 → 4, Drizzle 0.x → 1.0). Renatus's four specialist agents read the upstream breaking-change catalog, your full repo, generate the migration patches, write regression tests, and produce a signed audit report — all in minutes, not weeks.
 4 | 
 5 | Built for the **IBM Bob Hackathon — Build on Bob (BoB)**, May 15–17, 2026.
 6 | 
 7 | ## Why Bob is the unlock
 8 | 
 9 | Cross-version migrations require **whole-codebase understanding**, not just diff hunks. A `useEffect` cleanup change in React 18 → 19 can cascade through hundreds of files. Bob's repository-context reading is the only LLM partner capable of reasoning across the entire system at once. Renatus is built around that capability — it cannot exist without Bob.
10 | 
11 | Every agent in Renatus opens a Bob task. Every task is exported to [`bob_sessions/`](./bob_sessions) for judging.
12 | 
13 | ## The four agents
14 | 
15 | | Agent | Role | Bob's contribution |
16 | |---|---|---|
17 | | **Cartographer** | Reads upstream changelog + breaking-change docs, builds a structured map of every API surface that changed | Bob structures the docs into a knowledge graph |
18 | | **Surgeon** | Reads YOUR full repo via Bob's repo context, identifies every file touched by a breaking change, generates migration patches | Bob's full-repo reading is the engine |
19 | | **Examiner** | Generates regression tests for every migrated file, capturing before-and-after behavior | Bob reads test patterns from the existing suite |
20 | | **Auditor** | Runs migrated code against tests, reports deviations, exports a signed audit report including Bob's session log | Bob's session log itself is the audit evidence |
21 | 
22 | ## Status
23 | 
24 | In active development. The full system design is in [`SYSTEM-DESIGN.md`](./SYSTEM-DESIGN.md) (2,400 lines: architecture, Drizzle schemas, Neo4j codebase graph, agent prompts, the hour-by-hour 48-hour SOP, demo script, and 3 primary + 2 backup target GitHub repos pre-picked).
25 | 
26 | ## Tech stack
27 | 
28 | - Next.js 16 App Router (TypeScript strict)
29 | - Tailwind CSS v4 + shadcn/ui
30 | - Drizzle ORM + Neon Postgres
31 | - Neo4j AuraDB (codebase knowledge graph)
32 | - BullMQ on Upstash Redis (parallel agent queue)
33 | - React Three Fiber + `react-force-graph` (3D KG)
34 | - Deployed on Vercel
35 | - **IBM Bob IDE** as the orchestrator and runtime intelligence
36 | 
37 | ## Run it yourself
38 | 
39 | (populated as the project lands)
40 | 
41 | ## License
42 | 
43 | MIT — see [LICENSE](./LICENSE).
</content>
</file>
<file><path>AGENTS.md</path>
<content lines="1-58">
 1 | # Renatus — project context for IBM Bob
 2 | 
 3 | This file gives Bob persistent project context across conversations and modes. Run `/init` from Bob IDE to refresh or extend it as the project evolves.
 4 | 
 5 | ## What we are building
 6 | 
 7 | Renatus is a **multi-agent code migration crew** orchestrated by IBM Bob. Given a repository and a target version (React 18 → 19, Python 3.10 → 3.12, Tailwind 3 → 4, Drizzle 0.x → 1.0, etc.), Renatus migrates the codebase end-to-end with regression tests and a signed audit trail.
 8 | 
 9 | The product is unique among IBM Bob Hackathon submissions because it exploits Bob's single biggest superpower — **whole-repo context reading** — to solve a problem (cross-version migration) that other LLMs cannot solve well, because they only see diff hunks.
10 | 
11 | ## The 4 agents
12 | 
13 | | Agent | Folder | Role |
14 | |---|---|---|
15 | | Cartographer | `agents/cartographer/` | Reads upstream changelog + breaking-change docs; builds the breaking-change map |
16 | | Surgeon | `agents/surgeon/` | Reads YOUR full repo via Bob; identifies affected files; generates migration patches |
17 | | Examiner | `agents/examiner/` | Generates regression tests for every migrated file (before/after fixtures) |
18 | | Auditor | `agents/auditor/` | Runs migrated code against tests; produces signed audit report including Bob's session log |
19 | 
20 | The orchestrator lives in `agents/_orchestrator/` and is a Bob session itself.
21 | 
22 | ## Tech stack
23 | 
24 | - Next.js 16 App Router (TypeScript, strict mode)
25 | - Tailwind CSS v4 + shadcn/ui
26 | - Drizzle ORM + Neon Postgres (job + audit state)
27 | - Neo4j AuraDB (codebase knowledge graph)
28 | - BullMQ on Upstash Redis (agent work queue)
29 | - React Three Fiber + `react-force-graph` (3D KG visualization)
30 | - Octokit for GitHub repo cloning
31 | - Deployed on Vercel
32 | - IBM Bob IDE = orchestrator + runtime intelligence
33 | 
34 | ## Code conventions
35 | 
36 | - TypeScript strict. Never `any` without a `// rationale:` comment.
37 | - File paths are kebab-case (`agents/cartographer/index.ts`).
38 | - All Drizzle schemas live in `db/schema/*.ts`, one file per table.
39 | - Agent inputs/outputs are typed with Zod.
40 | - Server-only modules import `"server-only"` at the top.
41 | - No secrets in code. `.bobignore` is the source of truth on what Bob must never see.
42 | 
43 | ## Repo invariants (do not break)
44 | 
45 | 1. The folder `bob_sessions/` at the repo root is **mandatory for hackathon judging**. Never delete it. Add new exported session reports there, never anywhere else.
46 | 2. `SYSTEM-DESIGN.md` is the spec. If implementation diverges, update the doc in the same commit.
47 | 3. Every agent run writes an `audit_event` row. Audit append-only, never UPDATE.
48 | 
49 | ## Demo target repos (pre-picked)
50 | 
51 | See `SYSTEM-DESIGN.md` §17. Primary live-demo target: a real OSS React 18 codebase to be migrated to React 19 on stage in 90 seconds.
52 | 
53 | ## What Bob should NOT do in this project
54 | 
55 | - Do not edit anything in `bob_sessions/` (read-only audit folder)
56 | - Do not modify `.bobignore` without a documented reason
57 | - Do not commit on Bob's behalf without showing the diff first
58 | - Do not call out to external LLMs other than where the architecture explicitly says so
</content>
</file>
<file><path>.gitignore</path>
<content lines="1-56">
 1 | # dependencies
 2 | node_modules/
 3 | .pnpm-store/
 4 | 
 5 | # next.js
 6 | .next/
 7 | out/
 8 | build/
 9 | dist/
10 | 
11 | # environment
12 | .env
13 | .env.local
14 | .env.development.local
15 | .env.test.local
16 | .env.production.local
17 | .env*.local
18 | 
19 | # OS
20 | .DS_Store
21 | Thumbs.db
22 | 
23 | # logs
24 | *.log
25 | npm-debug.log*
26 | yarn-debug.log*
27 | yarn-error.log*
28 | pnpm-debug.log*
29 | 
30 | # editor
31 | .vscode/
32 | .idea/
33 | *.swp
34 | *.swo
35 | 
36 | # turbo
37 | .turbo/
38 | 
39 | # typescript
40 | *.tsbuildinfo
41 | next-env.d.ts
42 | 
43 | # vercel
44 | .vercel/
45 | 
46 | # drizzle
47 | drizzle/.snapshot
48 | drizzle/meta/_journal.json.bak
49 | 
50 | # temporary
51 | tmp/
52 | .cache/
53 | 
54 | # coverage
55 | coverage/
56 | .nyc_output/
</content>
</file>
</files>
<environment_details>
# VSCode Visible Files


# VSCode Open Tabs


# Current Time
Current time in ISO 8601 UTC format: 2026-05-16T10:04:56.086Z
User time zone: Asia/Calcutta, UTC+5:30

# Current Cost
$0.07

# Review Exclusions
The following file patterns are excluded from code reviews:
- .vscode/**
- .env
- .env.*
- secrets/
- *.key
- *.pem
- *.p12
- *.crt
- config/credentials.json
- .next/
- node_modules/
- dist/
- build/
- .turbo/
- coverage/
- .DS_Store
- bob_sessions/

# Current Mode
<slug>plan</slug>
<name>📝 Plan</name>
You have not created a todo list yet. Create one with `update_todo_list` if your task is complicated or involves multiple steps.
</environment_details>

---

**Assistant:**

<list_files>
<args>
<path>.</path>
<recursive>true</recursive>
</args>
</list_files>

---

**User:**

[list_files for 'undefined'] Result:
The tool execution failed with the following error:
<error>
Missing value for required parameter 'path'. Please retry with complete response.

# Reminder: Instructions for Tool Use

Tool uses are formatted using XML-style tags. The tool name itself becomes the XML tag name. Each parameter is enclosed within its own set of tags. Here's the structure:

<actual_tool_name>
<parameter1_name>value1</parameter1_name>
<parameter2_name>value2</parameter2_name>
...
</actual_tool_name>

For example, to use the attempt_completion tool:

<attempt_completion>
<result>
I have completed the task...
</result>
</attempt_completion>

Always use the actual tool name as the XML tag name for proper parsing and execution.
</error>
<environment_details>
# VSCode Visible Files


# VSCode Open Tabs


# Current Time
Current time in ISO 8601 UTC format: 2026-05-16T10:04:59.637Z
User time zone: Asia/Calcutta, UTC+5:30

# Current Cost
$0.15

# Review Exclusions
The following file patterns are excluded from code reviews:
- .vscode/**
- .env
- .env.*
- secrets/
- *.key
- *.pem
- *.p12
- *.crt
- config/credentials.json
- .next/
- node_modules/
- dist/
- build/
- .turbo/
- coverage/
- .DS_Store
- bob_sessions/

# Current Mode
<slug>plan</slug>
<name>📝 Plan</name>
You have not created a todo list yet. Create one with `update_todo_list` if your task is complicated or involves multiple steps.
</environment_details>

---

**Assistant:**

<list_files>
<path>.</path>
<recursive>true</recursive>
</list_files>

---

**User:**

[list_files for '.'] Result:
.gitignore
🛡️ AGENTS.md
LICENSE
README.md
SYSTEM-DESIGN.md
.claude/
bob_sessions/
<environment_details>
# VSCode Visible Files


# VSCode Open Tabs


# Current Time
Current time in ISO 8601 UTC format: 2026-05-16T10:05:08.379Z
User time zone: Asia/Calcutta, UTC+5:30

# Current Cost
$0.24

# Review Exclusions
The following file patterns are excluded from code reviews:
- .vscode/**
- .env
- .env.*
- secrets/
- *.key
- *.pem
- *.p12
- *.crt
- config/credentials.json
- .next/
- node_modules/
- dist/
- build/
- .turbo/
- coverage/
- .DS_Store
- bob_sessions/

# Current Mode
<slug>plan</slug>
<name>📝 Plan</name>
You have not created a todo list yet. Create one with `update_todo_list` if your task is complicated or involves multiple steps.
</environment_details>

---

**Assistant:**

<ask_followup_question>
<question>I've reviewed your comprehensive system design for Renatus. This is an ambitious 48-hour hackathon build with a well-architected multi-agent migration system. Before creating the implementation plan, I need to understand your current priorities:

What would you like me to help you plan first?</question>
<follow_up>
<suggest>Create a complete 48-hour implementation roadmap following the SOP in §18, with hour-by-hour checkpoints and fallback decisions</suggest>
<suggest>Focus on the foundation phase (Hour 0-4): repo structure, MCP server skeleton, database setup, and Bob integration basics</suggest>
<suggest>Design the detailed technical architecture for the four agents (Cartographer, Surgeon, Examiner, Auditor) with their interfaces, data flows, and Zod schemas</suggest>
<suggest>Plan the companion web app structure: routes, components, 3D KG visualization, and audit report rendering</suggest>
</follow_up>
</ask_followup_question>

---

**User:**

[ask_followup_question for 'I've reviewed your comprehensive system design for Renatus. This is an ambitious 48-hour hackathon build with a well-architected multi-agent migration system. Before creating the implementation plan, I need to understand your current priorities:

What would you like me to help you plan first?'] Result:
<answer>
Design the detailed technical architecture for the four agents (Cartographer, Surgeon, Examiner, Auditor) with their interfaces, data flows, and Zod schemas
</answer>


New instructions for task continuation:
<user_message>
Create a complete 48-hour implementation roadmap following the SOP in §18, with hour-by-hour checkpoints and fallback decisions
</user_message>
<environment_details>
# VSCode Visible Files


# VSCode Open Tabs


# Current Time
Current time in ISO 8601 UTC format: 2026-05-16T10:06:21.916Z
User time zone: Asia/Calcutta, UTC+5:30

# Current Cost
$0.32

# Review Exclusions
The following file patterns are excluded from code reviews:
- .vscode/**
- .env
- .env.*
- secrets/
- *.key
- *.pem
- *.p12
- *.crt
- config/credentials.json
- .next/
- node_modules/
- dist/
- build/
- .turbo/
- coverage/
- .DS_Store
- bob_sessions/

# Current Mode
<slug>plan</slug>
<name>📝 Plan</name>


# Current Workspace Directory (/Users/thisisaman408/Downloads/hackathons/renatus) Files
.gitignore
AGENTS.md
LICENSE
README.md
SYSTEM-DESIGN.md
.claude/
bob_sessions/
====

REMINDERS

Below is your current list of reminders for this task. Keep them updated as you progress.

| # | Content | Status |
|---|---------|--------|
| 1 | Analyze system design requirements for agent architecture | In Progress |
| 2 | Define core domain types and shared Zod schemas | Pending |
| 3 | Design Cartographer agent architecture (input/output contracts, workflow, data model) | Pending |
| 4 | Design Surgeon agent architecture (retrieval strategies, codemod pipeline, patch generation) | Pending |
| 5 | Design Examiner agent architecture (test generation | Pending |


IMPORTANT: When task status changes, remember to call the `update_todo_list` tool to update your progress.

</environment_details>

---

**Assistant:**

Perfect! I'll create a comprehensive 48-hour implementation roadmap with detailed hour-by-hour checkpoints, fallback decisions, and the technical architecture for all four agents. Let me start by creating the detailed plan.

<update_todo_list>
<todos>
[-] Analyze system design and create implementation roadmap structure
[ ] Define Hour 0-4: Foundation phase with repo skeleton, MCP server, and database setup
[ ] Define Hour 4-12: Surgeon end-to-end on trivial migration with minimal Cartographer
[ ] Define Hour 12-24: Add depth - Neo4j, pgvector, full agent implementations
[ ] Define Hour 24-36: Build companion web app and demo experience
[ ] Define Hour 36-44: Polish, demo prep, and testing
[ ] Define Hour 44-48: Submission and final verification
[ ] Design detailed agent architectures with Zod schemas and interfaces
[ ] Create fallback decision matrix for each checkpoint
[ ] Define critical path dependencies and parallel work streams
</todos>
</update_todo_list>

---

**User:**

[update_todo_list] Result:
Todo list updated successfully.
<environment_details>
# VSCode Visible Files


# VSCode Open Tabs


# Current Time
Current time in ISO 8601 UTC format: 2026-05-16T10:31:20.684Z
User time zone: Asia/Calcutta, UTC+5:30

# Current Cost
$0.40

# Review Exclusions
The following file patterns are excluded from code reviews:
- .vscode/**
- .env
- .env.*
- secrets/
- *.key
- *.pem
- *.p12
- *.crt
- config/credentials.json
- .next/
- node_modules/
- dist/
- build/
- .turbo/
- coverage/
- .DS_Store
- bob_sessions/

# Current Mode
<slug>plan</slug>
<name>📝 Plan</name>
====

REMINDERS

Below is your current list of reminders for this task. Keep them updated as you progress.

| # | Content | Status |
|---|---------|--------|
| 1 | Analyze system design and create implementation roadmap structure | In Progress |
| 2 | Define Hour 0-4: Foundation phase with repo skeleton, MCP server, and database setup | Pending |
| 3 | Define Hour 4-12: Surgeon end-to-end on trivial migration with minimal Cartographer | Pending |
| 4 | Define Hour 12-24: Add depth - Neo4j, pgvector, full agent implementations | Pending |
| 5 | Define Hour 24-36: Build companion web app and demo experience | Pending |
| 6 | Define Hour 36-44: Polish, demo prep, and testing | Pending |
| 7 | Define Hour 44-48: Submission and final verification | Pending |
| 8 | Design detailed agent architectures with Zod schemas and interfaces | Pending |
| 9 | Create fallback decision matrix for each checkpoint | Pending |
| 10 | Define critical path dependencies and parallel work streams | Pending |


IMPORTANT: When task status changes, remember to call the `update_todo_list` tool to update your progress.

</environment_details>

---

**Assistant:**

<write_to_file>
<path>IMPLEMENTATION-ROADMAP.md</path>
<content>
# Renatus — 48-Hour Implementation Roadmap

> Detailed hour-by-hour build plan with checkpoints, fallback decisions, and parallel work streams for the IBM Bob Hackathon (May 15-17, 2026)

**Critical Success Factors:**
1. Bob integration working by Hour 4 (non-negotiable)
2. End-to-end trivial migration by Hour 12 (pivot point)
3. Real OSS repo migration by Hour 24 (demo viability)
4. Demo rehearsed 5x by Hour 44 (presentation ready)

---

## Table of Contents

1. [Wave 1: Foundation (Hour 0-4)](#wave-1-foundation-hour-0-4)
2. [Wave 2: Core Pipeline (Hour 4-12)](#wave-2-core-pipeline-hour-4-12)
3. [Wave 3: Production Depth (Hour 12-24)](#wave-3-production-depth-hour-12-24)
4. [Wave 4: Experience Layer (Hour 24-36)](#wave-4-experience-layer-hour-24-36)
5. [Wave 5: Polish & Demo (Hour 36-44)](#wave-5-polish--demo-hour-36-44)
6. [Wave 6: Submission (Hour 44-48)](#wave-6-submission-hour-44-48)
7. [Agent Architecture Details](#agent-architecture-details)
8. [Fallback Decision Matrix](#fallback-decision-matrix)
9. [Parallel Work Streams](#parallel-work-streams)

---

## Wave 1: Foundation (Hour 0-4)

**Goal:** Bob can call a Renatus MCP tool and we log it to Postgres.

**Checkpoint:** If Bob cannot talk to our MCP server by Hour 4, the project is in critical danger.

### Hour 0-1: Repository Skeleton

**Tasks:**
- [ ] Initialize monorepo with pnpm workspaces
- [ ] Configure Turbo for build orchestration
- [ ] Set up TypeScript strict mode config (shared)
- [ ] Create workspace structure:
  ```
  renatus/
  ├── packages/
  │   ├── mcp-server/          # The MCP server (stdio + HTTP)
  │   ├── shared/              # Shared types, Zod schemas
  │   ├── db/                  # Drizzle schemas + migrations
  │   └── agents/              # Agent implementations
  ├── apps/
  │   └── web/                 # Companion Next.js app
  ├── bob_sessions/            # Audit trail (pre-created)
  ├── .bobignore               # Security exclusions
  └── turbo.json
  ```
- [ ] Install core dependencies:
  ```json
  {
    "mcp-server": ["@modelcontextprotocol/sdk", "zod", "hono"],
    "db": ["drizzle-orm", "@neondatabase/serverless", "drizzle-kit"],
    "shared": ["zod", "typescript"],
    "agents": ["zod", "octokit", "@anthropic-ai/sdk"]
  }
  ```
- [ ] Create `.bobignore` with security rules from SYSTEM-DESIGN.md §13
- [ ] Initialize git, first commit: "chore: repository skeleton"

**Deliverables:**
- ✅ `pnpm install` works across all workspaces
- ✅ `pnpm build` compiles TypeScript without errors
- ✅ `bob_sessions/` exists and is tracked

**Fallback:** None. This must complete.

---

### Hour 1-2: MCP Server Skeleton

**Tasks:**
- [ ] Create `packages/mcp-server/src/index.ts` with stdio transport
- [ ] Implement one no-op tool: `ping`
  ```typescript
  // packages/mcp-server/src/tools/ping.ts
  import { z } from 'zod';
  
  export const PingInputSchema = z.object({
    message: z.string().optional()
  });
  
  export const PingOutputSchema = z.object({
    pong: z.string(),
    timestamp: z.string()
  });
  
  export async function ping(input: z.infer<typeof PingInputSchema>) {
    return {
      pong: input.message || 'Hello from Renatus',
      timestamp: new Date().toISOString()
    };
  }
  ```
- [ ] Wire up MCP SDK stdio server
- [ ] Add tool registration and schema advertisement
- [ ] Create `package.json` bin entry for `npx @renatus/mcp`
- [ ] Test locally: `node dist/index.js` should start MCP server

**Deliverables:**
- ✅ MCP server starts without errors
- ✅ Advertises `ping` tool with correct JSON Schema
- ✅ Can be invoked via MCP SDK test client

**Fallback:** If MCP SDK is problematic, implement raw stdio JSON-RPC (2-hour delay risk).

---

### Hour 2-3: Bob Integration Test

**Tasks:**
- [ ] Create Bob custom mode definition: `bob-extensions/modes/migration.md`
  ```markdown
  # Migration Mode
  
  You are a migration specialist. Your role is to orchestrate code migrations
  using the Renatus MCP server tools.
  
  ## Available Tools
  - ping: Test connectivity to Renatus
  
  ## Workflow
  1. Always start by calling `ping` to verify connection
  2. Log every tool call to bob_sessions/
  ```
- [ ] Create Bob slash command: `bob-extensions/commands/migrate.md`
  ```markdown
  # /migrate Command
  
  Initiates a code migration using Renatus.
  
  Usage: /migrate <target>
  Example: /migrate react-19
  
  This command:
  1. Switches to Migration mode
  2. Calls the Renatus MCP `ping` tool to verify connectivity
  3. (Future: calls migrate_repository)
  ```
- [ ] Configure Bob to load the MCP server:
  - Add to Bob's MCP config (stdio transport)
  - Point to `npx @renatus/mcp` (or local path during dev)
- [ ] Open Bob IDE in this repo
- [ ] Type `/migrate test` and verify:
  - Mode switches to Migration
  - Bob calls `ping` tool
  - Response appears in chat
  - Export the session to `bob_sessions/2026-05-15T00-00-00__slash-migrate__test.md`

**Deliverables:**
- ✅ Bob successfully calls Renatus MCP `ping` tool
- ✅ Session exported to `bob_sessions/`
- ✅ No errors in Bob's MCP connection logs

**Fallback:** If Bob MCP integration fails, this is a STOP condition. Debug before proceeding.

---

### Hour 3-4: Database Foundation

**Tasks:**
- [ ] Set up Neon Postgres project (free tier)
- [ ] Create `packages/db/src/schema/core.ts`:
  ```typescript
  import { pgTable, uuid, text, timestamp, jsonb } from 'drizzle-orm/pg-core';
  
  export const mcpSessions = pgTable('mcp_sessions', {
    id: uuid('id').primaryKey().defaultRandom(),
    bobTaskId: text('bob_task_id'),
    transport: text('transport').notNull(), // 'stdio' | 'http'
    startedAt: timestamp('started_at').notNull().defaultNow(),
    lastSeenAt: timestamp('last_seen_at').notNull().defaultNow(),
    metadata: jsonb('metadata')
  });
  
  export const toolInvocations = pgTable('tool_invocations', {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id').references(() => mcpSessions.id),
    toolName: text('tool_name').notNull(),
    inputHash: text('input_hash').notNull(),
    responseHash: text('response_hash'),
    durationMs: integer('duration_ms'),
    errorCode: text('error_code'),
    calledAt: timestamp('called_at').notNull().defaultNow()
  });
  
  export const jobs = pgTable('jobs', {
    id: uuid('id').primaryKey().defaultRandom(),
    sessionId: uuid('session_id').references(() => mcpSessions.id),
    repoUrl: text('repo_url').notNull(),
    sourceVersion: text('source_version').notNull(),
    targetVersion: text('target_version').notNull(),
    state: text('state').notNull(), // FSM state
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow()
  });
  ```
- [ ] Generate migration: `pnpm drizzle-kit generate`
- [ ] Apply migration: `pnpm drizzle-kit migrate`
- [ ] Create repository layer: `packages/db/src/repositories/session-repository.ts`
- [ ] Update `ping` tool to log to `tool_invocations` table
- [ ] Test: call `ping` via Bob, verify row appears in Postgres

**Deliverables:**
- ✅ Postgres tables created
- ✅ `ping` tool writes to `tool_invocations`
- ✅ Can query the database and see the logged call

**Fallback:** If Neon is down, use local Postgres in Docker (30-min delay).

---

**Wave 1 Checkpoint (Hour 4):**
- ✅ Bob can call Renatus MCP tools
- ✅ Tool calls are logged to Postgres
- ✅ `bob_sessions/` has at least one export
- ✅ Repository builds and tests pass

**Decision Point:** If checkpoint fails, STOP and debug. Do not proceed to Wave 2.

---

## Wave 2: Core Pipeline (Hour 4-12)

**Goal:** `/migrate react-19` on a tiny repo produces a working patch.

**Checkpoint:** If we cannot produce a single working patch by Hour 12, pivot to "Test Crew" (generate tests for existing code, not migrations).

### Hour 4-5: Minimal Cartographer

**Tasks:**
- [ ] Create hardcoded React 18→19 breaking-change map:
  ```typescript
  // packages/agents/src/cartographer/fixtures/react-18-to-19.ts
  export const REACT_18_TO_19_MAP = [
    {
      id: 'react-19-useeffect-cleanup-undefined',
      category: 'hooks',
      severity: 'high',
      detection: {
        pattern: 'useEffect with cleanup returning non-function'
      },
      prescription: {
        codemod: 'ensure-cleanup-returns-function-or-undefined',
        manualNotes: 'React 19 requires cleanup to return function or undefined'
      },
      references: ['https://react.dev/blog/2024/04/25/react-19#cleanup-functions']
    }
  ];
  ```
- [ ] Create Cartographer service:
  ```typescript
  // packages/agents/src/cartographer/index.ts
  import { z } from 'zod';
  
  export const CartographerInputSchema = z.object({
    ecosystem: z.enum(['npm', 'pypi']),
    source: z.string(),
    target: z.string()
  });
  
  export const BreakingChangeSchema = z.object({
    id: z.string(),
    category: z.string(),
    severity: z.enum(['low', 'medium', 'high', 'critical']),
    detection: z.object({
      pattern: z.string()
    }),
    prescription: z.object({
      codemod: z.string(),
      manualNotes: z.string()
    }),
    references: z.array(z.string())
  });
  
  export async function cartographer(input: z.infer<typeof CartographerInputSchema>) {
    // For now, return hardcoded map for React 18→19
    if (input.ecosystem === 'npm' && input.target === '19') {
      return REACT_18_TO_19_MAP;
    }
    throw new Error('Only React 18→19 supported in MVP');
  }
  ```
- [ ] Add `breaking_change_maps` and `breaking_changes` tables to Drizzle schema
- [ ] Create `plan_migration` MCP tool that calls Cartographer
- [ ] Test via Bob: `/migrate react-19` should return the breaking-change list

**Deliverables:**
- ✅ Cartographer returns structured breaking-change map
- ✅ `plan_migration` tool works end-to-end
- ✅ Data persisted to Postgres

**Fallback:** If Cartographer is too complex, reduce to a single hardcoded rule.

---

### Hour 5-7: Minimal Indexing

**Tasks:**
- [ ] Create simple file indexer (no Neo4j yet, no embeddings):
  ```typescript
  // packages/agents/src/indexing/simple-indexer.ts
  import * as ts from 'typescript';
  
  export interface FileIndex {
    path: string;
    imports: string[];
    exports: string[];
    hasUseEffect: boolean;
  }
  
  export function indexFile(filePath: string, content: string): FileIndex {
    const sourceFile = ts.createSourceFile(
      filePath,
      content,
      ts.ScriptTarget.Latest,
      true
    );
    
    const imports: string[] = [];
    const exports: string[] = [];
    let hasUseEffect = false;
    
    function visit(node: ts.Node) {
      if (ts.isImportDeclaration(node)) {
        const moduleSpecifier = node.moduleSpecifier.getText().slice(1, -1);
        imports.push(moduleSpecifier);
      }
      if (ts.isCallExpression(node)) {
        const text = node.expression.getText();
        if (text === 'useEffect') hasUseEffect = true;
      }
      ts.forEachChild(node, visit);
    }
    
    visit(sourceFile);
    
    return { path: filePath, imports, exports, hasUseEffect };
  }
  ```
- [ ] Create `repo_snapshots` and `code_chunks` tables
- [ ] Create `clone_repository` MCP tool (uses Octokit or simple git clone)
- [ ] Create `index_repository` MCP tool that:
  - Walks all `.ts`/`.tsx` files
  - Calls `indexFile` on each
  - Stores results in `code_chunks` table
- [ ] Test: clone a tiny React repo, index it, verify data in Postgres

**Deliverables:**
- ✅ Can clone a GitHub repo to scratch workspace
- ✅ Can index TypeScript files and extract imports + `useEffect` usage
- ✅ Index stored in Postgres

**Fallback:** If TypeScript AST parsing is too slow, use regex for MVP (less accurate but faster).

---

### Hour 7-10: Minimal Surgeon

**Tasks:**
- [ ] Create simple codemod for the `useEffect` cleanup rule:
  ```typescript
  // packages/agents/src/surgeon/codemods/react-19-useeffect-cleanup.ts
  import * as ts from 'typescript';
  
  export function fixUseEffectCleanup(sourceFile: ts.SourceFile): string {
    const printer = ts.createPrinter();
    
    function visit(node: ts.Node): ts.Node {
      if (ts.isCallExpression(node) && 
          node.expression.getText() === 'useEffect') {
        const callback = node.arguments[0];
        if (ts.isArrowFunction(callback)) {
          // Check if it returns something other than function/undefined
          // If so, wrap in explicit return undefined
          // (Simplified for MVP - real version needs more checks)
        }
      }
      return ts.visitEachChild(node, visit, undefined);
    }
    
    const transformed = ts.visitNode(sourceFile, visit);
    return printer.printFile(transformed as ts.SourceFile);
  }
  ```
- [ ] Create Surgeon service:
  ```typescript
  // packages/agents/src/surgeon/index.ts
  export const SurgeonInputSchema = z.object({
    snapshotId: z.string(),
    breakingChangeMapId: z.string()
  });
  
  export const PatchSchema = z.object({
    filePath: z.string(),
    before: z.string(),
    after: z.string(),
    appliedRuleIds: z.array(z.string()),
    confidence: z.number().min(0).max(1)
  });
  
  export async function surgeon(input: z.infer<typeof SurgeonInputSchema>) {
    // 1. Load breaking changes from DB
    // 2. Load indexed files from DB
    // 3. For each file with useEffect, run the codemod
    // 4. Generate patches
    // 5. Store patches in DB
    // 6. Return patch list
  }
  ```
- [ ] Add `patches` table to Drizzle schema
- [ ] Create `propose_patch` MCP tool
- [ ] Test: run Surgeon on a file with a bad `useEffect`, verify patch generated

**Deliverables:**
- ✅ Surgeon identifies files needing migration
- ✅ Generates at least one working patch
- ✅ Patch stored in Postgres

**Fallback:** If codemod is too complex, generate a TODO comment instead of actual fix (judges can see intent).

---

### Hour 10-12: End-to-End Test

**Tasks:**
- [ ] Create test fixture: `test-repos/tiny-react-18/`
  - Single component with a bad `useEffect`
  - Package.json with React 18
- [ ] Create `migrate_repository` orchestrator tool (Tier 1):
  ```typescript
  export async function migrateRepository(input: {
    repoUrl: string;
    target: string;
  }) {
    // 1. Create job in DB (state: DRAFT)
    // 2. Call cartographer (state: PLANNING)
    // 3. Clone repo (state: CLONING)
    // 4. Index repo (state: INDEXING)
    // 5. Call surgeon (state: PATCHING)
    // 6. Return job ID + patches
  }
  ```
- [ ] Wire up Bob slash command to call `migrate_repository`
- [ ] Test end-to-end:
  - Open Bob in this repo
  - Type `/migrate react-19 --repo test-repos/tiny-react-18`
  - Verify:
    - Cartographer runs
    - Repo cloned
    - Repo indexed
    - Surgeon generates patch
    - Patch is correct (manual inspection)
- [ ] Export Bob session to `bob_sessions/`

**Deliverables:**
- ✅ End-to-end migration produces a working patch
- ✅ Patch can be manually applied and code still works
- ✅ Bob session exported

**Fallback:** If patch is incorrect, mark as "unresolved" and continue (Examiner will catch it).

---

**Wave 2 Checkpoint (Hour 12):**
- ✅ `/migrate react-19` produces at least one patch
- ✅ Patch is syntactically valid TypeScript
- ✅ Manual test shows migrated code works

**Decision Point:** 
- **If checkpoint passes:** Proceed to Wave 3 (add depth)
- **If checkpoint fails:** PIVOT to "Test Crew" — change product to "generate regression tests for existing code" (still uses Bob's repo reading, still valuable, less risky)

---

## Wave 3: Production Depth (Hour 12-24)

**Goal:** A real OSS React 18 repo migrates end-to-end with tests, green.

**Checkpoint:** If we cannot migrate a real repo by Hour 24, cut Neo4j OR embeddings (not both).

### Hour 12-15: Neo4j Integration

**Tasks:**
- [ ] Set up Neo4j AuraDB free tier
- [ ] Create knowledge graph schema:
  ```cypher
  CREATE CONSTRAINT file_path IF NOT EXISTS FOR (f:File) REQUIRE f.path IS UNIQUE;
  CREATE CONSTRAINT symbol_id IF NOT EXISTS FOR (s:Symbol) REQUIRE s.id IS UNIQUE;
  CREATE INDEX file_snapshot IF NOT EXISTS FOR (f:File) ON (f.snapshotId);
  ```
- [ ] Create Neo4j repository:
  ```typescript
  // packages/db/src/repositories/knowledge-graph-repository.ts
  import neo4j from 'neo4j-driver';
  
  export class KnowledgeGraphRepository {
    async createFile(snapshotId: string, path: string, language: string) {
      // CREATE (:File {snapshotId, path, language})
    }
    
    async createImport(fromPath: string, toPath: string, specifier: string) {
      // MATCH (from:File {path: fromPath}), (to:File {path: toPath})
      // CREATE (from)-[:IMPORTS {specifier}]->(to)
    }
    
    async findTransitiveDependents(symbolId: string): Promise<string[]> {
      // MATCH (s:Symbol {id: symbolId})<-[:REFERENCES*]-(f:File)
      // RETURN DISTINCT f.path
    }
  }
  ```
- [ ] Update indexer to write to Neo4j:
  - Create `:File` nodes
  - Create `:IMPORTS` edges
  - Create `:Symbol` nodes for exports
- [ ] Update Surgeon to use structural retrieval:
  - Query Neo4j for files importing React
  - Query Neo4j for files with `useEffect` calls
  - Prioritize files by import depth
- [ ] Test: index a medium repo (~20 files), verify graph in Neo4j Browser

**Deliverables:**
- ✅ Neo4j graph populated from indexed repo
- ✅ Surgeon uses graph to find affected files
- ✅ Transitive dependency queries work

**Fallback:** If Neo4j is too slow, fall back to simple in-memory graph (Map<string, string[]>).

---

### Hour 15-18: Embeddings & Semantic Retrieval

**Tasks:**
- [ ] Enable pgvector extension on Neon:
  ```sql
  CREATE EXTENSION IF NOT EXISTS vector;
  ```
- [ ] Add `embeddings` table:
  ```typescript
  export const embeddings = pgTable('embeddings', {
    id: uuid('id').primaryKey().defaultRandom(),
    codeChunkId: uuid('code_chunk_id').references(() => codeChunks.id),
    vector: vector('vector', { dimensions: 768 })
  });
  ```
- [ ] Create embeddings adapter (use local model for MVP):
  ```typescript
  // packages/agents/src/adapters/embeddings-adapter.ts
  import { pipeline } from '@xenova/transformers';
  
  export class EmbeddingsAdapter {
    private model: any;
    
    async initialize() {
      this.model = await pipeline('feature-extraction', 
        'Xenova/all-MiniLM-L6-v2');
    }
    
    async embed(text: string): Promise<number[]> {
      const output = await this.model(text, {
        pooling: 'mean',
        normalize: true
      });
      return Array.from(output.data);
    }
  }
  ```
- [ ] Update indexer to generate embeddings:
  - Split files into semantic chunks (function-level)
  - Generate embedding for each chunk
  - Store in `embeddings` table
- [ ] Update Surgeon to use hybrid retrieval:
  - Structural retrieval (Neo4j) for direct dependencies
  - Semantic retrieval (pgvector) for usage patterns
  - Combine results with confidence scores
- [ ] Test: query for "files similar to useEffect cleanup pattern"

**Deliverables:**
- ✅ Embeddings generated and stored
- ✅ Semantic search returns relevant files
- ✅ Surgeon uses hybrid retrieval

**Fallback:** If embeddings are too slow, skip semantic retrieval and rely only on structural (Neo4j).

---

### Hour 18-21: Examiner & Test Generation

**Tasks:**
- [ ] Create Examiner service:
  ```typescript
  // packages/agents/src/examiner/index.ts
  export const ExaminerInputSchema = z.object({
    patchBatchId: z.string()
  });
  
  export const GeneratedTestSchema = z.object({
    targetFile: z.string(),
    testFile: z.string(),
    beforeBehaviour: z.string(),
    afterBehaviour: z.string(),
    harness: z.string()
  });
  
  export async function examiner(input: z.infer<typeof ExaminerInputSchema>) {
    // 1. Load patches from DB
    // 2. For each patched file:
    //    a. Detect test framework (Jest/Vitest/etc)
    //    b. Generate snapshot test capturing before/after
    //    c. Store in generated_tests table
    // 3. Return test list
  }
  ```
- [ ] Implement snapshot test generation:
  ```typescript
  function generateSnapshotTest(patch: Patch): string {
    return `
  import { render } from '@testing-library/react';
  import Component from '${patch.filePath}';
  
  describe('Migration regression: ${patch.filePath}', () => {
    it('should maintain behavior after React 19 migration', () => {
      const { container } = render(<Component />);
      expect(container).toMatchSnapshot();
    });
  });
    `;
  }
  ```
- [ ] Add `generated_tests` table
- [ ] Create `generate_test_for` MCP tool
- [ ] Test: generate tests for the patches from Wave 2

**Deliverables:**
- ✅ Examiner generates tests for each patch
- ✅ Tests are syntactically valid
- ✅ Tests stored in DB

**Fallback:** If test generation is too complex, generate TODO comments instead.

---

### Hour 21-24: Auditor & Sandbox

**Tasks:**
- [ ] Set up Vercel Sandbox (or e2b.dev as fallback)
- [ ] Create Auditor service:
  ```typescript
  // packages/agents/src/auditor/index.ts
  export const AuditorInputSchema = z.object({
    patchBatchId: z.string(),
    generatedTestBatchId: z.string()
  });
  
  export const AuditReportSchema = z.object({
    runResults: z.object({
      baselineTests: z.object({ passed: z.number(), failed: z.number() }),
      regressionTests: z.object({ passed: z.number(), failed: z.number() })
    }),
    divergences: z.array(z.string()),
    bobSessionRefs: z.array(z.string()),
    signature: z.string(),
    signedAt: z.string()
  });
  
  export async function auditor(input: z.infer<typeof AuditorInputSchema>) {
    // 1. Create ephemeral sandbox
    // 2. Materialize repo snapshot
    // 3. Apply patches
    // 4. Run npm install
    // 5. Run existing tests (baseline)
    // 6. Run generated tests (regression)
    // 7. Capture results
    // 8. Sign report
    // 9. Store in audit_runs table
    // 10. Return report
  }
  ```
- [ ] Implement signing service:
  ```typescript
  // packages/agents/src/signing/index.ts
  import * as ed from '@noble/ed25519';
  
  export class SigningService {
    async generateKeypair() {
      const privateKey = ed.utils.randomPrivateKey();
      const publicKey = await ed.getPublicKey(privateKey);
      return { privateKey, publicKey };
    }
    
    async sign(data: string, privateKey: Uint8Array): Promise<string> {
      const message = new TextEncoder().encode(data);
      const signature = await ed.sign(message, privateKey);
      return Buffer.from(signature).toString('hex');
    }
  }
  ```
- [ ] Add `audit_runs`, `audit_signatures`, `signing_keys` tables
- [ ] Create `run_test_suite` and `sign_audit` MCP tools
- [ ] Test end-to-end:
  - Run full migration on test repo
  - Auditor applies patches in sandbox
  - Tests run
  - Report signed
  - Verify signature

**Deliverables:**
- ✅ Auditor runs patches in isolated sandbox
- ✅ Tests execute and results captured
- ✅ Audit report signed with ed25519
- ✅ Signature verifiable

**Fallback:** If sandbox is unavailable, run tests locally (less isolated but still works).

---

**Wave 3 Checkpoint (Hour 24):**
- ✅ Real OSS React 18 repo migrates end-to-end
- ✅ Tests run in sandbox
- ✅ Audit report generated and signed

**Decision Point:**
- **If checkpoint passes:** Proceed to Wave 4 (build web app)
- **If checkpoint fails:** Cut either Neo4j OR embeddings (keep one), simplify Auditor to local execution

---

## Wave 4: Experience Layer (Hour 24-36)

**Goal:** Companion web app deployed, audit URL shareable, 3D KG renders.

**Checkpoint:** If web app is not deployed by Hour 36, cut 3D KG (keep audit page only).

### Hour 24-27: Web App Foundation

**Tasks:**
- [ ] Initialize Next.js 16 app:
  ```bash
  cd apps/web
  pnpm create next-app@latest . --typescript --tailwind --app
  ```
- [ ] Install dependencies:
  ```json
  {
    "dependencies": {
      "drizzle-orm": "^0.30.0",
      "@neondatabase/serverless": "^0.9.0",
      "react-three-fiber": "^8.0.0",
      "react-force-graph-3d": "^1.24.0",
      "three": "^0.162.0"
    }
  }
  ```
- [ ] Set up Drizzle client (shared with MCP server)
- [ ] Create route structure:
  ```
  app/
  ├── page.tsx                    # Landing page
  ├── audit/
  │   └── [jobId]/
  │       └── page.tsx            # Audit report
  ├── kg/
  │   └── [jobId]/
  │       └── page.tsx            # 3D knowledge graph
  ├── verify/
  │   └── page.tsx                # Signature verification
  └── api/
      └── audit/
          └── [jobId]/
              └── sign-url/
                  └── route.ts    # Generate signed blob URL
  ```
- [ ] Create landing page with:
  - Project description
  - Install instructions
  - Link to GitHub
  - Public key for signature verification
- [ ] Deploy to Vercel (connect GitHub repo)

**Deliverables:**
- ✅ Web app deployed and accessible
- ✅ Landing page renders
- ✅ Routes scaffolded

**Fallback:** None. Web app is critical for demo.

---

### Hour 27-30: Audit Report Page

**Tasks:**
- [ ] Create audit report component:
  ```typescript
  // apps/web/app/audit/[jobId]/page.tsx
  import { db } from '@/lib/db';
  import { auditRuns, jobs } from '@renatus/db/schema';
  
  export default async function AuditPage({ params }: { params: { jobId: string } }) {
    const audit = await db.query.auditRuns.findFirst({
      where: eq(auditRuns.jobId, params.jobId),
      with: {
        job: true,
        signatures: true
      }
    });
    
    return (
      <div className="container mx-auto py-8">
        <h1>Migration Audit Report</h1>
        <AuditSummary audit={audit} />
        <SignatureVerification signature={audit.signatures[0]} />
        <BobSessionLinks sessionRefs={audit.bobSessionRefs} />
        <TestResults results={audit.runResults} />
        <PatchList patches={audit.patches} />
      </div>
    );
  }
  ```
- [ ] Create signature verification widget:
  ```typescript
  'use client';
  
  export function SignatureVerification({ signature }) {
    const [verified, setVerified] = useState<boolean | null>(null);
    
    async function verify() {
      // Client-side ed25519 verification
      const isValid = await ed.verify(
        signature.signature,
        canonicalJson,
        signature.publicKey
      );
      setVerified(isValid);
    }
    
    return (
      <div>
        <button onClick={verify}>Verify Signature</button>
        {verified !== null && (
          <div>{verified ? '✅ Valid' : '❌ Invalid'}</div>
        )}
      </div>
    );
  }
  ```
- [ ] Create Bob session links component:
  ```typescript
  export function BobSessionLinks({ sessionRefs }) {
    return (
      <div>
        <h3>Bob Sessions</h3>
        <ul>
          {sessionRefs.map(ref => (
            <li key={ref}>
              <a href={`/bob_sessions/${ref}.md`}>
                {ref}
              </a>
            </li>
          ))}
        </ul>
      </div>
    );
  }
  ```
- [ ] Style with Tailwind + shadcn/ui
- [ ] Test: generate an audit, visit `/audit/[jobId]`, verify all sections render

**Deliverables:**
- ✅ Audit report page renders all data
- ✅ Signature verification works
- ✅ Bob session links resolve
- ✅ Responsive design

**Fallback:** If styling takes too long, use unstyled HTML (content > polish).

---

### Hour 30-33: 3D Knowledge Graph

**Tasks:**
- [ ] Create KG data fetcher:
  ```typescript
  // apps/web/app/kg/[jobId]/page.tsx
  import { db } from '@/lib/db';
  import { neo4jDriver } from '@/lib/neo4j';
  
  async function getGraphData(jobId: string) {
    const session = neo4jDriver.session();
    const result = await session.run(`
      MATCH (f:File {snapshotId: $snapshotId})
      OPTIONAL MATCH (f)-[r:IMPORTS]->(t:File)
      RETURN f, r, t
    `, { snapshotId });
    
    // Transform to react-force-graph format
    return {
      nodes: [...],
      links: [...]
    };
  }
  ```
- [ ] Create 3D graph component:
  ```typescript
  'use client';
  
  import dynamic from 'next/dynamic';
  
  const ForceGraph3D = dynamic(() => import('react-force-graph-3d'), {
    ssr: false
  });
  
  export function CodebaseGraph({ data }) {
    return (
      <ForceGraph3D
        graphData={data}
        nodeLabel="path"
        nodeColor={node => {
          // Color by breaking change severity
          if (node.severity === 'high') return 'red';
          if (node.severity === 'medium') return 'orange';
          return 'green';
        }}
        nodeVal={node => node.linesOfCode / 10}
        linkDirectionalParticles={2}
      />
    );
  }
  ```
- [ ] Add migration animation:
  ```typescript
  useEffect(() => {
    // Pulse nodes in the order Surgeon patched them
    patches.forEach((patch, i) => {
      setTimeout(() => {
        highlightNode(patch.filePath);
      }, i * 500);
    });
  }, [patches]);
  ```
- [ ] Test: visit `/kg/[jobId]`, verify graph renders and animates

**Deliverables:**
- ✅ 3D graph renders
- ✅ Nodes colored by severity
- ✅ Migration animation works
- ✅ Interactive (hover, zoom, rotate)

**Fallback:** If 3D is too slow, fall back to 2D force graph (react-force-graph-2d).

---

### Hour 33-36: SSE Progress Feed

**Tasks:**
- [ ] Add HTTP/SSE transport to MCP server:
  ```typescript
  // packages/mcp-server/src/transports/http.ts
  import { Hono } from 'hono';
  import { streamSSE } from 'hono/streaming';
  
  const app = new Hono();
  
  app.get('/jobs/:jobId/stream', async (c) => {
    return streamSSE(c, async (stream) => {
      const jobId = c.req.param('jobId');
      
      // Subscribe to job state changes
      const subscription = subscribeToJob(jobId);
      
      for await (const event of subscription) {
        await stream.writeSSE({
          data: JSON.stringify(event),
          event: 'state-change'
        });
      }
    });
  });
  ```
- [ ] Create live progress page:
  ```typescript
  // apps/web/app/jobs/[jobId]/live/page.tsx
  'use client';
  
  export default function LiveProgress({ params }) {
    const [events, setEvents] = useState([]);
    
    useEffect(() => {
      const eventSource = new EventSource(
        `${MCP_SERVER_URL}/jobs/${params.jobId}/stream`
      );
      
      eventSource.addEventListener('state-change', (e) => {
        const event = JSON.parse(e.data);
        setEvents(prev => [...prev, event]);
      });
      
      return () => eventSource.close();
    }, [params.jobId]);
    
    return (
      <div>
        <h1>Live Migration Progress</h1>
        <Timeline events={events} />
      </div>
    );
  }
  ```
- [ ] Update orchestrator to emit SSE events on state transitions
- [ ] Test: start a migration, open live page, verify events stream in real-time

**Deliverables:**
- ✅ SSE endpoint works
- ✅ Live progress page updates in real-time
- ✅ Events include timestamps and state names

**Fallback:** If SSE is problematic, use polling (less elegant but works).

---

**Wave 4 Checkpoint (Hour 36):**
- ✅ Web app deployed
- ✅ Audit report page works
- ✅ 3D KG renders (or 2D fallback)
- ✅ Live progress feed works

**Decision Point:**
- **If checkpoint passes:** Proceed to Wave 5 (polish)
- **If checkpoint fails:** Cut 3D KG, keep audit page only

---

## Wave 5: Polish & Demo (Hour 36-44)

**Goal:** Demo runs 5 times successfully, pre-recorded backup ready.

**Checkpoint:** If demo does not run successfully by Hour 44, rely on pre-recorded video.

### Hour 36-38: Demo Preparation

**Tasks:**
- [ ] Select primary demo target repo:
  - Real OSS React 18 codebase
  - ~50 source files
  - Full test suite
  - No exotic build tooling
  - Examples: `react-router` v5, `formik`, `react-hook-form` v6
- [ ] Pre-migrate the target repo:
  - Run full migration
  - Verify all tests pass
  - Export Bob session to `bob_sessions/`
  - Commit as "demo: pre-migration baseline"
- [ ] Select 2 backup repos (same criteria)
- [ ] Create demo script:
  ```markdown
  # Demo Script (90 seconds)
  
  ## Setup (pre-demo)
  - Bob IDE open in Renatus repo
  - Target repo cloned to `demo-repos/primary/`
  - Companion web app open on second monitor
  - Terminal ready
  
  ## Timeline
  0:00 - "This is Renatus. Watch Bob migrate a real React 18 codebase to React 19."
  0:08 - Type `/migrate react-19 --repo demo-repos/primary`
  0:20 - Bob narrates the plan (Cartographer output visible)
  0:45 - Switch to web app, 3D KG pulses as Surgeon patches files
  1:10 - Auditor sandbox runs, tests turn green
  1:22 - Audit URL appears, click, signed report renders
  1:30 - "Six minutes. Forty-seven files. Signed."
  ```
- [ ] Rehearse demo once (dry run)

**Deliverables:**
- ✅ Demo script written
- ✅ Target repo selected and pre-migrated
- ✅ Backup repos ready
- ✅ Dry run completed

**Fallback:** None. Demo prep is critical.

---

### Hour 38-40: Pre-record Backup

**Tasks:**
- [ ] Set up screen recording (OBS or QuickTime)
- [ ] Record full demo at highest quality:
  - 1920x1080 minimum
  - 60fps
  - Clear audio narration
  - Show every step
- [ ] Edit to exactly 60 seconds
- [ ] Export as MP4
- [ ] Upload to YouTube (unlisted) as backup
- [ ] Test playback on multiple devices

**Deliverables:**
- ✅ 60-second demo video recorded
- ✅ Video uploaded and accessible
- ✅ Fallback plan documented

**Fallback:** None. Pre-recorded backup is insurance.

---

### Hour 40-42: Live Demo Rehearsal

**Tasks:**
- [ ] Run demo 5 times start to finish
- [ ] Time each iteration:
  - Target: ≤90 seconds
  - Hard ceiling: 120 seconds
- [ ] Identify bottlenecks:
  - If Cartographer > 10s, pre-cache
  - If Surgeon > 60s, reduce file count
  - If Auditor > 90s, pre-warm sandbox
- [ ] Optimize hot path
- [ ] Run 5 more times after optimization
- [ ] Document failure recovery:
  - If Bob hangs: Ctrl+C, restart, continue from checkpoint
  - If MCP disconnects: Switch to pre-recorded video
  - If web app is down: Show local screenshots

**Deliverables:**
- ✅ Demo runs successfully 5/5 times
- ✅ Average time ≤90 seconds
- ✅ Failure recovery plan documented

**Fallback:** If live demo is unreliable, commit to pre-recorded video.

---

### Hour 42-44: Polish & Documentation

**Tasks:**
- [ ] Update README.md:
  - Installation instructions
  - Quick start guide
  - Link to demo video
  - Link to audit URL
- [ ] Clean up `bob_sessions/`:
  - Remove any test exports
  - Ensure all filenames are descriptive
  - Verify no secrets leaked
- [ ] Run secret scan:
  ```bash
  git log --all --full-history --source --find-object=<secret>
  ```
- [ ] Create presentation slides (if required):
  - Slide 1: Problem (migrations are hard)
  - Slide 2: Solution (Renatus + Bob)
  - Slide 3: Architecture (4 agents)
  - Slide 4: Demo (live or video)
  - Slide 5: Results (audit URL)
- [ ] Final commit: "chore: demo ready"
- [ ] Push to GitHub
- [ ] Verify public repo renders correctly

**Deliverables:**
- ✅ README complete
- ✅ `bob_sessions/` clean
- ✅ No secrets in repo
- ✅ Slides ready (if needed)
- ✅ Repo pushed

**Fallback:** None. This is final prep.

---

**Wave 5 Checkpoint (Hour 44):**
- ✅ Demo runs successfully
- ✅ Pre-recorded backup ready
- ✅ Documentation complete
- ✅ Repo clean and pushed

**Decision Point:** Proceed to submission.

---

## Wave 6: Submission (Hour 44-48)

**Goal:** Submission complete, demo URL live, sleep before judging.

### Hour 44-46: Submission Package

**Tasks:**
- [ ] Create cover image (1920x1080):
  - Screenshot of 3D KG
  - Renatus logo
  - Tagline: "Bob-native code migration crew"
- [ ] Record video presentation (if required):
  - 3-5 minutes
  - Problem, solution, demo, results
  - Upload to YouTube
- [ ] Fill out lablab.ai submission form:
  - Project name: Renatus
  - Tagline: Multi-agent code migration crew, orchestrated by IBM Bob
  - Description: (from README)
  - GitHub URL
  - Demo URL (web app)
  - Video URL
  - Cover image
  - Team members
- [ ] Submit
- [ ] Verify submission appears on lablab.ai

**Deliverables:**
- ✅ Cover image created
- ✅ Video presentation recorded (if required)
- ✅ Submission form completed
- ✅ Submission confirmed

**Fallback:** None. Submission is mandatory.

---

### Hour 46-48: Final Verification & Rest

**Tasks:**
- [ ] Verify demo URL is accessible:
  - Test from different network
  - Test on mobile
  - Test audit URL
  - Test 3D KG
- [ ] Verify GitHub repo:
  - README renders
  - `bob_sessions/` visible
  - No secrets
  - License present
- [ ] Verify video:
  - Plays on YouTube
  - Audio clear
  - Subtitles (if needed)
- [ ] Send demo URL to team for final check
- [ ] Set alarm for judging time
- [ ] Sleep

**Deliverables:**
- ✅ All URLs verified
- ✅ Team notified
- ✅ Rested for judging

**Fallback:** None. Rest is critical.

---

**Wave 6 Checkpoint (Hour 48):**
- ✅ Submission complete
- ✅ Demo URL live
- ✅ Ready for judging

---

## Agent Architecture Details

### Shared Types & Schemas

```typescript
// packages/shared/src/types.ts
import { z } from 'zod';

// Core domain types
export const SemverRangeSchema = z.string().regex(/^\d+\.\d+\.\d+$/);

export const EcosystemSchema = z.enum(['npm', 'pypi', 'cargo', 'maven']);

export const SeveritySchema = z.enum(['low', 'medium', 'high', 'critical']);

export const JobStateSchema = z.enum([
  'draft',
  'planning',
  'planned',
  'cloning',
  'cloned',
  'indexing',
  'indexed',
  'patching',
  'patched',
  'testing',
  'tested',
  'auditing',
  '

---

**User:**

[write_to_file for 'IMPLEMENTATION-ROADMAP.md'] Result:
The tool execution failed with the following error:
<error>
This appears to be a new file.
Note: Your response may have been truncated because it exceeded your output limit. You wrote 1289 lines of content, but the line_count parameter was either missing or not included in your response.

RECOMMENDED APPROACH:
1. Try again with the line_count parameter in your response if you forgot to include it
2. Or break your content into smaller chunks - first use write_to_file with the initial chunk
3. Then use insert_content to append additional chunks

# Reminder: Instructions for Tool Use

Tool uses are formatted using XML-style tags. The tool name itself becomes the XML tag name. Each parameter is enclosed within its own set of tags. Here's the structure:

<actual_tool_name>
<parameter1_name>value1</parameter1_name>
<parameter2_name>value2</parameter2_name>
...
</actual_tool_name>

For example, to use the attempt_completion tool:

<attempt_completion>
<result>
I have completed the task...
</result>
</attempt_completion>

Always use the actual tool name as the XML tag name for proper parsing and execution.
</error>
<environment_details>
# VSCode Visible Files
IMPLEMENTATION-ROADMAP.md

# VSCode Open Tabs
IMPLEMENTATION-ROADMAP.md

# Current Time
Current time in ISO 8601 UTC format: 2026-05-16T10:34:13.081Z
User time zone: Asia/Calcutta, UTC+5:30

# Current Cost
$0.52

# Review Exclusions
The following file patterns are excluded from code reviews:
- .vscode/**
- .env
- .env.*
- secrets/
- *.key
- *.pem
- *.p12
- *.crt
- config/credentials.json
- .next/
- node_modules/
- dist/
- build/
- .turbo/
- coverage/
- .DS_Store
- bob_sessions/

# Current Mode
<slug>plan</slug>
<name>📝 Plan</name>
====

REMINDERS

Below is your current list of reminders for this task. Keep them updated as you progress.

| # | Content | Status |
|---|---------|--------|
| 1 | Analyze system design and create implementation roadmap structure | In Progress |
| 2 | Define Hour 0-4: Foundation phase with repo skeleton, MCP server, and database setup | Pending |
| 3 | Define Hour 4-12: Surgeon end-to-end on trivial migration with minimal Cartographer | Pending |
| 4 | Define Hour 12-24: Add depth - Neo4j, pgvector, full agent implementations | Pending |
| 5 | Define Hour 24-36: Build companion web app and demo experience | Pending |
| 6 | Define Hour 36-44: Polish, demo prep, and testing | Pending |
| 7 | Define Hour 44-48: Submission and final verification | Pending |
| 8 | Design detailed agent architectures with Zod schemas and interfaces | Pending |
| 9 | Create fallback decision matrix for each checkpoint | Pending |
| 10 | Define critical path dependencies and parallel work streams | Pending |


IMPORTANT: When task status changes, remember to call the `update_todo_list` tool to update your progress.

</environment_details>

---

**Assistant:**

I need to break this into smaller chunks. Let me create the roadmap in parts.

<write_to_file>
<path>IMPLEMENTATION-ROADMAP.md</path>
<content>
# Renatus — 48-Hour Implementation Roadmap

> Detailed hour-by-hour build plan with checkpoints, fallback decisions, and parallel work streams for the IBM Bob Hackathon (May 15-17, 2026)

**Critical Success Factors:**
1. Bob integration working by Hour 4 (non-negotiable)
2. End-to-end trivial migration by Hour 12 (pivot point)
3. Real OSS repo migration by Hour 24 (demo viability)
4. Demo rehearsed 5x by Hour 44 (presentation ready)

---

## Quick Navigation

- [Wave 1: Foundation (Hour 0-4)](#wave-1-foundation-hour-0-4)
- [Wave 2: Core Pipeline (Hour 4-12)](#wave-2-core-pipeline-hour-4-12)
- [Wave 3: Production Depth (Hour 12-24)](#wave-3-production-depth-hour-12-24)
- [Wave 4: Experience Layer (Hour 24-36)](#wave-4-experience-layer-hour-24-36)
- [Wave 5: Polish & Demo (Hour 36-44)](#wave-5-polish--demo-hour-36-44)
- [Wave 6: Submission (Hour 44-48)](#wave-6-submission-hour-44-48)
- [Agent Architecture Details](#agent-architecture-details)
- [Fallback Decision Matrix](#fallback-decision-matrix)
- [Parallel Work Streams](#parallel-work-streams)

---

## Wave 1: Foundation (Hour 0-4)

**Goal:** Bob can call a Renatus MCP tool and we log it to Postgres.

**Checkpoint:** If Bob cannot talk to our MCP server by Hour 4, the project is in critical danger.

### Hour 0-1: Repository Skeleton

**Owner:** Full team

**Tasks:**
- [ ] Initialize monorepo with pnpm workspaces
- [ ] Configure Turbo for build orchestration
- [ ] Set up TypeScript strict mode config (shared)
- [ ] Create workspace structure:
  ```
  renatus/
  ├── packages/
  │   ├── mcp-server/          # The MCP server (stdio + HTTP)
  │   ├── shared/              # Shared types, Zod schemas
  │   ├── db/                  # Drizzle schemas + migrations
  │   └── agents/              # Agent implementations
  ├── apps/
  │   └── web/                 # Companion Next.js app
  ├── bob_sessions/            # Audit trail (pre-created)
  ├── .bobignore               # Security exclusions
  └── turbo.json
  ```
- [ ] Install core dependencies per workspace
- [ ] Create `.bobignore` with security rules from SYSTEM-DESIGN.md §13
- [ ] Initialize git, first commit: "chore: repository skeleton"

**Deliverables:**
- ✅ `pnpm install` works across all workspaces
- ✅ `pnpm build` compiles TypeScript without errors
- ✅ `bob_sessions/` exists and is tracked

**Time Budget:** 60 minutes  
**Fallback:** None. This must complete.

---

### Hour 1-2: MCP Server Skeleton

**Owner:** Backend lead

**Tasks:**
- [ ] Create `packages/mcp-server/src/index.ts` with stdio transport
- [ ] Implement one no-op tool: `ping`
- [ ] Wire up MCP SDK stdio server
- [ ] Add tool registration and schema advertisement
- [ ] Create `package.json` bin entry for `npx @renatus/mcp`
- [ ] Test locally: `node dist/index.js` should start MCP server

**Code Reference:**
```typescript
// packages/mcp-server/src/tools/ping.ts
import { z } from 'zod';

export const PingInputSchema = z.object({
  message: z.string().optional()
});

export const PingOutputSchema = z.object({
  pong: z.string(),
  timestamp: z.string()
});

export async function ping(input: z.infer<typeof PingInputSchema>) {
  return {
    pong: input.message || 'Hello from Renatus',
    timestamp: new Date().toISOString()
  };
}
```

**Deliverables:**
- ✅ MCP server starts without errors
- ✅ Advertises `ping` tool with correct JSON Schema
- ✅ Can be invoked via MCP SDK test client

**Time Budget:** 60 minutes  
**Fallback:** If MCP SDK is problematic, implement raw stdio JSON-RPC (adds 2-hour delay risk).

---

### Hour 2-3: Bob Integration Test

**Owner:** Full team (critical path)

**Tasks:**
- [ ] Create Bob custom mode: `bob-extensions/modes/migration.md`
- [ ] Create Bob slash command: `bob-extensions/commands/migrate.md`
- [ ] Configure Bob to load the MCP server (stdio transport)
- [ ] Open Bob IDE in this repo
- [ ] Type `/migrate test` and verify:
  - Mode switches to Migration
  - Bob calls `ping` tool
  - Response appears in chat
- [ ] Export session to `bob_sessions/2026-05-15T00-00-00__slash-migrate__test.md`

**Deliverables:**
- ✅ Bob successfully calls Renatus MCP `ping` tool
- ✅ Session exported to `bob_sessions/`
- ✅ No errors in Bob's MCP connection logs

**Time Budget:** 60 minutes  
**Fallback:** If Bob MCP integration fails, this is a STOP condition. Debug before proceeding.

---

### Hour 3-4: Database Foundation

**Owner:** Backend lead

**Tasks:**
- [ ] Set up Neon Postgres project (free tier)
- [ ] Create core Drizzle schemas: `mcp_sessions`, `tool_invocations`, `jobs`
- [ ] Generate migration: `pnpm drizzle-kit generate`
- [ ] Apply migration: `pnpm drizzle-kit migrate`
- [ ] Create repository layer: `packages/db/src/repositories/session-repository.ts`
- [ ] Update `ping` tool to log to `tool_invocations` table
- [ ] Test: call `ping` via Bob, verify row appears in Postgres

**Deliverables:**
- ✅ Postgres tables created
- ✅ `ping` tool writes to `tool_invocations`
- ✅ Can query the database and see the logged call

**Time Budget:** 60 minutes  
**Fallback:** If Neon is down, use local Postgres in Docker (30-min delay).

---

**Wave 1 Checkpoint (Hour 4):**
- ✅ Bob can call Renatus MCP tools
- ✅ Tool calls are logged to Postgres
- ✅ `bob_sessions/` has at least one export
- ✅ Repository builds and tests pass

**Decision Point:** If checkpoint fails, STOP and debug. Do not proceed to Wave 2.

---

## Wave 2: Core Pipeline (Hour 4-12)

**Goal:** `/migrate react-19` on a tiny repo produces a working patch.

**Checkpoint:** If we cannot produce a single working patch by Hour 12, pivot to "Test Crew" alternative.

### Hour 4-5: Minimal Cartographer

**Owner:** Agent lead

**Tasks:**
- [ ] Create hardcoded React 18→19 breaking-change map fixture
- [ ] Create Cartographer service with Zod schemas
- [ ] Add `breaking_change_maps` and `breaking_changes` tables
- [ ] Create `plan_migration` MCP tool
- [ ] Test via Bob: verify breaking-change list returned

**Deliverables:**
- ✅ Cartographer returns structured breaking-change map
- ✅ `plan_migration` tool works end-to-end
- ✅ Data persisted to Postgres

**Time Budget:** 60 minutes  
**Fallback:** Reduce to single hardcoded rule if too complex.

---

### Hour 5-7: Minimal Indexing

**Owner:** Backend lead

**Tasks:**
- [ ] Create simple file indexer using TypeScript compiler API
- [ ] Extract imports, exports, and `useEffect` usage
- [ ] Create `repo_snapshots` and `code_chunks` tables
- [ ] Create `clone_repository` and `index_repository` MCP tools
- [ ] Test: clone tiny React repo, index it, verify data in Postgres

**Deliverables:**
- ✅ Can clone GitHub repo to scratch workspace
- ✅ Can index TypeScript files
- ✅ Index stored in Postgres

**Time Budget:** 120 minutes  
**Fallback:** Use regex for MVP if AST parsing too slow.

---

### Hour 7-10: Minimal Surgeon

**Owner:** Agent lead

**Tasks:**
- [ ] Create simple codemod for `useEffect` cleanup rule
- [ ] Create Surgeon service with Zod schemas
- [ ] Add `patches` table
- [ ] Create `propose_patch` MCP tool
- [ ] Test: generate patch for file with bad `useEffect`

**Deliverables:**
- ✅ Surgeon identifies files needing migration
- ✅ Generates at least one working patch
- ✅ Patch stored in Postgres

**Time Budget:** 180 minutes  
**Fallback:** Generate TODO comment instead of actual fix.

---

### Hour 10-12: End-to-End Test

**Owner:** Full team

**Tasks:**
- [ ] Create test fixture: `test-repos/tiny-react-18/`
- [ ] Create `migrate_repository` orchestrator tool
- [ ] Wire up slash command to call orchestrator
- [ ] Test end-to-end migration
- [ ] Verify patch is correct
- [ ] Export Bob session

**Deliverables:**
- ✅ End-to-end migration produces working patch
- ✅ Patch manually verified
- ✅ Bob session exported

**Time Budget:** 120 minutes  
**Fallback:** Mark patch as "unresolved" if incorrect.

---

**Wave 2 Checkpoint (Hour 12):**
- ✅ `/migrate react-19` produces at least one patch
- ✅ Patch is syntactically valid TypeScript
- ✅ Manual test shows migrated code works

**Decision Point:**
- **Pass:** Proceed to Wave 3 (add depth)
- **Fail:** PIVOT to "Test Crew" — generate tests for existing code instead

---

## Wave 3: Production Depth (Hour 12-24)

**Goal:** Real OSS React 18 repo migrates end-to-end with tests, green.

**Checkpoint:** If real repo fails by Hour 24, cut Neo4j OR embeddings (not both).

### Hour 12-15: Neo4j Integration

**Owner:** Backend lead

**Tasks:**
- [ ] Set up Neo4j AuraDB free tier
- [ ] Create knowledge graph schema
- [ ] Create Neo4j repository layer
- [ ] Update indexer to write to Neo4j
- [ ] Update Surgeon to use structural retrieval
- [ ] Test: verify transitive dependency queries work

**Deliverables:**
- ✅ Neo4j graph populated
- ✅ Surgeon uses graph for file discovery
- ✅ Queries perform adequately

**Time Budget:** 180 minutes  
**Fallback:** Use in-memory graph (Map<string, string[]>) if Neo4j too slow.

---

### Hour 15-18: Embeddings & Semantic Retrieval

**Owner:** ML/Backend lead

**Tasks:**
- [ ] Enable pgvector extension on Neon
- [ ] Add `embeddings` table
- [ ] Create embeddings adapter (local model)
- [ ] Update indexer to generate embeddings
- [ ] Update Surgeon to use hybrid retrieval
- [ ] Test: semantic search returns relevant files

**Deliverables:**
- ✅ Embeddings generated and stored
- ✅ Semantic search works
- ✅ Surgeon uses hybrid retrieval

**Time Budget:** 180 minutes  
**Fallback:** Skip semantic retrieval, rely only on structural (Neo4j).

---

### Hour 18-21: Examiner & Test Generation

**Owner:** Agent lead

**Tasks:**
- [ ] Create Examiner service with Zod schemas
- [ ] Implement snapshot test generation
- [ ] Add `generated_tests` table
- [ ] Create `generate_test_for` MCP tool
- [ ] Test: generate tests for patches

**Deliverables:**
- ✅ Examiner generates tests for each patch
- ✅ Tests are syntactically valid
- ✅ Tests stored in DB

**Time Budget:** 180 minutes  
**Fallback:** Generate TODO comments instead of full tests.

---

### Hour 21-24: Auditor & Sandbox

**Owner:** Backend/DevOps lead

**Tasks:**
- [ ] Set up Vercel Sandbox or e2b.dev
- [ ] Create Auditor service with Zod schemas
- [ ] Implement signing service (ed25519)
- [ ] Add audit tables
- [ ] Create audit MCP tools
- [ ] Test: run patches in sandbox, sign report

**Deliverables:**
- ✅ Auditor runs patches in sandbox
- ✅ Tests execute, results captured
- ✅ Report signed and verifiable

**Time Budget:** 180 minutes  
**Fallback:** Run tests locally if sandbox unavailable.

---

**Wave 3 Checkpoint (Hour 24):**
- ✅ Real OSS React 18 repo migrates end-to-end
- ✅ Tests run in sandbox
- ✅ Audit report generated and signed

**Decision Point:**
- **Pass:** Proceed to Wave 4 (web app)
- **Fail:** Cut Neo4j OR embeddings, simplify Auditor

---

## Wave 4: Experience Layer (Hour 24-36)

**Goal:** Companion web app deployed, audit URL shareable, 3D KG renders.

**Checkpoint:** If web app not deployed by Hour 36, cut 3D KG (keep audit page).

### Hour 24-27: Web App Foundation

**Owner:** Frontend lead

**Tasks:**
- [ ] Initialize Next.js 16 app with TypeScript + Tailwind
- [ ] Set up Drizzle client (shared with MCP server)
- [ ] Create route structure
- [ ] Create landing page
- [ ] Deploy to Vercel

**Deliverables:**
- ✅ Web app deployed and accessible
- ✅ Landing page renders
- ✅ Routes scaffolded

**Time Budget:** 180 minutes  
**Fallback:** None. Web app critical for demo.

---

### Hour 27-30: Audit Report Page

**Owner:** Frontend lead

**Tasks:**
- [ ] Create audit report component
- [ ] Create signature verification widget
- [ ] Create Bob session links component
- [ ] Style with Tailwind + shadcn/ui
- [ ] Test: verify all sections render

**Deliverables:**
- ✅ Audit report page renders all data
- ✅ Signature verification works
- ✅ Bob session links resolve
- ✅ Responsive design

**Time Budget:** 180 minutes  
**Fallback:** Use unstyled HTML if styling takes too long.

---

### Hour 30-33: 3D Knowledge Graph

**Owner:** Frontend/Viz lead

**Tasks:**
- [ ] Create KG data fetcher
- [ ] Create 3D graph component with react-force-graph-3d
- [ ] Add migration animation
- [ ] Test: verify graph renders and animates

**Deliverables:**
- ✅ 3D graph renders
- ✅ Nodes colored by severity
- ✅ Migration animation works
- ✅ Interactive controls

**Time Budget:** 180 minutes  
**Fallback:** Fall back to 2D force graph if 3D too slow.

---

### Hour 33-36: SSE Progress Feed

**Owner:** Backend lead

**Tasks:**
- [ ] Add HTTP/SSE transport to MCP server
- [ ] Create live progress page
- [ ] Update orchestrator to emit SSE events
- [ ] Test: verify events stream in real-time

**Deliverables:**
- ✅ SSE endpoint works
- ✅ Live progress page updates
- ✅ Events include timestamps

**Time Budget:** 180 minutes  
**Fallback:** Use polling if SSE problematic.

---

**Wave 4 Checkpoint (Hour 36):**
- ✅ Web app deployed
- ✅ Audit report page works
- ✅ 3D KG renders (or 2D fallback)
- ✅ Live progress feed works

**Decision Point:**
- **Pass:** Proceed to Wave 5 (polish)
- **Fail:** Cut 3D KG, keep audit page only

---

## Wave 5: Polish & Demo (Hour 36-44)

**Goal:** Demo runs 5 times successfully, pre-recorded backup ready.

**Checkpoint:** If demo doesn't run by Hour 44, rely on pre-recorded video.

### Hour 36-38: Demo Preparation

**Owner:** Full team

**Tasks:**
- [ ] Select primary demo target repo
- [ ] Pre-migrate target repo
- [ ] Select 2 backup repos
- [ ] Create demo script (90-second timeline)
- [ ] Rehearse demo once (dry run)

**Deliverables:**
- ✅ Demo script written
- ✅ Target repo selected and pre-migrated
- ✅ Backup repos ready
- ✅ Dry run completed

**Time Budget:** 120 minutes  
**Fallback:** None. Demo prep critical.

---

### Hour 38-40: Pre-record Backup

**Owner:** Presenter

**Tasks:**
- [ ] Set up screen recording
- [ ] Record full demo at high quality
- [ ] Edit to exactly 60 seconds
- [ ] Upload to YouTube (unlisted)
- [ ] Test playback

**Deliverables:**
- ✅ 60-second demo video recorded
- ✅ Video uploaded and accessible
- ✅ Fallback plan documented

**Time Budget:** 120 minutes  
**Fallback:** None. Pre-recorded backup is insurance.

---

### Hour 40-42: Live Demo Rehearsal

**Owner:** Full team

**Tasks:**
- [ ] Run demo 5 times start to finish
- [ ] Time each iteration (target ≤90s)
- [ ] Identify and optimize bottlenecks
- [ ] Run 5 more times after optimization
- [ ] Document failure recovery procedures

**Deliverables:**
- ✅ Demo runs successfully 5/5 times
- ✅ Average time ≤90 seconds
- ✅ Failure recovery plan documented

**Time Budget:** 120 minutes  
**Fallback:** Commit to pre-recorded video if unreliable.

---

### Hour 42-44: Polish & Documentation

**Owner:** Full team

**Tasks:**
- [ ] Update README with installation and quick start
- [ ] Clean up `bob_sessions/` (remove test exports)
- [ ] Run secret scan
- [ ] Create presentation slides (if required)
- [ ] Final commit and push
- [ ] Verify public repo renders correctly

**Deliverables:**
- ✅ README complete
- ✅ `bob_sessions/` clean
- ✅ No secrets in repo
- ✅ Slides ready
- ✅ Repo pushed

**Time Budget:** 120 minutes  
**Fallback:** None. Final prep critical.

---

**Wave 5 Checkpoint (Hour 44):**
- ✅ Demo runs successfully
- ✅ Pre-recorded backup ready
- ✅ Documentation complete
- ✅ Repo clean and pushed

**Decision Point:** Proceed to submission.

---

## Wave 6: Submission (Hour 44-48)

**Goal:** Submission complete, demo URL live, rest before judging.

### Hour 44-46: Submission Package

**Owner:** Team lead

**Tasks:**
- [ ] Create cover image (1920x1080)
- [ ] Record video presentation (if required)
- [ ] Fill out lablab.ai submission form
- [ ] Submit
- [ ] Verify submission appears

**Deliverables:**
- ✅ Cover image created
- ✅ Video presentation recorded (if required)
- ✅ Submission confirmed

**Time Budget:** 120 minutes  
**Fallback:** None. Submission mandatory.

---

### Hour 46-48: Final Verification & Rest

**Owner:** Full team

**Tasks:**
- [ ] Verify demo URL accessible (different network, mobile)
- [ ] Verify GitHub repo (README, bob_sessions, no secrets)
- [ ] Verify video plays correctly
- [ ] Send demo URL to team for final check
- [ ] Set alarm for judging time
- [ ] Sleep

**Deliverables:**
- ✅ All URLs verified
- ✅ Team notified
- ✅ Rested for judging

**Time Budget:** 120 minutes  
**Fallback:** None. Rest critical.

---

**Wave 6 Checkpoint (Hour 48):**
- ✅ Submission complete
- ✅ Demo URL live
- ✅ Ready for judging

---

</content>
<line_count>738</line_count>
</write_to_file>

---

**User:**

[write_to_file for 'IMPLEMENTATION-ROADMAP.md'] Result:
<file_write_result>
<path>IMPLEMENTATION-ROADMAP.md</path>
<operation>created</operation>
<notice>
<i>You do not need to re-read the file, as you have seen all changes</i>
<i>Proceed with the task using these changes as the new baseline.</i>
</notice>
</file_write_result>

<environment_details>
# VSCode Visible Files
IMPLEMENTATION-ROADMAP.md

# VSCode Open Tabs
IMPLEMENTATION-ROADMAP.md

# Current Time
Current time in ISO 8601 UTC format: 2026-05-16T10:40:06.650Z
User time zone: Asia/Calcutta, UTC+5:30

# Current Cost
$0.65

# Review Exclusions
The following file patterns are excluded from code reviews:
- .vscode/**
- .env
- .env.*
- secrets/
- *.key
- *.pem
- *.p12
- *.crt
- config/credentials.json
- .next/
- node_modules/
- dist/
- build/
- .turbo/
- coverage/
- .DS_Store
- bob_sessions/

# Current Mode
<slug>plan</slug>
<name>📝 Plan</name>
====

REMINDERS

Below is your current list of reminders for this task. Keep them updated as you progress.

| # | Content | Status |
|---|---------|--------|
| 1 | Analyze system design and create implementation roadmap structure | In Progress |
| 2 | Define Hour 0-4: Foundation phase with repo skeleton, MCP server, and database setup | Pending |
| 3 | Define Hour 4-12: Surgeon end-to-end on trivial migration with minimal Cartographer | Pending |
| 4 | Define Hour 12-24: Add depth - Neo4j, pgvector, full agent implementations | Pending |
| 5 | Define Hour 24-36: Build companion web app and demo experience | Pending |
| 6 | Define Hour 36-44: Polish, demo prep, and testing | Pending |
| 7 | Define Hour 44-48: Submission and final verification | Pending |
| 8 | Design detailed agent architectures with Zod schemas and interfaces | Pending |
| 9 | Create fallback decision matrix for each checkpoint | Pending |
| 10 | Define critical path dependencies and parallel work streams | Pending |


IMPORTANT: When task status changes, remember to call the `update_todo_list` tool to update your progress.

</environment_details>

---

**Assistant:**

Now let me add the remaining sections with agent architecture details, fallback matrix, and parallel work streams.

<insert_content>
<path>IMPLEMENTATION-ROADMAP.md</path>
<line>0</line>
<content>
## Agent Architecture Details

### Shared Types & Schemas

```typescript
// packages/shared/src/types.ts
import { z } from 'zod';

// Core domain types
export const SemverRangeSchema = z.string().regex(/^\d+\.\d+\.\d+$/);

export const EcosystemSchema = z.enum(['npm', 'pypi', 'cargo', 'maven']);

export const SeveritySchema = z.enum(['low', 'medium', 'high', 'critical']);

export const JobStateSchema = z.enum([
  'draft', 'planning', 'planned', 'cloning', 'cloned',
  'indexing', 'indexed', 'patching', 'patched',
  'testing', 'tested', 'auditing', 'audited', 'done',
  'failed', 'aborted', 'paused'
]);

export const ConfidenceSchema = z.number().min(0).max(1);
```

---

### Cartographer Architecture

**Purpose:** Reads upstream breaking-change catalogs and produces structured migration maps.

**Input Schema:**
```typescript
export const CartographerInputSchema = z.object({
  ecosystem: EcosystemSchema,
  source: SemverRangeSchema,
  target: SemverRangeSchema,
  cacheKey: z.string().optional()
});
```

**Output Schema:**
```typescript
export const BreakingChangeSchema = z.object({
  id: z.string(),
  category: z.string(),
  severity: SeveritySchema,
  detection: z.object({
    pattern: z.string(),
    astQuery: z.string().optional(),
    regexPattern: z.string().optional()
  }),
  prescription: z.object({
    codemod: z.string(),
    manualNotes: z.string(),
    automationConfidence: ConfidenceSchema
  }),
  references: z.array(z.string().url()),
  affectedSymbols: z.array(z.string()).optional()
});

export const CartographerOutputSchema = z.object({
  mapId: z.string().uuid(),
  ecosystem: EcosystemSchema,
  source: SemverRangeSchema,
  target: SemverRangeSchema,
  breakingChanges: z.array(BreakingChangeSchema),
  generatedAt: z.string().datetime(),
  sourceUrls: z.array(z.string().url())
});
```

**Data Flow:**
1. Check cache for `(ecosystem, source, target)` tuple
2. If miss, fetch from curated registry of changelog URLs
3. Parse changelog (markdown → structured data)
4. For ambiguous entries, elicit Bob's LLM via MCP
5. Normalize to `BreakingChange[]` schema
6. Write to `breaking_change_maps` and `breaking_changes` tables
7. Return map ID

**Database Schema:**
```sql
CREATE TABLE breaking_change_maps (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ecosystem TEXT NOT NULL,
  source_version TEXT NOT NULL,
  target_version TEXT NOT NULL,
  generated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source_urls JSONB NOT NULL,
  UNIQUE(ecosystem, source_version, target_version)
);

CREATE TABLE breaking_changes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  map_id UUID NOT NULL REFERENCES breaking_change_maps(id),
  change_id TEXT NOT NULL,
  category TEXT NOT NULL,
  severity TEXT NOT NULL,
  detection JSONB NOT NULL,
  prescription JSONB NOT NULL,
  references JSONB NOT NULL,
  affected_symbols JSONB
);
```

**Implementation Notes:**
- MVP: Hardcoded React 18→19 map (skip fetching)
- Production: Fetch from GitHub releases, parse with unified/remark
- Elicitation: Only for ambiguous severity classification

---

### Surgeon Architecture

**Purpose:** Identifies affected files and generates migration patches.

**Input Schema:**
```typescript
export const SurgeonInputSchema = z.object({
  snapshotId: z.string().uuid(),
  breakingChangeMapId: z.string().uuid(),
  retrievalMode: z.enum(['structural', 'semantic', 'hybrid']).default('hybrid')
});
```

**Output Schema:**
```typescript
export const PatchSchema = z.object({
  id: z.string().uuid(),
  filePath: z.string(),
  before: z.string(),
  after: z.string(),
  appliedRuleIds: z.array(z.string()),
  rationale: z.string(),
  confidence: ConfidenceSchema,
  status: z.enum(['resolved', 'unresolved', 'manual']),
  unresolvedReason: z.string().optional()
});

export const SurgeonOutputSchema = z.object({
  batchId: z.string().uuid(),
  patches: z.array(PatchSchema),
  stats: z.object({
    filesAnalyzed: z.number(),
    filesPatched: z.number(),
    rulesApplied: z.number(),
    unresolvedSites: z.number()
  })
});
```

**Data Flow:**
1. Load breaking changes from DB
2. **Structural Retrieval** (Neo4j):
   - Query: "Files importing affected symbols"
   - Query: "Files with transitive dependencies on affected modules"
3. **Semantic Retrieval** (pgvector):
   - Query: "Files semantically similar to breaking-change examples"
   - Threshold: cosine similarity > 0.7
4. **Hybrid Ranking**:
   - Combine structural (weight 0.7) + semantic (weight 0.3)
   - Sort by confidence score
5. **Codemod Pipeline**:
   - For each candidate file:
     - Parse with ts-morph or jscodeshift
     - Apply deterministic transform
     - If transform fails → mark "unresolved"
     - If unresolved → elicit Bob's LLM
6. Write patches to `patches` table
7. Return batch ID

**Database Schema:**
```sql
CREATE TABLE patches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id),
  batch_id UUID NOT NULL,
  file_path TEXT NOT NULL,
  before_content TEXT NOT NULL,
  after_content TEXT NOT NULL,
  applied_rule_ids JSONB NOT NULL,
  rationale TEXT NOT NULL,
  confidence NUMERIC(3,2) NOT NULL,
  status TEXT NOT NULL,
  unresolved_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_patches_batch ON patches(batch_id);
CREATE INDEX idx_patches_job ON patches(job_id);
```

**Codemod Example (React 19 useEffect cleanup):**
```typescript
import * as ts from 'typescript';

export function fixUseEffectCleanup(sourceFile: ts.SourceFile): ts.TransformationResult<ts.SourceFile> {
  const transformer = <T extends ts.Node>(context: ts.TransformationContext) => {
    return (rootNode: T) => {
      function visit(node: ts.Node): ts.Node {
        if (ts.isCallExpression(node) && 
            node.expression.getText() === 'useEffect') {
          const callback = node.arguments[0];
          if (ts.isArrowFunction(callback) || ts.isFunctionExpression(callback)) {
            const body = callback.body;
            // Check if cleanup returns non-function/undefined
            // Wrap with explicit return undefined if needed
            // (Simplified - real version needs deeper analysis)
          }
        }
        return ts.visitEachChild(node, visit, context);
      }
      return ts.visitNode(rootNode, visit);
    };
  };
  
  return ts.transform(sourceFile, [transformer]);
}
```

**Implementation Notes:**
- MVP: Single codemod, structural retrieval only (no Neo4j)
- Production: 5+ codemods, hybrid retrieval
- Elicitation: For unresolved sites only (not every file)

---

### Examiner Architecture

**Purpose:** Generates regression tests that lock in migrated behavior.

**Input Schema:**
```typescript
export const ExaminerInputSchema = z.object({
  patchBatchId: z.string().uuid(),
  testStrategy: z.enum(['snapshot', 'property', 'hybrid']).default('snapshot')
});
```

**Output Schema:**
```typescript
export const GeneratedTestSchema = z.object({
  id: z.string().uuid(),
  targetPatchId: z.string().uuid(),
  testFilePath: z.string(),
  testContent: z.string(),
  harness: z.string(), // 'jest' | 'vitest' | 'mocha'
  beforeBehaviour: z.string(),
  afterBehaviour: z.string(),
  canPass: z.boolean()
});

export const ExaminerOutputSchema = z.object({
  batchId: z.string().uuid(),
  tests: z.array(GeneratedTestSchema),
  stats: z.object({
    testsGenerated: z.number(),
    testsPassable: z.number()
  })
});
```

**Data Flow:**
1. Load patches from DB
2. Detect test framework in repo (package.json, existing tests)
3. For each patch:
   - Analyze file type (component, hook, utility)
   - Generate appropriate test:
     - **Snapshot**: Render before/after, compare output
     - **Property**: Assert invariants from breaking-change prescription
4. Validate test can pass against patched code
5. If test fails → lower patch confidence
6. Write to `generated_tests` table
7. Return batch ID

**Database Schema:**
```sql
CREATE TABLE generated_tests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id),
  batch_id UUID NOT NULL,
  target_patch_id UUID NOT NULL REFERENCES patches(id),
  test_file_path TEXT NOT NULL,
  test_content TEXT NOT NULL,
  harness TEXT NOT NULL,
  before_behaviour TEXT NOT NULL,
  after_behaviour TEXT NOT NULL,
  can_pass BOOLEAN NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_generated_tests_batch ON generated_tests(batch_id);
```

**Test Generation Example:**
```typescript
function generateSnapshotTest(patch: Patch, harness: string): string {
  const componentName = path.basename(patch.filePath, '.tsx');
  
  return `
import { render } from '@testing-library/react';
import ${componentName} from '${patch.filePath}';

describe('Migration regression: ${patch.filePath}', () => {
  it('should maintain behavior after React 19 migration', () => {
    const { container } = render(<${componentName} />);
    expect(container).toMatchSnapshot();
  });
  
  it('should handle cleanup correctly', () => {
    const { unmount } = render(<${componentName} />);
    expect(() => unmount()).not.toThrow();
  });
});
  `.trim();
}
```

**Implementation Notes:**
- MVP: Snapshot tests only, Jest assumed
- Production: Detect framework, generate property tests
- Validation: Run test in sandbox before storing

---

### Auditor Architecture

**Purpose:** Executes patches in isolated sandbox, runs tests, signs report.

**Input Schema:**
```typescript
export const AuditorInputSchema = z.object({
  patchBatchId: z.string().uuid(),
  generatedTestBatchId: z.string().uuid(),
  sandboxProvider: z.enum(['vercel', 'e2b', 'local']).default('vercel')
});
```

**Output Schema:**
```typescript
export const AuditReportSchema = z.object({
  id: z.string().uuid(),
  jobId: z.string().uuid(),
  runResults: z.object({
    baselineTests: z.object({
      passed: z.number(),
      failed: z.number(),
      skipped: z.number(),
      duration: z.number()
    }),
    regressionTests: z.object({
      passed: z.number(),
      failed: z.number(),
      skipped: z.number(),
      duration: z.number()
    })
  }),
  divergences: z.array(z.string()),
  bobSessionRefs: z.array(z.string()),
  signature: z.string(),
  publicKey: z.string(),
  signedAt: z.string().datetime(),
  sandboxImage: z.string(),
  artifacts: z.object({
    logs: z.string().url(),
    coverage: z.string().url().optional()
  })
});
```

**Data Flow:**
1. Create ephemeral sandbox container
2. Materialize repo snapshot into sandbox
3. Apply patches in dependency order (from Neo4j)
4. Run `npm install` (or language equivalent)
5. Run existing test suite (baseline)
6. Run generated tests (regression)
7. Capture:
   - Test outputs (stdout/stderr)
   - Exit codes
   - Resource usage
   - Stack traces (if failures)
8. Generate canonical JSON report
9. Sign with per-job ed25519 key
10. Write to `audit_runs` and `audit_signatures` tables
11. Upload artifacts to blob storage
12. Return report

**Database Schema:**
```sql
CREATE TABLE audit_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id),
  patch_batch_id UUID NOT NULL,
  test_batch_id UUID NOT NULL,
  sandbox_image TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  finished_at TIMESTAMPTZ,
  baseline_results JSONB NOT NULL,
  regression_results JSONB NOT NULL,
  divergences JSONB NOT NULL,
  bob_session_refs JSONB NOT NULL,
  artifacts JSONB NOT NULL
);

CREATE TABLE audit_signatures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  audit_run_id UUID NOT NULL REFERENCES audit_runs(id),
  public_key TEXT NOT NULL,
  signature TEXT NOT NULL,
  signed_bundle_sha256 TEXT NOT NULL,
  signed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE signing_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  job_id UUID NOT NULL REFERENCES jobs(id),
  public_key TEXT NOT NULL,
  encrypted_private_key TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Signing Implementation:**
```typescript
import * as ed from '@noble/ed25519';
import { createHash } from 'crypto';

export class SigningService {
  async generateKeypair(jobId: string) {
    const privateKey = ed.utils.randomPrivateKey();
    const publicKey = await ed.getPublicKey(privateKey);
    
    // Encrypt private key with server KEK
    const encryptedPrivateKey = await this.encrypt(privateKey);
    
    await db.insert(signingKeys).values({
      jobId,
      publicKey: Buffer.from(publicKey).toString('hex'),
      encryptedPrivateKey
    });
    
    return { publicKey, privateKey };
  }
  
  async sign(report: AuditReport, privateKey: Uint8Array): Promise<string> {
    // Canonical JSON (sorted keys, no whitespace)
    const canonical = JSON.stringify(report, Object.keys(report).sort());
    const message = new TextEncoder().encode(canonical);
    const signature = await ed.sign(message, privateKey);
    return Buffer.from(signature).toString('hex');
  }
  
  async verify(report: AuditReport, signature: string, publicKey: string): Promise<boolean> {
    const canonical = JSON.stringify(report, Object.keys(report).sort());
    const message = new TextEncoder().encode(canonical);
    const sig = Buffer.from(signature, 'hex');
    const pub = Buffer.from(publicKey, 'hex');
    return ed.verify(sig, message, pub);
  }
}
```

**Implementation Notes:**
- MVP: Vercel Sandbox, basic test execution
- Production: Full resource monitoring, coverage reports
- Signature: Covers report + patch bundle SHA + Bob session SHAs

---

## Fallback Decision Matrix

| Checkpoint | Condition | Fallback Action | Impact | Recovery Time |
|------------|-----------|-----------------|--------|---------------|
| **Hour 4: Bob Integration** | Bob cannot call MCP tools | STOP - Debug MCP connection | Critical - No project without Bob | 1-2 hours |
| **Hour 4: Database** | Neon unavailable | Switch to local Postgres in Docker | Low - Same API | 30 minutes |
| **Hour 12: End-to-End Patch** | Cannot generate working patch | PIVOT to "Test Crew" product | High - Different product | 0 (new direction) |
| **Hour 12: Codemod** | AST transforms too complex | Use regex-based transforms | Medium - Less accurate | 1 hour |
| **Hour 15: Neo4j** | Neo4j too slow or unavailable | Use in-memory graph (Map) | Medium - No persistence | 2 hours |
| **Hour 18: Embeddings** | pgvector too slow | Skip semantic retrieval | Low - Structural still works | 0 (cut feature) |
| **Hour 21: Sandbox** | Vercel Sandbox unavailable | Use e2b.dev or local Docker | Low - Same interface | 1 hour |
| **Hour 24: Real Repo** | Real repo fails to migrate | Cut Neo4j OR embeddings | Medium - Reduced accuracy | 0 (cut feature) |
| **Hour 27: Web App** | Deployment fails | Use Netlify or Railway | Low - Same app | 30 minutes |
| **Hour 33: 3D KG** | 3D rendering too slow | Fall back to 2D force graph | Low - Still visual | 1 hour |
| **Hour 36: SSE** | SSE not working | Use polling (5s interval) | Low - Less real-time | 30 minutes |
| **Hour 42: Live Demo** | Demo unreliable | Use pre-recorded video | Medium - Less impressive | 0 (already prepared) |

**Decision Rules:**
1. **Never compromise Bob integration** - This is the core differentiator
2. **Protect the critical path** - Foundation → Patch → Audit → Demo
3. **Cut features, not quality** - Better to have fewer features working perfectly
4. **Pre-record early** - Backup video by Hour 40, not Hour 44
5. **Test fallbacks** - Verify each fallback works before relying on it

---

## Parallel Work Streams

### Stream A: Backend Core (Critical Path)
**Owner:** Backend Lead  
**Dependencies:** None (starts Hour 0)

| Hours | Tasks |
|-------|-------|
| 0-1 | Repo skeleton, monorepo setup |
| 1-2 | MCP server skeleton, stdio transport |
| 3-4 | Database foundation, Drizzle schemas |
| 5-7 | File indexing, TypeScript AST parsing |
| 12-15 | Neo4j integration, graph queries |
| 15-18 | pgvector, embeddings generation |
| 21-24 | Auditor, sandbox integration |
| 33-36 | HTTP/SSE transport for MCP server |

**Handoffs:**
- Hour 2 → Stream B (Bob integration needs MCP server)
- Hour 7 → Stream C (Surgeon needs indexing)
- Hour 24 → Stream D (Web app needs audit data)

---

### Stream B: Bob Integration (Critical Path)
**Owner:** Full Team (Hour 2-3 only)  
**Dependencies:** Stream A (MCP server)

| Hours | Tasks |
|-------|-------|
| 2-3 | Bob mode, slash command, integration test |
| 10-12 | End-to-end test with Bob |
| 36-38 | Demo preparation with Bob |
| 40-42 | Demo rehearsal with Bob |

**Handoffs:**
- Hour 3 → Stream A (confirms MCP works)
- Hour 12 → Decision point (pivot or continue)

---

### Stream C: Agent Logic (Critical Path)
**Owner:** Agent Lead  
**Dependencies:** Stream A (indexing), Stream B (Bob working)

| Hours | Tasks |
|-------|-------|
| 4-5 | Cartographer, breaking-change map |
| 7-10 | Surgeon, codemod pipeline |
| 18-21 | Examiner, test generation |

**Handoffs:**
- Hour 10 → Stream B (end-to-end test)
- Hour 21 → Stream A (Auditor needs tests)

---

### Stream D: Frontend (Parallel, Non-Critical)
**Owner:** Frontend Lead  
**Dependencies:** Stream A (audit data), starts Hour 24

| Hours | Tasks |
|-------|-------|
| 24-27 | Next.js app, landing page, deployment |
| 27-30 | Audit report page, signature verification |
| 30-33 | 3D knowledge graph, visualization |

**Handoffs:**
- Hour 36 → Stream E (demo needs web app)

---

### Stream E: Demo & Polish (Critical Path)
**Owner:** Full Team  
**Dependencies:** All streams, starts Hour 36

| Hours | Tasks |
|-------|-------|
| 36-38 | Demo preparation, target repo selection |
| 38-40 | Pre-record backup video |
| 40-42 | Live demo rehearsal (5x) |
| 42-44 | Documentation, secret scan, final polish |
| 44-46 | Submission package |
| 46-48 | Final verification, rest |

**Handoffs:**
- Hour 48 → Judging

---

### Resource Allocation

**Team Size:** 3-4 people recommended

**Role Distribution:**
- **Backend Lead** (1 person): Streams A, B (partial)
- **Agent Lead** (1 person): Stream C
- **Frontend Lead** (1 person): Stream D
- **Full Team** (all): Streams B (Hour 2-3), E (Hour 36-48)

**Critical Pairing Moments:**
- Hour 2-3: Everyone on Bob integration
- Hour 10-12: Everyone on end-to-end test
- Hour 36-48: Everyone on demo prep

**Solo Work Allowed:**
- Hour 4-10: Agents can work independently
- Hour 24-36: Frontend can work independently
- Hour 12-24: Backend can work independently

---

## Risk Mitigation Strategies

### Technical Risks

**Risk:** MCP SDK has breaking changes or bugs  
**Mitigation:** Test MCP integration in Hour 1-2, before building on it  
**Fallback:** Implement raw JSON-RPC over stdio (adds 2 hours)

**Risk:** TypeScript AST parsing too slow for large repos  
**Mitigation:** Profile early (Hour 5-7), optimize or fall back to regex  
**Fallback:** Regex-based pattern matching (less accurate, faster)

**Risk:** Neo4j free tier quota exceeded  
**Mitigation:** Monitor usage, implement in-memory fallback  
**Fallback:** Map<string, string[]> for import graph (no persistence)

**Risk:** Sandbox provider (Vercel/e2b) unavailable during demo  
**Mitigation:** Test both providers, have local Docker fallback  
**Fallback:** Run tests locally (less isolated but works)

### Process Risks

**Risk:** Team member unavailable mid-hackathon  
**Mitigation:** Document all decisions, keep code self-explanatory  
**Fallback:** Remaining team picks up work (slower but possible)

**Risk:** Scope creep (adding features not in plan)  
**Mitigation:** Strict adherence to checkpoint gates  
**Fallback:** Cut features at each checkpoint if behind schedule

**Risk:** Demo fails live on stage  
**Mitigation:** Pre-record backup by Hour 40, rehearse 5x  
**Fallback:** Switch to pre-recorded video seamlessly

### External Risks

**Risk:** Neon/Neo4j/Upstash service outage  
**Mitigation:** Have local alternatives ready (Docker Compose)  
**Fallback:** Run entire stack locally for demo

**Risk:** GitHub rate limits during demo  
**Mitigation:** Pre-clone all demo repos, use local copies  
**Fallback:** Demo with local repos only

**Risk:** Internet connectivity issues during demo  
**Mitigation:** Pre-load all assets, run MCP server locally  
**Fallback:** Fully offline demo mode

---

## Success Metrics

### Minimum Viable Demo (Must Have)
- ✅ Bob calls Renatus MCP tools successfully
- ✅ At least one working patch generated
- ✅ Patch applied and code still works
- ✅ Audit report generated (even if unsigned)
- ✅ Web app shows audit report
- ✅ `bob_sessions/` has exported sessions

### Target Demo (Should Have)
- ✅ Real OSS repo migrates end-to-end
- ✅ Multiple patches generated (5+)
- ✅ Tests run in sandbox
- ✅ Audit report signed and verifiable
- ✅ 3D KG visualization works
- ✅ Live demo runs in <90 seconds

### Stretch Demo (Nice to Have)
- ✅ Multiple migration targets (React + Tailwind)
- ✅ Semantic retrieval working
- ✅ Property-based tests generated
- ✅ SSE live progress feed
- ✅ Mobile-responsive web app

---

## Post-Hackathon Roadmap

**Not in scope for 48 hours, but designed for:**

1. **Multi-language support** - Python, Rust, Java codemods
2. **PR automation** - Auto-create pull requests with patches
3. **Slack/Discord bots** - ChatOps interface
4. **Enterprise features** - SSO, audit retention, compliance reports
5. **Marketplace** - Community-contributed breaking-change maps
6. **CI/CD integration** - GitHub Actions, GitLab CI plugins
7. **Diff visualization** - Side-by-side before/after in web app
8. **Rollback support** - Undo migrations with one command

---

*End of Implementation Roadmap*

</content>
</insert_content>

---

**User:**

[insert_content for 'IMPLEMENTATION-ROADMAP.md'] Result:
<file_write_result>
<path>IMPLEMENTATION-ROADMAP.md</path>
<operation>modified</operation>
<notice>
<i>You do not need to re-read the file, as you have seen all changes</i>
<i>Proceed with the task using these changes as the new baseline.</i>
</notice>
</file_write_result>

<environment_details>
# VSCode Visible Files
IMPLEMENTATION-ROADMAP.md

# VSCode Open Tabs
IMPLEMENTATION-ROADMAP.md

# Current Time
Current time in ISO 8601 UTC format: 2026-05-16T10:41:54.617Z
User time zone: Asia/Calcutta, UTC+5:30

# Current Cost
$0.80

# Review Exclusions
The following file patterns are excluded from code reviews:
- .vscode/**
- .env
- .env.*
- secrets/
- *.key
- *.pem
- *.p12
- *.crt
- config/credentials.json
- .next/
- node_modules/
- dist/
- build/
- .turbo/
- coverage/
- .DS_Store
- bob_sessions/

# Current Mode
<slug>plan</slug>
<name>📝 Plan</name>
====

REMINDERS

Below is your current list of reminders for this task. Keep them updated as you progress.

| # | Content | Status |
|---|---------|--------|
| 1 | Analyze system design and create implementation roadmap structure | In Progress |
| 2 | Define Hour 0-4: Foundation phase with repo skeleton, MCP server, and database setup | Pending |
| 3 | Define Hour 4-12: Surgeon end-to-end on trivial migration with minimal Cartographer | Pending |
| 4 | Define Hour 12-24: Add depth - Neo4j, pgvector, full agent implementations | Pending |
| 5 | Define Hour 24-36: Build companion web app and demo experience | Pending |
| 6 | Define Hour 36-44: Polish, demo prep, and testing | Pending |
| 7 | Define Hour 44-48: Submission and final verification | Pending |
| 8 | Design detailed agent architectures with Zod schemas and interfaces | Pending |
| 9 | Create fallback decision matrix for each checkpoint | Pending |
| 10 | Define critical path dependencies and parallel work streams | Pending |


IMPORTANT: When task status changes, remember to call the `update_todo_list` tool to update your progress.

</environment_details>

---

**Assistant:**

<update_todo_list>
<todos>
[x] Analyze system design and create implementation roadmap structure
[x] Define Hour 0-4: Foundation phase with repo skeleton, MCP server, and database setup
[x] Define Hour 4-12: Surgeon end-to-end on trivial migration with minimal Cartographer
[x] Define Hour 12-24: Add depth - Neo4j, pgvector, full agent implementations
[x] Define Hour 24-36: Build companion web app and demo experience
[x] Define Hour 36-44: Polish, demo prep, and testing
[x] Define Hour 44-48: Submission and final verification
[x] Design detailed agent architectures with Zod schemas and interfaces
[x] Create fallback decision matrix for each checkpoint
[x] Define critical path dependencies and parallel work streams
</todos>
</update_todo_list>

---

**User:**

[update_todo_list] Result:
Todo list updated successfully.
<environment_details>
# VSCode Visible Files


# VSCode Open Tabs
IMPLEMENTATION-ROADMAP.md

# Current Time
Current time in ISO 8601 UTC format: 2026-05-16T10:43:16.794Z
User time zone: Asia/Calcutta, UTC+5:30

# Current Cost
$0.95

# Review Exclusions
The following file patterns are excluded from code reviews:
- .vscode/**
- .env
- .env.*
- secrets/
- *.key
- *.pem
- *.p12
- *.crt
- config/credentials.json
- .next/
- node_modules/
- dist/
- build/
- .turbo/
- coverage/
- .DS_Store
- bob_sessions/

# Current Mode
<slug>plan</slug>
<name>📝 Plan</name>
====

REMINDERS

Below is your current list of reminders for this task. Keep them updated as you progress.

| # | Content | Status |
|---|---------|--------|
| 1 | Analyze system design and create implementation roadmap structure | Completed |
| 2 | Define Hour 0-4: Foundation phase with repo skeleton, MCP server, and database setup | Completed |
| 3 | Define Hour 4-12: Surgeon end-to-end on trivial migration with minimal Cartographer | Completed |
| 4 | Define Hour 12-24: Add depth - Neo4j, pgvector, full agent implementations | Completed |
| 5 | Define Hour 24-36: Build companion web app and demo experience | Completed |
| 6 | Define Hour 36-44: Polish, demo prep, and testing | Completed |
| 7 | Define Hour 44-48: Submission and final verification | Completed |
| 8 | Design detailed agent architectures with Zod schemas and interfaces | Completed |
| 9 | Create fallback decision matrix for each checkpoint | Completed |
| 10 | Define critical path dependencies and parallel work streams | Completed |


IMPORTANT: When task status changes, remember to call the `update_todo_list` tool to update your progress.

</environment_details>

---

**Assistant:**

<attempt_completion>
<result>
Created comprehensive 48-hour implementation roadmap in [`IMPLEMENTATION-ROADMAP.md`](IMPLEMENTATION-ROADMAP.md:1)

**What's included:**

**6 Build Waves with Hour-by-Hour Breakdown:**
- Wave 1 (Hour 0-4): Foundation - Bob integration, MCP server, database
- Wave 2 (Hour 4-12): Core pipeline - Cartographer, Surgeon, end-to-end patch
- Wave 3 (Hour 12-24): Production depth - Neo4j, embeddings, Examiner, Auditor
- Wave 4 (Hour 24-36): Experience layer - Web app, audit page, 3D KG
- Wave 5 (Hour 36-44): Polish & demo - Rehearsal, pre-recording, documentation
- Wave 6 (Hour 44-48): Submission and final verification

**Detailed Agent Architectures:**
- Complete Zod schemas for all 4 agents (Cartographer, Surgeon, Examiner, Auditor)
- Input/output contracts with type definitions
- Data flow diagrams and database schemas
- Implementation examples with TypeScript code
- Signing service with ed25519 cryptography

**Risk Management:**
- Fallback decision matrix with 12 critical checkpoints
- Recovery time estimates for each fallback
- Decision rules for feature cuts vs. quality compromises
- Technical, process, and external risk mitigation strategies

**Parallel Work Streams:**
- 5 coordinated streams (Backend, Bob Integration, Agents, Frontend, Demo)
- Resource allocation for 3-4 person team
- Critical pairing moments and solo work periods
- Handoff points between streams

**Success Metrics:**
- Minimum viable demo (must have)
- Target demo (should have)
- Stretch goals (nice to have)

The roadmap follows the SOP from SYSTEM-DESIGN.md §18 with enhanced detail, realistic time budgets, and clear checkpoint gates. Ready for implementation.
</result>
</attempt_completion>

