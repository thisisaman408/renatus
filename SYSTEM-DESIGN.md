# Renatus — System Design (v4)

> **Audit-grade platform for LLM-driven code changes.** Renatus is the production wrapper around any LLM that touches code: it indexes the repository, hands the LLM the right context, runs the result in an isolated sandbox, and ships a cryptographically signed audit report.
>
> Four agents ship in 48 hours, sharing one engine: **Migrate** (the launch agent), **Refactor**, **Security Audit**, **Codebase Q&A**. The agents differ only in *what* they pass to the same Surgeon — same retrieval, same LLM, same audit chain, same sandbox.
>
> Two entry surfaces: a **Model Context Protocol server** (Bob IDE, Claude Code, Cursor, Windsurf can drive it) and a **standalone web app** (visitors run any agent end-to-end without bringing an LLM — Renatus uses its configured providers: Groq, Gemini, IBM watsonx Granite).
>
> Built for the IBM Bob Hackathon, 15–17 May 2026.

---

## Document map

1. Product
2. Why this wins
3. Entry surfaces
4. System architecture
5. The agents
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
20. Open risks

---

## 1. Product

Renatus is a platform. One engine, four shipping agents, one audit chain:

| Agent | What the user gives it | What Renatus produces | Status in 48h |
| --- | --- | --- | --- |
| **Migrate** | A repo URL + `(ecosystem, fromVersion, toVersion)` — *or* a pasted changelog / diff / upgrade-guide URL | Patched files + regression tests + signed audit | **Headline — ships fully** |
| **Refactor** | A repo URL + a natural-language refactor intent ("rename `getUser` to `loadUser` everywhere", "extract validation into `lib/validators/`") | Patched files + regression tests + signed audit | **Ships** |
| **Security Audit** | A repo URL + a CVE id *or* "scan for OWASP top-10 patterns" | Mitigated files + CVE-replay tests + signed audit | **Ships** |
| **Codebase Q&A** | A repo URL + a natural-language question | Cited answer with file/line refs + a signed transcript | **Ships** (read-only — no patching) |

**Three claims Renatus makes:**

1. **The LLM is not the product.** The bare LLM (Bob, Claude Code, Cursor) can already migrate code, refactor, find CVEs, answer questions. Renatus does not compete with it. Renatus wraps it.
2. **The wrapper is the product.** Cryptographically signed audit, isolated sandbox execution, persistent replayable state, cached cross-user knowledge, and a knowledge graph + semantic index over the repository. Every claim Renatus makes about a change is auditable.
3. **The wrapper is portable AND turnkey.** Any MCP-compliant client drives the engine (Bob, Claude, Cursor) using *their* LLM. Or the engine drives itself via the standalone web app using *its own* configured providers (Groq, Gemini, watsonx). End users never bring an API key.

### Why one engine fits four agents

The infrastructure each agent needs is identical:

```
Indexer → Cartographer → Retrieval → Surgeon (LLM) → Examiner → Auditor → Sign
            │
            └── differs per agent: the rule source
                Migrate:   (ecosystem, versions, [changelog text])
                Refactor:  natural-language intent
                Security:  CVE id / OWASP pattern set
                Q&A:       passthrough (no rules; Surgeon skipped)
```

Only the **Cartographer's input** changes between agents. The rest of the pipeline is unchanged. That is why all four ship in 48 hours — they are not four products, they are four configurations of one product.

---

## 2. Why this wins

| Wedge | Source |
| --- | --- |
| **Four shipping agents, not one** | Migration + Refactor + Security + Q&A all live behind the same engine. Judges asking "what else can it do" get a live answer, not a roadmap. |
| **LLM-driven Cartographer** | Paste any changelog, any `git diff` between version tags, or any upgrade-guide URL. The LLM emits structured rules. Works for migration pairs nobody has hand-written a rule pack for. |
| **Bob is meaningfully used at runtime, not just during build** | MCP server is one of Renatus's two entry points. Bob calls the tools. Session exports are the spine of the audit chain. |
| **Renatus is a real product, not a Bob-only demo** | The standalone web app works without Bob, using Renatus's own LLM providers. Enterprise viability. |
| **Theme match with the hackathon Quickstart** | IBM ships Node 16 → 22 as their quickstart. Renatus generalises that idea to any version pair, any ecosystem, any change kind. |
| **Cryptographically signed audit as a tangible artefact** | Demo prop that outlives the 90s pitch — judges click the URL after, still see the work. Signature covers every Bob session ref. |
| **Knowledge graph is load-bearing, not decorative** | The graph drives retrieval: Surgeon finds candidate files via recursive CTEs, then patches them as a coherent batch. The visualisation animates the actual data flow. |
| **Multi-provider LLM, zero user setup** | Groq for speed, Gemini for 1M-context big repos, watsonx Granite for the IBM signal, MCP elicitation for host-LLM paths. Web app visitors never enter an API key. |
| **WebContainers in the browser** | The audit verification page actually runs the migrated test suite in the visitor's browser. No backend round-trip. Stage-grade demo prop. |
| **Only execution-grade competitor** | One direct competitor (LetUsCook) plans, doesn't execute. Renatus runs and proves — across four agents, not one. |

---

## 3. Entry surfaces

| Surface | Audience | LLM source | What it does |
| --- | --- | --- | --- |
| **Bob slash commands** (`/migrate`, `/refactor`, `/security-audit`, `/ask-codebase`) | Bob users | Bob's own LLM (host) | One keystroke → switches mode → calls the matching MCP tool |
| **Bob custom modes** (Migration, Refactor, Security, Q&A) | Bob users browsing modes | Bob's own LLM (host) | Pre-tunes Bob's reasoning per agent |
| **Bob skill** (`renatus-code-changes` recipe) | Bob users when the LLM picks it organically | Bob's own LLM (host) | Background prompt that biases Bob toward Renatus's tools |
| **MCP server (stdio)** | Bob, Claude Code, Cursor, Windsurf, any MCP client | Caller's LLM via MCP elicitation | The portable engine. Drives the same pipeline as the web app. |
| **MCP server (HTTP/SSE)** | Hosted demo, web app's progress feed, remote clients | Caller's LLM via MCP elicitation | Same controllers as stdio, different transport |
| **Standalone web app** | Anyone — judges without Bob, F500 evaluators, public demo | Renatus's configured providers (Groq / Gemini / watsonx Granite) | Pick agent → paste a repo URL → watch it run. Bring no LLM. |

The MCP server and the web app share one execution engine, one database, one audit chain. The four agents share one Cartographer with four rule-source adapters.

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
│  Application   Inngest workflows (one per agent kind)      │
│  Domain        Cartographer (4 rule sources)               │
│                Surgeon / Examiner / Auditor                │
│                Retrieval / Indexer / Signing               │
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

### Stack decisions

| Decision | Rationale |
| --- | --- |
| **Postgres recursive CTEs** for the codebase graph (no Neo4j) | One fewer external service. Recursive CTEs handle ~200-file demo target fine. Promoted to pgGraph post-hackathon if F500 monorepo needs arise. |
| **Inngest** for durable workflows (no BullMQ) | Inngest = FSM + retries + observability + dead-letter + replay, all native. Less code, fewer ops. One workflow definition per agent (`migrate_workflow`, `refactor_workflow`, `security_audit_workflow`, `qa_workflow`) but each composes the same step library. |
| **Vercel AI SDK + AI Gateway** for LLM | One API over Groq / Gemini / watsonx / OpenAI-compat. Gateway gives observability, fallback, retries. Web app visitors *never* see an API-key prompt — keys live in Renatus's env. |
| **Vercel Sandbox + WebContainers** | Backend for real testing, in-browser for the audit replay demo prop. |
| **ts-morph + ast-grep** | ts-morph for TypeScript precision; ast-grep for structural pattern matching across Python / Rust / Java / Go without per-language AST libraries. |

---

## 5. The agents

Each agent is a service class with a Zod-typed contract. Agents do not call each other directly; they read and write through repositories, and the orchestrator (Inngest) advances the job's state. This keeps every agent independently testable, retryable, and replayable.

The four shipping agents share **one Cartographer**, **one Surgeon**, **one Examiner**, **one Auditor**. They differ only in:

- the **rule source** the Cartographer reads
- the **Bob surface markdown** (mode + slash command + skill)
- the **system prompt** the Surgeon assembles

### 5.1 Cartographer — LLM-driven rule generation

The Cartographer turns *any* source describing intended change into a structured `Rule[]` that the Surgeon can act on. This is where the platform's reach comes from.

**Rule sources (one Cartographer, four input modes):**

| Mode | Input | How Cartographer turns it into rules |
| --- | --- | --- |
| `migration-pack` | `(ecosystem, fromVersion, toVersion)` matching a bundled pack (React 18→19, Tailwind 3→4) | Returns the hardcoded pack directly. Deterministic, free, instant. |
| `migration-source` | A changelog text, a `git diff` between tags, or an upgrade-guide URL | Calls `LlmRouter.reason()` with `responseFormat: 'rule-classification'`. The LLM emits structured `MigrationRule[]`. Cached per `sha256(source)` so the second invocation is free. **This is the unlock — any migration pair anywhere becomes supported the first time someone asks for it.** |
| `refactor-intent` | Free-form natural-language refactor request | Calls `LlmRouter.reason()` with `responseFormat: 'refactor-rules'`. The LLM emits `RefactorRule[]` (rename / move / extract / inline / signature change). |
| `cve-advisory` | A CVE id, or an OWASP pattern set | Fetches the advisory text (NVD API) or loads the OWASP rule set. Calls the LLM to emit `Mitigation[]` (which files to patch, what pattern to detect, what fix to apply). |
| `qa-passthrough` | A natural-language question about the repo | No rules emitted. Cartographer is bypassed; Q&A workflow uses only the indexer + retrieval. |

**Caching, by source kind:**

```
cache_key = sha256(canonical(source_text + agent_kind + target_versions))
```

`breaking_change_maps` keyed by `cache_key`. Hit → return cached `Rule[]` directly. Miss → call the LLM, persist the result, return. Second user for the same input pays nothing.

**Output schema (one `Rule` type, polymorphic by `kind`):**

```typescript
const RuleSchema = z.discriminatedUnion('kind', [
  MigrationRuleSchema,   // from migration-pack or migration-source
  RefactorRuleSchema,    // from refactor-intent
  MitigationRuleSchema,  // from cve-advisory
]);
```

All three share the same `(detect: PatternOrAst, fix: CodemodOrInstructions, severity, rationale)` shape. The Surgeon doesn't care which kind it received — it just iterates and patches.

### 5.2 Surgeon — LLM-driven, not codemod-driven

The LLM is the primary mechanism. Codemods are an optional cache for well-known patterns.

**Workflow:**

1. **Retrieve.** Pull the affected file set via the knowledge graph: structural traversal (recursive CTEs over the imports table) ∪ semantic similarity (pgvector cosine search). Rank by combined score.
2. **Context-assemble.** For each candidate file: pull the file + its imports + the relevant rules + repo's existing test style + any prior elicitation results.
3. **Call the LLM** via `LlmAdapter.reason()`. Two paths:
   - **MCP elicitation** (Bob, Claude Code, etc.): the host LLM does the reasoning, free for the caller.
   - **Direct API** (web app): Renatus uses Groq / Gemini / watsonx through Vercel AI Gateway.
4. **Validate.** Parse the proposed file with ts-morph. Syntactically invalid → reject + retry with feedback (max 2 retries).
5. **Persist.** Patch row with `confidence`, `rationale`, full LLM transcript.
6. **Cache the rule.** If the LLM proposed an identical transform for ≥3 separate files (a "deterministic pattern"), promote it to a codemod and cache. Next run uses the codemod and skips the LLM.

**Confidence scoring:**
- `1.0` — promoted-to-codemod pattern; deterministic.
- `0.85` — LLM proposed, parsed clean, no retry.
- `0.7` — LLM proposed, needed 1 retry.
- `0.5` — LLM proposed, 2 retries, marginal.
- `0.3` — LLM gave up; site marked `unresolved`.

### 5.3 Examiner

Generates regression tests for each patched file. Detects the existing test framework (Vitest / Jest / Mocha / Playwright) and matches the repo's style. Two strategies, picked per file: snapshot (capture pre/post behaviour) or property (derive invariant from rule).

For the **Security Audit** agent, Examiner additionally emits a CVE-replay test that asserts the vulnerability is no longer triggerable.

### 5.4 Auditor

Applies every patch in an isolated sandbox, runs the test suites, captures the outcome, signs the result.

Two sandbox modes:
- **Backend** (Vercel Sandbox or e2b.dev): server-side, standard.
- **In-browser** (WebContainers via the audit page): the visitor's browser runs the migrated test suite live. Audit signature is server-side; verification is client-side. Demo prop.

**Signing:** ed25519 via `@noble/curves`. Per-job keypair. Public key published on the web app. The signature covers the canonical JSON of the audit report plus the SHA-256 of the patch bundle and the SHA-256 of every Bob session export referenced. Tampering anywhere breaks the signature.

### 5.5 Q&A — read-only path

The Codebase Q&A agent uses only the **indexer + retrieval + LLM**. No Surgeon. No Auditor. Workflow:

```
query_codebase(repoUrl, question)
  → step: clone (if not already cached)
  → step: index (recursive CTE imports + pgvector embeddings)
  → step: retrieve (structural ∪ semantic, ranked)
  → step: answer (LlmAdapter.reason with cited context)
  → step: sign-transcript (ed25519 over Q + A + cited file shas)
  → return { answer, citations: [{file, line, sha}], signature }
```

Why include Q&A? Because it's **free side-quest** — every piece of infrastructure (indexer, retrieval, LLM router, signing) already exists for the other three agents. Adding Q&A as a shipped feature costs ~1 hour of work and turns the pitch from "code-change tool" to "code-intelligence platform."

---

## 6. MCP tool surface

Tools in three tiers. Bob's LLM picks the tier matching its planning depth.

### Tier 1 — orchestrator (one per agent)

| Tool | Purpose |
| --- | --- |
| `migrate_repository` | One-shot migration: clone → index → cartograph → patch → test → audit. Returns job id + SSE URL. |
| `refactor_repository` | One-shot refactor: clone → index → cartograph (intent → rules) → patch → test → audit. |
| `security_audit_repository` | One-shot security audit: clone → index → cartograph (CVE → mitigations) → patch → test → audit. |
| `query_codebase` | One-shot Q&A: clone → index → retrieve → answer → sign transcript. |

### Tier 2 — per-phase

| Tool | Purpose |
| --- | --- |
| `plan_change` | Cartographer only. Accepts any rule source. Returns the rule set + scope estimate. |
| `execute_step` | Run one phase (`index | retrieve | patch | test | audit`) on an existing job. |
| `pause_job`, `resume_job`, `discard_job` | Lifecycle. |

### Tier 3 — atomic

| Tool | Purpose |
| --- | --- |
| `clone_repository`, `index_repository`, `fetch_changelog`, `find_affected_files`, `propose_patch`, `apply_patch`, `generate_test_for`, `run_test_suite`, `sign_audit` | Each independently safe and idempotent. |

### Read-only

| Tool | Purpose |
| --- | --- |
| `get_job_status`, `get_audit_url`, `list_active_jobs`, `describe_rule` | Status. |

Every tool's request and response is a Zod schema. The schema is both the JSON Schema advertisement and the runtime validator. No tool handler receives unvalidated input.

### Elicitation pattern

`propose_patch`, `generate_test_for`, and Cartographer's `plan_change` may *elicit* from the caller's LLM mid-execution. This is the MCP sampling pattern: tool emits a reasoning request, model answers, tool continues. This is how Renatus borrows the host LLM's intelligence without taking on a token bill.

When the entry surface is the web app (no host LLM), `LlmAdapter` resolves to a configured provider (Groq / Gemini / watsonx) instead of MCP elicitation. Same agent code, different adapter. **Web app visitors do not provide an API key.**

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
| `McpElicitationAdapter` | MCP server entry, Bob/Claude Code calls | Uses MCP sampling. Caller's LLM. Free for caller. Gated behind `MCP_ENABLE_ELICITATION=true` so standalone callers (web app, llm_test) skip the stub. |
| `VercelAiGatewayAdapter` | Web app entry, or MCP HTTP entry when host LLM is unavailable | Routes via Vercel AI Gateway. Provider-pluggable. Observability built in. |
| `GroqAdapter` | Direct (low-latency tier, no Gateway) | Llama 3.3 70B. Fast. Generous free tier. |
| `GeminiAdapter` | Direct (large-context tier) | Gemini 2.0 Flash, 1M context. Free with GCP credits. |
| `WatsonxGraniteAdapter` | Direct (IBM signal) | Granite 3 8B. $80 IBM credits ≈ 800k tokens — comfortably covers the demo. |
| `OpenAiCompatibleAdapter` | Fallback / generic | For Together / Fireworks / any OpenAI-protocol endpoint. |

**Routing policy (defined in `LlmRouter`):**
- If MCP elicitation is enabled (and we're in MCP context) → use it (free, host-LLM).
- Else if `WATSONX_API_KEY` present → use watsonx (sponsor signal).
- Else if `GEMINI_API_KEY` present and context > 100k tokens → use Gemini.
- Else → use Groq.

Agents take a router, not a specific adapter. The router decides per call based on context size, latency budget, and configured providers.

---

## 8. Layered architecture

Seven layers + cross-cutting concerns. Each depends only on the layers below it. Tests substitute any layer.

```
┌─────────────────────────────────────────────────────────────────┐
│ 7. Transport            stdio | HTTP/SSE | Next.js routes       │
├─────────────────────────────────────────────────────────────────┤
│ 6. Controllers          MCP tool handlers + web app handlers    │
├─────────────────────────────────────────────────────────────────┤
│ 5. Application          Per-agent Inngest workflows             │
│                         (migrate / refactor / security / qa)    │
├─────────────────────────────────────────────────────────────────┤
│ 4. Domain               Cartographer (4 rule sources)           │
│                         Surgeon / Examiner / Auditor            │
│                         Retrieval / Indexing / Signing          │
├─────────────────────────────────────────────────────────────────┤
│ 3. LLM                  LlmRouter + LlmAdapter implementations  │
├─────────────────────────────────────────────────────────────────┤
│ 2. Adapters             GitHub | Sandbox | AST | Embeddings     │
├─────────────────────────────────────────────────────────────────┤
│ 1. Repositories + Data  Drizzle (Postgres + pgvector)           │
└─────────────────────────────────────────────────────────────────┘
Cross-cutting: validation (Zod), auth, idempotency, audit trail,
               observability (OpenTelemetry), rate limiting, errors
```

### 8.1 Transport

- **stdio** — local Bob/Claude Code path. MCP SDK's `StdioServerTransport`.
- **HTTP/SSE** — hosted MCP for remote clients + the web app's progress feed. Hono on Vercel functions.
- **Next.js routes** — the web app's own HTTP surface. RSC for static, route handlers for dynamic.

### 8.2 Controllers

One handler per MCP tool; one route handler per web endpoint. Each does: validate → auth → idempotency check → audit-log open → call application service → map errors → audit-log close. No business logic.

### 8.3 Application — Inngest workflows (one per agent)

Four workflows, sharing a step library:

```
migrate_workflow(input)         refactor_workflow(input)
  step: clone                     step: clone
  step: index                     step: index
  step: cartograph(migration-*)   step: cartograph(refactor-intent)
  step: patch (fan-out)           step: patch (fan-out)
  step: test (fan-out)            step: test (fan-out)
  step: audit                     step: audit

security_audit_workflow(input)  qa_workflow(input)
  step: clone                     step: clone (if not cached)
  step: index                     step: index (if not cached)
  step: cartograph(cve-advisory)  step: retrieve
  step: patch (fan-out)           step: answer (LLM)
  step: cve-replay-test           step: sign-transcript
  step: audit                     (no Surgeon, no Auditor)
```

Steps `clone`, `index`, `patch`, `test`, `audit` are *the same function* called from all four workflows. Only the `cartograph` step takes different inputs.

### 8.4 Domain services

Cartographer + Surgeon + Examiner + Auditor + three support services (Retrieval, Indexing, Signing). Pure with respect to transport.

### 8.5 LLM layer

`LlmRouter` + adapters (see §7).

### 8.6 Adapters

- **GitHubAdapter** — Octokit. Clone, fetch metadata, optionally open PR.
- **SandboxAdapter** — Vercel Sandbox default, e2b.dev fallback, WebContainers for browser-side replay. Same interface.
- **AstAdapter** — ts-morph (TypeScript precision) + ast-grep (multi-language pattern matching). Either can drive a transform; choice per rule.
- **EmbeddingsAdapter** — Vercel AI SDK over Voyage AI / watsonx embeddings / local fallback.

### 8.7 Repositories + data

All in Postgres. See §9.

### 8.8 Cross-cutting

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
| `mcp_sessions` | Per Bob/Claude Code session; stamps `bob_task_id` |
| `tool_invocations` | Every MCP tool call |
| `web_jobs` | Web app's direct-mode jobs |
| `jobs` | Top-level jobs across all four agents — `agent_kind` column distinguishes migrate/refactor/security/qa |
| `repo_snapshots` | Immutable cloned-repo records |
| `files` | Per-snapshot file rows (id, path, language, sha) |
| `imports` | Edge table — file → file (replaces Neo4j) |
| `symbols` | Declared symbols per file |
| `symbol_refs` | Edge table — file → symbol references |
| `code_chunks` | File slices for embedding |
| `embeddings` | pgvector(768), HNSW index, cosine |
| `breaking_change_maps` | Cartographer outputs across all four agents, keyed by `cache_key`, cached |
| `breaking_changes` | Individual rules in a map (polymorphic `kind`: migration / refactor / mitigation) |
| `patches` | Surgeon outputs — file path, before, after, applied rule ids, confidence, status, LLM transcript |
| `generated_tests` | Examiner outputs |
| `qa_transcripts` | Q&A agent outputs (question + answer + citations + signature) |
| `audit_runs` | One per Auditor execution |
| `audit_signatures` | Append-only |
| `audit_events` | Append-only, every event in the system |
| `elicitations` | MCP elicitation transcripts |
| `signing_keys` | Per-job ed25519 keypairs (private key encrypted with server KEK) |
| `idempotency_keys` | Idempotency cache (Redis primary, Postgres fallback) |

### 9.2 Graph queries via recursive CTEs (load-bearing, not decorative)

The knowledge graph is the data structure Surgeon queries to decide *which files to patch as a coherent batch*. The 3D visualisation on the web app animates the same query result.

"Every file transitively importing symbol X":

```sql
WITH RECURSIVE reachable AS (
  SELECT from_file_id FROM imports WHERE to_file_id = $1
  UNION
  SELECT i.from_file_id FROM imports i JOIN reachable r ON i.to_file_id = r.from_file_id
)
SELECT DISTINCT from_file_id FROM reachable;
```

For demo-scale repos (~200 files, ~1000 import edges), this completes in <100 ms with a B-tree index on `(to_file_id, from_file_id)`. No Neo4j needed.

Surgeon uses this to **fan out coherent patch batches**: instead of patching file A in isolation and file B in isolation, it finds the import-connected cluster `{A, B, C, D, E}` and patches them together with a single LLM context window. This is the difference between a file-by-file codemod runner and a graph-aware migrator.

### 9.3 Redis (idempotency only)

Redis stays in the stack but its job shrinks: just the idempotency cache. Inngest replaced its workflow/queue role.

### 9.4 Blob (Vercel Blob)

Raw repo tarballs, patch bundles, generated test bundles, audit HTML/PDF, sandbox artifacts. Postgres holds the blob URLs.

---

## 10. End-to-end flows

### 10.1 Via Bob/Claude Code (MCP path) — Migrate

```
User → /migrate react-19
  → Bob mode + skill activate
  → Bob's LLM plans, calls migrate_repository(repoUrl, agent: "migrate",
                                              ecosystem: "npm",
                                              fromVersion: "18", toVersion: "19")
  → Renatus MCP controller validates, auths, creates job (agent_kind=migrate)
  → Inngest migrate_workflow starts:
      → clone → index → cartograph(migration-pack OR migration-source via LLM)
      → patch (LLM elicitation back to Bob's LLM)
      → tests → sandbox → sign
  → SSE stream emits state transitions; Bob renders progress
  → Audit URL returned in MCP response
  → User clicks audit URL → web app shows signed report + KG
```

### 10.2 Via Bob — Refactor

```
User → /refactor "rename getUser to loadUser across the repo"
  → Bob's LLM calls refactor_repository(repoUrl, intent: "rename getUser to loadUser...")
  → Inngest refactor_workflow starts:
      → clone → index → cartograph(refactor-intent — LLM converts intent into RefactorRule[])
      → patch (LLM elicitation)
      → tests → sandbox → sign
  → Same audit URL shape, agent_kind=refactor
```

### 10.3 Via Bob — Security Audit

```
User → /security-audit CVE-2024-XXXXX
  → security_audit_repository(repoUrl, cveId: "CVE-2024-XXXXX")
  → Inngest security_audit_workflow starts:
      → clone → index → cartograph(cve-advisory — fetches NVD, LLM emits Mitigation[])
      → patch
      → cve-replay-test (Examiner emits exploit-attempt regression test)
      → sandbox → sign
```

### 10.4 Via Bob — Codebase Q&A

```
User → /ask-codebase "where is auth middleware composed?"
  → query_codebase(repoUrl, question)
  → Inngest qa_workflow starts:
      → clone (if not cached) → index (if not cached)
      → retrieve (recursive CTE + pgvector)
      → answer (LlmAdapter with cited context)
      → sign-transcript
  → Returns { answer, citations: [{file, line, sha}], signature }
```

### 10.5 Via web app (standalone path) — any agent

```
Visitor → renatus.app → picks agent (Migrate / Refactor / Security / Q&A)
  → Pastes GitHub URL + agent-specific inputs
  → Optional: picks LLM provider (Groq / Gemini / watsonx) — has defaults
  → Web app route handler creates web_job + parent job
  → Same Inngest workflow runs
      → LLM steps use VercelAiGatewayAdapter (Groq / Gemini / watsonx)
      → no MCP elicitation needed
      → VISITOR NEVER PROVIDES AN API KEY
  → Web app subscribes to SSE — shows live progress
  → Audit URL rendered when complete
```

Same Inngest workflows. Same database. Same audit signature shape. Only the `LlmAdapter` differs.

---

## 11. Bob session integration

The load-bearing detail for hackathon judging.

**Every Bob task that calls Renatus exports to `bob_sessions/`:** markdown task export + screenshot of the task consumption summary. Filenames namespace by surface: `bob_sessions/<task_n_phase>/bob_task_<timestamp>.md` and screenshot pair.

**Renatus stamps Bob task ids onto every audit event.** When Bob calls a tool, the MCP transport metadata carries a Bob task id. The controller reads it once and stamps it on `mcp_sessions.bob_task_id`, every `audit_events.bob_task_id`, and the `AuditReport.bobSessionRefs` array.

**The signature covers `bobSessionRefs`.** Tampering with which Bob sessions produced the change breaks the signature. The audit page renders a list of session ids with deep links to the matching `bob_sessions/<file>.md` files (relative paths so they resolve when judges clone the repo locally).

`bob_sessions/` is read-only by convention. Claude Code (or any non-Bob tool) never edits it.

---

## 12. Web app (standalone product surface)

Next.js 16 App Router on Vercel. Not the marketing site — the actual product. Visitors run the same four agents from the browser with zero setup.

### Routes

| Route | Rendering | Purpose |
| --- | --- | --- |
| `/` | RSC static | Landing, install MCP snippet, "Try in browser" CTAs for the 4 agents |
| `/run` | RSC + client form | Pick agent + repo URL + agent-specific inputs → kicks off a job |
| `/migrate` | RSC + client form | Shortcut to `/run?agent=migrate`; same form pre-tuned |
| `/refactor` | RSC + client form | Shortcut to `/run?agent=refactor` |
| `/security` | RSC + client form | Shortcut to `/run?agent=security` |
| `/qa` | RSC + client form | Shortcut to `/run?agent=qa` |
| `/jobs/[jobId]` | RSC + EventSource | Live progress (SSE), final audit link |
| `/audit/[jobId]` | RSC + client island | Signed audit report + signature-verification widget + Bob session links + tool-call timeline |
| `/kg/[jobId]` | Client only, dynamic import | 2D codebase knowledge graph (`react-force-graph-2d`). Promoted to 3D post-hackathon. |
| `/replay/[jobId]` | Client only | **WebContainers** in-browser replay of the migrated test suite |
| `/verify` | Client only | Paste a signed report + public key → verify locally |

### Knowledge graph

Nodes = files; size = LoC; colour = severity of touching rule. Edges = imports. **Animation order = patch-application order from the actual Surgeon run** — the graph visualises the data structure Surgeon used to plan the batch, not a decorative force-layout.

`react-force-graph-2d` on canvas. 2D is the demo default — it's clearer at 90-second pace and works on mobile. 3D upgrade is post-hackathon.

### WebContainers replay (the demo prop)

The audit page embeds StackBlitz WebContainers. The visitor's browser boots a Node runtime, applies the patches, runs the test suite. Result rendered in <30s for the demo repo. **No backend round-trip.** Judges click → 30s later they see green tests in their own browser. That's the visual hero of the demo.

---

## 13. Deployment topology

| Component | Where | Why |
| --- | --- | --- |
| MCP server (stdio) | Published as `@renatus/mcp` on npm; runs locally in Bob via stdio | Lowest latency for the Bob path |
| MCP server (HTTP/SSE) | Vercel Functions (Edge or Node runtime) | Same controllers, hosted demo |
| Web app | Vercel | Edge-rendered, fast |
| Workflows | **Inngest Cloud** (free tier; Inngest dev server locally during build) | Durable, observable, no Redis ops |
| Postgres + pgvector | Neon | Branchable for demos |
| Redis (idempotency only) | Upstash | Generous free tier |
| Blob storage | Vercel Blob | Same vendor surface |
| Backend sandbox | Vercel Sandbox primary; e2b.dev fallback; local Docker for dev | Per-job ephemeral |
| In-browser sandbox | WebContainers via StackBlitz SDK | No infra; runs in visitor's browser |
| LLM routing | Vercel AI Gateway | Multi-provider, observable. Web app visitors never see API keys. |

Single region for the hackathon (iad1). Everything that can be co-located is.

---

## 14. Security & governance

### 14.1 Trust model

| Principal | Capabilities |
| --- | --- |
| Local stdio user (Bob) | Full access to their own jobs in their workspace |
| Hosted MCP user (per-job token) | Read/write own job's resources only |
| Web app visitor | Anonymous session; jobs are theirs while the cookie lives; no API key required |
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
- `discard_job` wipes the workspace.
- User must explicitly `materialise_branch` to write to their own checkout.

### 14.5 LLM-output safety

- Surgeon never executes LLM-emitted code without sandbox isolation.
- Test-runner output is read-only to the Auditor; sandbox cannot mutate Renatus's state.
- AI Gateway logs every prompt + response; full LLM transcript in `elicitations` for replay.

---

## 15. Performance, scaling, concurrency

### 15.1 Within a job

- Cartographer: I/O bound when fetching changelogs. LLM-driven mode is one call (cached on second hit).
- Indexing: CPU bound on AST parsing. Concurrency = available CPUs.
- Retrieval: <100ms even on 200-file repos (recursive CTE + pgvector with HNSW).
- Surgeon: fan-out per coherent batch via Inngest, capped at 8 concurrent LLM calls.
- Examiner: fan-out per file.
- Auditor: sequential (one sandbox per job).

### 15.2 Across jobs

- Inngest scales workflows horizontally.
- Postgres connection pool sized by `MAX_CONCURRENT_JOBS × 4`.
- pgvector batched 100-row inserts.

### 15.3 Cache hierarchy

- L1: idempotency cache (Redis) — bare repeats.
- L2: Cartographer's `breaking_change_maps` cache (Postgres) — keyed by `cache_key`. **Critical for the LLM-driven Cartographer**: first user pays the LLM cost, every other user gets the same rule set free.
- L3: codemod promotion (Postgres) — patterns the LLM has solved 3+ times become deterministic codemods that skip the LLM. **Built but not demoed** (judges don't see cache speedup in a 90s arc; not worth screen time).
- L4: embedding cache (Postgres) — keyed by `file.sha`.

### 15.4 Hot-path budgets

- Tier-1 MCP tool response: <300 ms (just enqueues).
- First SSE event: <1 s.
- End-to-end migration on demo target (~200 files, React 18→19): target 4–6 minutes.
- Q&A round trip on cached index: <8s.

---

## 16. Failure modes & recovery

| Failure | Detection | Recovery |
| --- | --- | --- |
| Inngest step failure | Inngest's retry policy | Up to 3 retries, exponential backoff, then dead-letter |
| Sandbox container dies | Auditor non-zero exit + timeout | Re-run; 2× failure → mark `failed` with diagnostics |
| LLM provider rate-limit | 429 from AI Gateway | Gateway fails over to next provider in routing policy |
| LLM hallucinated unparseable code | ts-morph throws | Retry with feedback; 2× retry → mark site `unresolved` |
| LLM Cartographer emits invalid rule schema | Zod parse fails on `Rule[]` | Retry with feedback ("your previous response failed Zod validation: ..."); 2× retry → use bundled migration-pack if available, else fail with clear error |
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

The change is the artefact; the demo is the experience. Plan the 90 seconds first.

### 18.1 The 90-second arc — platform pitch

| Second | Beat |
| --- | --- |
| 0–6 | "Renatus is audit-grade infrastructure for LLM code changes. Migration, refactor, security, Q&A — same engine." |
| 6–18 | Bob in a real OSS React 18 repo. Type `/migrate react-19`. Bob's chat narrates Cartographer's plan (pulled from bundled React 18→19 pack). |
| 18–35 | Second screen: web app's `/jobs/[jobId]` page. 2D knowledge graph pulses as Surgeon patches connected file clusters in batch order. |
| 35–50 | Open `/audit/[jobId]`. Signed audit JSON visible. Click "Replay in browser." |
| 50–65 | **WebContainers boots in the audience's browser.** Tests run live. Green. |
| 65–80 | **Switch agents.** In the web app, click `/refactor`. Paste a repo URL + "rename `getUser` to `loadUser`". Hit run. Show LLM Cartographer turning intent into RefactorRules in real time. Same audit chain. |
| 80–90 | Closing: "Migration. Refactor. Security audit. Q&A. One audit chain. Same engine. Live in the browser. No API key required." |

### 18.2 Backup plan

Pre-record the full flow at quality the moment the first end-to-end migration goes green (Hour ~13). Switch to recording if the live attempt slips its budget by 50%.

### 18.3 Target repository

Primary: a real OSS React 18 codebase, ~200 files, working test suite, no exotic tooling. Two backups pre-staged. Primary pre-migrated and committed under `bob_sessions/` so the demo runs against a clean re-execution.

### 18.4 Second migration (in scope, not stretch)

**Tailwind 3 → 4** pre-baked as a bundled pack. Demonstrates the bundled-pack vs LLM-source duality — judge asks for a third pair, we paste a changelog into `/run` and the LLM generates rules live.

---

## 19. 48-hour build SOP

Detailed wave-by-wave plan lives in `IMPLEMENTATION-ROADMAP.md`. Top-level:

| Wave | Hours | Goal |
| --- | --- | --- |
| 1 | 0–5 | Foundation: monorepo, MCP `ping`, Postgres + Drizzle, Inngest dev, web stub deployed, secret gate, demo repo selected, sandbox smoke-tested, LlmAdapter scaffolded |
| 2 | 5–13 | First end-to-end migration on a tiny fixture. **LLM-driven Cartographer alongside React 18→19 pack.** Backup video recorded here. |
| 3 | 13–26 | Real demo target migrates end-to-end with tests in sandbox and signed audit. **Tailwind 3→4 pack pre-baked. Refactor agent wired end-to-end.** |
| 4 | 26–37 | **Security agent + Q&A agent wired.** Web app pages: 4 agent forms, audit, KG, WebContainers replay, SSE progress |
| 5 | 37–44 | Demo rehearsal × 4, final video record, README, secret scan, four Bob surfaces complete |
| 6 | 44–48 | Submission package; verify; rest |

---

## 20. Open risks

| Risk | Mitigation |
| --- | --- |
| LLM-driven Cartographer hallucinates a bogus rule | Zod-validate the emitted `Rule[]`. If validation fails, retry with feedback. If still invalid after 2 retries, fall back to bundled pack (if one exists for the requested pair) or fail with clear error. Cache successful results to amortise cost. |
| Four agents in 48h is too ambitious | Refactor + Security + Q&A reuse 100% of migrate infrastructure — they're system-prompt + rule-source variants, not separate products. Total marginal effort: ~3 hours. If any of the three slips, drop Q&A first (smallest demo value), then Security (medium), keep Refactor (paired with migration in the demo arc). |
| WebContainers feature flag / browser support | Pre-test on Chrome + Safari; fall back to a static `<video>` of the test run if WebContainers is unavailable |
| Inngest free-tier limits during 48h burst | Inngest dev server runs locally; cloud is the deploy target. Monitor usage. |
| LLM cost during demo | Routing policy prefers free providers (MCP elicitation, Groq) ahead of paid ones. Cartographer cache halves expected cost. |
| AI Gateway as single point of routing failure | Direct adapters bypass Gateway; routing policy can flip to direct in env |
| MCP elicitation latency >5s | Batched per-file elicitations; cached by `(ruleId, fileSha)` |
| Demo target migrates dirtily | Three target candidates pre-staged; cleanest one used |
| Judges asking "why Bob and not just Claude Code" | The standalone web app is the answer — Renatus works either way, but the Bob path has the strongest audit chain |
| Judges asking "is this just a wrapper" | Four shipping agents on one engine, signed audit, LLM-driven Cartographer that generalises to any change source. The wrapper IS the product. |

---

## Appendix A — terminology

- **Snapshot** — an immutable, content-addressed copy of a repo at a git sha.
- **Job** — one execution of any agent pipeline against one snapshot. `agent_kind` column distinguishes migrate/refactor/security/qa.
- **Patch** — a single file-level transformation produced by Surgeon.
- **Rule** — a polymorphic record describing a change to make. Subtypes: `MigrationRule`, `RefactorRule`, `MitigationRule`.
- **Rule source** — the input the Cartographer reads. One of: bundled pack, changelog text, refactor intent, CVE advisory.
- **Audit run** — one Auditor execution against one patch batch.
- **Elicitation** — a mid-tool callback to the caller's LLM via MCP.
- **Surface** — one of the Bob extensions (slash command, mode, skill, MCP) or the standalone web app.

## Appendix B — external standards

- **MCP** — Renatus implements the Model Context Protocol (tools, resources, elicitation/sampling).
- **Conventional Commits** — generated change commits follow the convention.
- **SLSA provenance** — the signed audit report adopts SLSA-like provenance shape.
- **OpenTelemetry** — standard span/metric naming.

## Appendix C — out of scope for 48 hours

- Pull-request automation beyond branch materialisation (`materialise_branch` ships; auto-PR creation is post-hackathon).
- User accounts (per-job tokens only; Better Auth wired post-hackathon).
- Billing / quotas.
- pgGraph upgrade (Postgres recursive CTEs are sufficient for demo scale).
- 3D knowledge graph (2D ships; 3D is post-hackathon).
- Codemod-cache visible demo (cache exists internally, judges don't see the speedup in 90s).

**NOT out of scope (shipping in 48h):**
- Migrate agent (full pipeline)
- Refactor agent (full pipeline)
- Security Audit agent (full pipeline, CVE-replay tests)
- Codebase Q&A agent (read-only, with signed transcript)
- LLM-driven Cartographer (generalises to any change source)

---

*End of system design v4.*
