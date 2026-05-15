# Renatus

> Multi-agent code migration crew, orchestrated by IBM Bob. Drop in a repository, pick a target version (React 18 → 19, Python 3.10 → 3.12, Tailwind 3 → 4, Drizzle 0.x → 1.0). Renatus's four specialist agents read the upstream breaking-change catalog, your full repo, generate the migration patches, write regression tests, and produce a signed audit report — all in minutes, not weeks.

Built for the **IBM Bob Hackathon — Build on Bob (BoB)**, May 15–17, 2026.

## Why Bob is the unlock

Cross-version migrations require **whole-codebase understanding**, not just diff hunks. A `useEffect` cleanup change in React 18 → 19 can cascade through hundreds of files. Bob's repository-context reading is the only LLM partner capable of reasoning across the entire system at once. Renatus is built around that capability — it cannot exist without Bob.

Every agent in Renatus opens a Bob task. Every task is exported to [`bob_sessions/`](./bob_sessions) for judging.

## The four agents

| Agent | Role | Bob's contribution |
|---|---|---|
| **Cartographer** | Reads upstream changelog + breaking-change docs, builds a structured map of every API surface that changed | Bob structures the docs into a knowledge graph |
| **Surgeon** | Reads YOUR full repo via Bob's repo context, identifies every file touched by a breaking change, generates migration patches | Bob's full-repo reading is the engine |
| **Examiner** | Generates regression tests for every migrated file, capturing before-and-after behavior | Bob reads test patterns from the existing suite |
| **Auditor** | Runs migrated code against tests, reports deviations, exports a signed audit report including Bob's session log | Bob's session log itself is the audit evidence |

## Status

In active development. The full system design is in [`SYSTEM-DESIGN.md`](./SYSTEM-DESIGN.md) (2,400 lines: architecture, Drizzle schemas, Neo4j codebase graph, agent prompts, the hour-by-hour 48-hour SOP, demo script, and 3 primary + 2 backup target GitHub repos pre-picked).

## Tech stack

- Next.js 16 App Router (TypeScript strict)
- Tailwind CSS v4 + shadcn/ui
- Drizzle ORM + Neon Postgres
- Neo4j AuraDB (codebase knowledge graph)
- BullMQ on Upstash Redis (parallel agent queue)
- React Three Fiber + `react-force-graph` (3D KG)
- Deployed on Vercel
- **IBM Bob IDE** as the orchestrator and runtime intelligence

## Run it yourself

(populated as the project lands)

## License

MIT — see [LICENSE](./LICENSE).
