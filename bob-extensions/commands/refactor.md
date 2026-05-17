# /refactor

Slash command: Renatus end-to-end refactor. Wires the user's repo through the
full pipeline: clone → index → cartograph (planFromSource,
sourceKind='refactor-intent') → retrieve → patch.

## Behaviour

When the user invokes `/refactor "<intent>"`:

1. Switch Bob to the **Refactor** mode.
2. Confirm the intent in plain language ("I'll rename getUser → loadUser across the codebase. Proceed?") and wait for explicit user confirmation.
3. On confirmation, call MCP tool `refactor_repository` with:
   - `repoUrl`: workspace's GitHub URL OR `file://<absolute workspace path>` for local work.
   - `intent`: the user's quoted intent string (verbatim).
   - `ecosystem`: 'npm' default; ask if ambiguous.
4. The tool returns `{ jobId, eventId, sseUrl, status: 'queued' }` and the Inngest workflow runs asynchronously.
5. Stream progress via the returned `sseUrl` (Wave 4 wires the actual SSE route).
6. On completion, surface the audit URL for `jobId` and the test diff summary.

## Example invocations

- `/refactor "rename getUser to loadUser everywhere"`
- `/refactor "extract validation logic from src/api/* into src/lib/validators/"`
- `/refactor "change signature of fetchUser to accept an options object"`

## Failure modes

- LLM returns an unparseable rule set (Cartographer) → 2 retries with feedback, then fail with a clear error and the last LLM transcript.
- ts-morph parse fails on a proposed patch (Surgeon) → 2 retries, then mark file as unresolved.
- Refactor scope is too broad → split into multiple `/refactor` invocations.
- No `DATABASE_URL` → tool throws before queuing; surface verbatim.
