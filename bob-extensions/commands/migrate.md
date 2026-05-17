# /migrate

Renatus end-to-end migration. Wires the user's repo through the full pipeline:
clone → index → cartograph → retrieve → patch.

## Behaviour

When the user invokes `/migrate <ecosystem>@<from>-><to>` (or a shorthand
like `/migrate react-19`):

1. Switch Bob to the **Migration** mode.
2. Call MCP tool `migrate_repository` with:
   - `repoUrl`: workspace GitHub URL, or `file://<absolute workspace path>` for local fixtures.
   - `ecosystem`: derived from the shorthand or asked explicitly.
   - `fromVersion`, `toVersion`: derived from shorthand.
   - `agentKind`: `'migrate'` (the default).
   - `ruleSource`: `{ kind: 'pack' }` when a bundled pack ships for
     `(ecosystem, from, to)`; otherwise prompt for `kind: 'guide-url'` +
     `sourceText` (the upgrade guide URL or pasted markdown).
3. The tool returns `{ jobId, eventId, sseUrl, status: 'queued' }` and the
   Inngest workflow runs asynchronously.
4. Stream progress via `sseUrl` (Wave 4 wires the actual SSE route).
5. On completion, link the user to the audit page for `jobId`.

## Shorthands

- `/migrate react-19` → `{ ecosystem: 'npm', fromVersion: '18.x', toVersion: '19.x', ruleSource: { kind: 'pack' } }`
- `/migrate react-19 from <url>` → `{ ecosystem: 'npm', fromVersion: '18.x', toVersion: '19.x', ruleSource: { kind: 'guide-url', sourceText: '<url-or-fetched-markdown>' } }`
- `/migrate tailwind-4` → `{ ecosystem: 'npm', fromVersion: '3.x', toVersion: '4.x', ruleSource: { kind: 'pack' } }` (falls back to guide-url if no pack ships)
- `/migrate python-3.12` → `{ ecosystem: 'pypi', fromVersion: '3.11', toVersion: '3.12', ruleSource: { kind: 'pack' } }`

## Failure modes

- No `DATABASE_URL` → tool throws before queuing; surface verbatim.
- No bundled pack and no `ruleSource` override → tool succeeds but Cartographer
  step fails on `planFromPack` with a "use planFromSource" hint. Re-invoke
  with a `guide-url` ruleSource.
