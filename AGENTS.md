# Renatus — project context for IBM Bob

This file gives Bob persistent project context across conversations and modes. Run `/init` from Bob IDE to refresh or extend it as the project evolves.

## What we are building

Renatus is a **multi-agent code migration crew** orchestrated by IBM Bob. Given a repository and a target version (React 18 → 19, Python 3.10 → 3.12, Tailwind 3 → 4, Drizzle 0.x → 1.0, etc.), Renatus migrates the codebase end-to-end with regression tests and a signed audit trail.

The product is unique among IBM Bob Hackathon submissions because it exploits Bob's single biggest superpower — **whole-repo context reading** — to solve a problem (cross-version migration) that other LLMs cannot solve well, because they only see diff hunks.

## The 4 agents

| Agent | Folder | Role |
|---|---|---|
| Cartographer | `agents/cartographer/` | Reads upstream changelog + breaking-change docs; builds the breaking-change map |
| Surgeon | `agents/surgeon/` | Reads YOUR full repo via Bob; identifies affected files; generates migration patches |
| Examiner | `agents/examiner/` | Generates regression tests for every migrated file (before/after fixtures) |
| Auditor | `agents/auditor/` | Runs migrated code against tests; produces signed audit report including Bob's session log |

The orchestrator lives in `agents/_orchestrator/` and is a Bob session itself.

## Tech stack

- Next.js 16 App Router (TypeScript, strict mode)
- Tailwind CSS v4 + shadcn/ui
- Drizzle ORM + Neon Postgres (job + audit state)
- Neo4j AuraDB (codebase knowledge graph)
- BullMQ on Upstash Redis (agent work queue)
- React Three Fiber + `react-force-graph` (3D KG visualization)
- Octokit for GitHub repo cloning
- Deployed on Vercel
- IBM Bob IDE = orchestrator + runtime intelligence

## Code conventions

- TypeScript strict. Never `any` without a `// rationale:` comment.
- File paths are kebab-case (`agents/cartographer/index.ts`).
- All Drizzle schemas live in `db/schema/*.ts`, one file per table.
- Agent inputs/outputs are typed with Zod.
- Server-only modules import `"server-only"` at the top.
- No secrets in code. `.bobignore` is the source of truth on what Bob must never see.

## Repo invariants (do not break)

1. The folder `bob_sessions/` at the repo root is **mandatory for hackathon judging**. Never delete it. Add new exported session reports there, never anywhere else.
2. `SYSTEM-DESIGN.md` is the spec. If implementation diverges, update the doc in the same commit.
3. Every agent run writes an `audit_event` row. Audit append-only, never UPDATE.

## Demo target repos (pre-picked)

See `SYSTEM-DESIGN.md` §17. Primary live-demo target: a real OSS React 18 codebase to be migrated to React 19 on stage in 90 seconds.

## What Bob should NOT do in this project

- Do not edit anything in `bob_sessions/` (read-only audit folder)
- Do not modify `.bobignore` without a documented reason
- Do not commit on Bob's behalf without showing the diff first
- Do not call out to external LLMs other than where the architecture explicitly says so
