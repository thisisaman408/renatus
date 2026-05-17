# Renatus

> **Audit-grade infrastructure for LLM-driven code changes.** Four agents, one engine, signed audit chain.

Renatus wraps any LLM that touches code: indexes the repo, runs the LLM with structured context, executes the result in a sandbox, and ships a cryptographically signed audit report. Four agents share one engine: **Migrate**, **Refactor**, **Security Audit**, **Codebase Q&A**.

## Two entry surfaces

- **MCP server** — Bob IDE, Claude Code, Cursor, Windsurf drive it. The host LLM does the reasoning.
- **Standalone web app** — visitors run any agent end-to-end with no LLM key required. Renatus uses its own providers (Groq, Gemini, watsonx).

## Quick start (web app)

```bash
git clone <repo>
cd renatus
pnpm install
cp .env.example .env.local          # add DATABASE_URL + GROQ_API_KEY
cd packages/db && pnpm db:migrate   # applies 0000-0006
cd ../..
pnpm dev                            # http://localhost:3000
```

## Quick start (MCP)

```bash
pnpm install
pnpm --filter @renatus/mcp-server build
```

Then add the snippet from [`bob-extensions/mcp-config.example.json`](./bob-extensions/mcp-config.example.json) to your Bob / Claude Code / Cursor MCP config. The four Tier-1 tools — `migrate_repository`, `refactor_repository`, `security_audit_repository`, `query_codebase` — appear alongside your other tools.

## The four agents

| Agent | Slash command | What it does |
|---|---|---|
| Migrate | `/migrate <ecosystem>@<from>-><to>` | Apply breaking-change rules from bundled packs or arbitrary changelog text |
| Refactor | `/refactor "<intent>"` | Natural-language refactor with regression tests |
| Security Audit | `/security-audit <CVE-id>` or `"<advisory>"` | CVE mitigation patches + exploit-replay tests |
| Q&A | `/ask-codebase "<question>"` | Cited answer with signed transcript |

## What makes it production-grade

- **Cryptographically signed audit** — ed25519 over canonical JSON; per-job keypair persisted in `signing_keys` (KEK-encrypted when `RENATUS_KEK` is set).
- **Knowledge graph drives retrieval** — recursive CTE over the `imports` edge table fans out coherent file batches for the LLM.
- **In-browser test replay** — WebContainers boots Node in the visitor's browser and runs the migrated test suite. No backend round-trip.
- **Multi-provider LLM routing** — Groq / Gemini / watsonx / Vercel AI Gateway with a single `LlmRouter` interface.
- **Audit chain is load-bearing** — every agent action emits an `audit_events` row; the Auditor reads them, signs the report, returns a verifiable signature.

## Architecture

See [`SYSTEM-DESIGN.md`](./SYSTEM-DESIGN.md) for the v4 spec. [`IMPLEMENTATION-ROADMAP.md`](./IMPLEMENTATION-ROADMAP.md) is the 48-hour build plan. [`STATE-OF-RENATUS.md`](./STATE-OF-RENATUS.md) is the authoritative current-state snapshot. Wave progress notes: [`WAVE-1-CLOSURE-NOTES.md`](./WAVE-1-CLOSURE-NOTES.md), [`WAVE-2-PROGRESS-NOTES.md`](./WAVE-2-PROGRESS-NOTES.md), [`WAVE-3-PROGRESS-NOTES.md`](./WAVE-3-PROGRESS-NOTES.md), [`WAVE-4-PROGRESS-NOTES.md`](./WAVE-4-PROGRESS-NOTES.md).

## Verification

```bash
pnpm install
pnpm -r type-check
pnpm -r build
pnpm verify:wave-2              # 59/59 — Wave 2 regression gate
pnpm verify:wave-3              # 146/146 — chains wave-2 + Wave 3 + Wave 4 structural checks
pnpm verify:wave-3:e2e          # full pipeline — needs DATABASE_URL + GROQ_API_KEY
```

## Status

48-hour hackathon build. See `WAVE-{1,2,3,4}-PROGRESS-NOTES.md` for completion records. Built for the **IBM Bob Hackathon — Build on Bob (BoB)**, May 15–17, 2026.

## License

MIT — see [LICENSE](./LICENSE).
