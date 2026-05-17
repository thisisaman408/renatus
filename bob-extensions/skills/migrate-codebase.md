# Renatus Code Changes Skill

This skill helps Bob orchestrate code changes using Renatus's four agents:
**Migrate**, **Refactor**, **Security Audit**, **Codebase Q&A**. All four share
one engine — they differ only in the rule source the Cartographer reads.

## When to invoke this skill

- User mentions a version upgrade ("React 19", "Tailwind 4", "Node 22").
- User describes a code transformation ("rename X to Y", "extract validation
  into lib/").
- User pastes a CVE id or security advisory and wants the code mitigated.
- User asks a question about the codebase without requesting changes.

## Agent picker

| User intent | Agent | Tier-1 tool |
|---|---|---|
| Version migration | Migrate | `migrate_repository` |
| Natural-language refactor | Refactor | `refactor_repository` |
| CVE / OWASP / vulnerability mitigation | Security Audit | `security_audit_repository` |
| Read-only code intelligence | Codebase Q&A | `query_codebase` (Wave 4) |

All four agents go through the same engine: clone → index → cartograph →
retrieve → patch (Surgeon) → examine (regression tests) → audit (ed25519
signed). Q&A skips Surgeon + Auditor; instead it retrieves, answers, and
signs the transcript.

## Engine components (shared across all agents)

- **Cartographer** — synthesizes `Rule[]` from the rule source. Path A uses
  bundled packs (React 18→19, Tailwind 3→4). Path B uses the LLM with sha256
  cache + Zod retry (max 2).
- **Indexer** — ts-morph walks the snapshot, persists files + imports + symbols.
- **RetrievalService** — runs rule detectors, expands via recursive-CTE on the
  imports edge table, union-find clusters into coherent batches.
- **Surgeon** — per-batch LLM call with `responseFormat: 'file-replacement'`;
  ts-morph syntactic validation (TS parser error codes 1000-1999); retry-with-
  feedback (max 2); confidence scoring (0.85 / 0.7 / 0.5 / 0.3).
- **Examiner** — per-patch LLM call; framework auto-detected from
  `package.json` (vitest > jest > mocha > playwright); strategy chosen by
  agentKind (snapshot for migrate/refactor; cve-replay for security_audit).
- **Auditor** — reads `audit_events`; signs with ed25519 over
  `canonicalJson(report)`; persists keypair (KEK-encrypted when
  `RENATUS_KEK` is set).

## Playbook (apply in order, every agent)

1. **Confirm intent before firing.** Echo the version / refactor / CVE /
   question back to the user in plain language and wait for explicit
   confirmation.
2. **Prefer the Tier-1 tool.** `migrate_repository` / `refactor_repository` /
   `security_audit_repository` / `query_codebase` do the full pipeline in one
   call. Reach for atomic tools (`plan_change`, `find_affected_files`,
   `propose_patch`, `apply_patch`, `examine`, `audit_repository`) only when
   the user explicitly wants step-by-step inspection.
3. **Show diffs before applying.** Never call `apply_patch` without surfacing
   the diff to the user.
4. **Let the audit chain do its job.** Every agent emits audit events at phase
   boundaries; the Auditor signs them. Never bypass.
5. **Failures are loud, not silent.** LLM validation retries max 2 with
   feedback; on exhaustion, Cartographer/Surgeon throw with the last raw
   output attached. Surface these to the user verbatim.

## Tool inventory (all currently registered)

**Tier-1 orchestrators** (one per agent):
- `migrate_repository`, `refactor_repository`, `security_audit_repository`,
  `query_codebase` (Wave 4)

**Per-phase**:
- `plan_change` — Cartographer Path A or Path B

**Atomic** (lower-level access):
- `clone_repository`, `index_repository`, `find_affected_files`,
  `propose_patch`, `apply_patch`, `examine`, `audit_repository`

**Smoke / diagnostics**:
- `ping`, `llm_test`, `cartograph_repository` (legacy alias for `plan_change`
  Path A)
