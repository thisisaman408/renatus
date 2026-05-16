# Wave 1 Closure Notes

**Date:** 2026-05-16  
**Status:** ✅ Complete

## Summary

Wave 1 of the Renatus build is now complete. All core infrastructure is in place, builds are green, and the foundation is ready for Wave 2 agent implementation.

## What Was Built

### 1. Database Layer with Audit Trail (`@renatus/db`)

**New Components:**
- [`McpSessionRepository`](packages/db/src/repositories/mcp-session-repository.ts) — manages MCP session lifecycle with upsert-by-Bob-task-id
- [`ToolInvocationRepository`](packages/db/src/repositories/tool-invocation-repository.ts) — records every tool call with SHA256 hashes of input/output for audit integrity

**Key Features:**
- Uses `@neondatabase/serverless` + `drizzle-orm/neon-http` for serverless-friendly Postgres access
- Automatic hash computation for audit trail (SHA256 of JSON payloads)
- Exported from [`packages/db/src/index.ts`](packages/db/src/index.ts) for use across the monorepo

### 2. MCP Server Audit Integration (`@renatus/mcp-server`)

**Changes:**
- [`withAudit()`](packages/mcp-server/src/audit.ts) higher-order function wraps tool handlers
- Automatically logs every tool invocation to Postgres (when `DATABASE_URL` is set)
- Generates stable Bob task IDs (from `BOB_TASK_ID` env or process-scoped UUID)
- [`ping`](packages/mcp-server/src/tools/ping.ts) tool now writes to `mcp_sessions` and `tool_invocations` tables

**Architecture:**
- Audit is opt-in: if `DATABASE_URL` is missing, tools run without logging (no crash)
- Session upsert on every tool call keeps `last_seen_at` fresh
- Error paths also log to audit trail (with `error_code` field)

### 3. LLM Abstraction Layer (`@renatus/llm`)

**New Package Structure:**
```
packages/llm/
├── src/
│   ├── adapters/
│   │   ├── mcp-elicitation-adapter.ts    # Stub for MCP sampling
│   │   ├── vercel-ai-gateway-adapter.ts  # Vercel AI Gateway integration
│   │   ├── groq-adapter.ts               # Direct Groq (low-latency)
│   │   ├── gemini-adapter.ts             # Direct Gemini (large-context)
│   │   └── watsonx-granite-adapter.ts    # IBM Granite stub (sponsor signal)
│   ├── llm-router.ts                     # Intelligent routing logic
│   └── index.ts
```

**Routing Policy (from SYSTEM-DESIGN.md §7):**
1. If MCP elicitation available → use MCP (delegate to host LLM like Bob)
2. Else if `WATSONX_API_KEY` → use watsonx (sponsor signal)
3. Else if `GEMINI_API_KEY` and context > 100k tokens → use Gemini
4. Else → use Groq (default, low latency)

**Implementation Notes:**
- All adapters conform to [`LlmAdapter`](packages/shared/src/llm-adapter.ts) interface from `@renatus/shared`
- Uses Vercel AI SDK v4 (`ai`, `@ai-sdk/groq`, `@ai-sdk/google`, `@ai-sdk/openai-compatible`)
- Type compatibility workarounds applied for AI SDK v4 (marked with `// rationale:` comments)
- Watsonx adapter is a stub that throws "not configured" — real implementation deferred to Wave 2

### 4. Smoke Test Tool (`llm_test`)

**Purpose:**
- Temporary MCP tool to verify LLM routing is wired correctly
- Takes a `{ prompt: string }` and returns LLM response + metadata
- Will be removed in Wave 2 when Cartographer ships

**Location:** [`packages/mcp-server/src/tools/llm-test.ts`](packages/mcp-server/src/tools/llm-test.ts)

## Build Status

```bash
✅ pnpm install   # All dependencies resolved
✅ pnpm build     # All 4 packages build successfully
✅ pnpm type-check # TypeScript strict mode passes
```

**Turbo Cache:**
- `@renatus/shared` — cached (no changes since last build)
- `@renatus/db` — built successfully
- `@renatus/llm` — built successfully
- `@renatus/mcp-server` — built successfully

## What Changed (File-Level)

### New Files
- `packages/db/src/repositories/mcp-session-repository.ts`
- `packages/db/src/repositories/tool-invocation-repository.ts`
- `packages/mcp-server/src/audit.ts`
- `packages/mcp-server/src/tools/llm-test.ts`
- `packages/llm/package.json`
- `packages/llm/tsconfig.json`
- `packages/llm/src/index.ts`
- `packages/llm/src/llm-router.ts`
- `packages/llm/src/adapters/mcp-elicitation-adapter.ts`
- `packages/llm/src/adapters/vercel-ai-gateway-adapter.ts`
- `packages/llm/src/adapters/groq-adapter.ts`
- `packages/llm/src/adapters/gemini-adapter.ts`
- `packages/llm/src/adapters/watsonx-granite-adapter.ts`

### Modified Files
- `packages/db/src/index.ts` — exports new repositories
- `packages/db/package.json` — no changes (already had required deps)
- `packages/mcp-server/package.json` — added `@renatus/db` and `@renatus/llm` dependencies
- `packages/mcp-server/src/index.ts` — integrated audit system, registered `llm_test` tool
- `pnpm-lock.yaml` — updated with new AI SDK dependencies

## Environment Variables

**Required for full functionality:**
```bash
DATABASE_URL="postgresql://..."  # Neon Postgres (audit trail)
```

**Optional (LLM routing):**
```bash
GROQ_API_KEY="..."                    # Default provider
GEMINI_API_KEY="..."                  # Large-context fallback
WATSONX_API_KEY="..."                 # Sponsor signal (stub)
WATSONX_PROJECT_ID="..."              # Required if WATSONX_API_KEY set
VERCEL_AI_GATEWAY_URL="..."           # Multi-provider gateway
VERCEL_AI_GATEWAY_API_KEY="..."       # Gateway auth
BOB_TASK_ID="..."                     # Optional: stable session ID
```

## Known Limitations (Deferred to Wave 2)

1. **MCP Elicitation Adapter** — stub only; real MCP sampling not yet implemented
2. **Watsonx Granite Adapter** — stub that throws error; IBM SDK integration pending
3. **Streaming** — all adapters return full responses; streaming not implemented
4. **Tool Calling** — LLM adapters don't yet support function/tool calling
5. **llm_test tool** — throwaway smoke test; will be removed when Cartographer ships

## Next Steps (Wave 2)

1. Implement the 4 agents (Cartographer, Surgeon, Examiner, Auditor) in `packages/agents/`
2. Build the orchestrator FSM as an Inngest workflow in `packages/agents/_orchestrator/`
3. Remove `llm_test` tool once Cartographer ships
4. Build the codebase graph in Postgres using `nodes` + `edges` tables traversed via recursive CTEs (no Neo4j — v3 dropped it for one-DB simplicity)
5. Use Inngest for durable agent work distribution (v3 replaced BullMQ to remove the Redis dependency)
6. Ship `apps/web/` Next.js 16 stub on Vercel with `/replay-test` route exercising WebContainers

## Verification Commands

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm build

# Type-check all packages
pnpm type-check

# Run MCP server (requires DATABASE_URL)
cd packages/mcp-server
pnpm dev
```

## Notes for Hackathon Judges

- All code follows strict TypeScript (no `any` without rationale comments)
- Audit trail is append-only (never UPDATE, only INSERT)
- `bob_sessions/` folder preserved for session exports
- `.bobignore` enforced to protect secrets
- Git pre-push hook runs `scripts/secret-scan.sh`

---

**Wave 1 Complete.** Ready for Wave 2 agent implementation.