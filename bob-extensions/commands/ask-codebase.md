# /ask-codebase

Slash command: Renatus Codebase Q&A. Wires the user's repo through the
read-only pipeline: clone → index → ask. Returns an answer with line-anchored
citations and a signed transcript.

## Behaviour

When the user invokes `/ask-codebase "<question>"`:

1. Switch Bob to the **Ask Codebase** mode.
2. Confirm the question in plain language ("I'll search the codebase for: 'where is the auth middleware composed?' Proceed?") and wait for explicit user confirmation.
3. On confirmation, call MCP tool `query_codebase` with EITHER a fresh source
   (clone + index) OR a cached source (reuse a prior job's snapshot):
   - **Fresh:** `repoUrl` (workspace's GitHub URL or `file://<absolute workspace path>`)
     plus optional `ref` (branch/tag/SHA, defaults to 'main').
   - **Cached:** `snapshotId` (UUID from a prior completed job's audit page).
     Skips clone + index entirely — faster and cheaper. Use this whenever the
     user just ran another Renatus agent (migrate / refactor / security_audit)
     on the same repo: the snapshot is already cloned + indexed, so Q&A can
     answer immediately without re-cloning. The tool's schema enforces
     exactly one of (`repoUrl`, `snapshotId`).
   - `question`: the user's quoted question (verbatim).
4. The tool returns `{ jobId, eventId, sseUrl, status: 'queued' }` and the Inngest workflow runs asynchronously.
5. Stream progress via the returned `sseUrl` (Wave 4 wires the actual SSE route).
6. On completion, surface the answer with citations rendered as `filePath:line` followed by the verbatim snippet, plus the transcript signature for verification.

## Example invocations

- `/ask-codebase "where is the auth middleware composed?"` (fresh clone of workspace)
- `/ask-codebase "how does the retry-with-feedback loop work in the Surgeon?"`
- `/ask-codebase "which files import canonicalJson?"`
- `/ask-codebase "what did the migration change?" snapshotId=<uuid>` — after
  running `/migrate`, pass the resulting snapshotId to Q&A so the agent
  skips clone + index and answers in seconds.

## Failure modes

- LLM emits malformed JSON or fails Zod validation → 2 retries with feedback, then fail with a clear error and the last LLM transcript.
- No candidate files match the question's keywords → the agent returns a "not enough context" answer with zero citations; rewrite the question or pass a path hint.
- Question is off-topic for code → the agent returns a polite scope-refusal answer; nothing was signed maliciously, the refusal itself is signed.
- No `DATABASE_URL` → tool throws before queuing; surface verbatim.
