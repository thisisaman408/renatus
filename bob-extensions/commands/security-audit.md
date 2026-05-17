# /security-audit

Slash command: Renatus end-to-end security audit. Wires the user's repo through the
full pipeline: clone → index → cartograph (planFromSource,
sourceKind='cve-advisory') → retrieve → patch.

## Behaviour

When the user invokes `/security-audit CVE-2024-XXXXX` or `/security-audit "<advisory text>"`:

1. Switch Bob to the **Security Audit** mode.
2. Confirm the CVE id or advisory summary in plain language ("I'll audit the codebase for CVE-2024-12345 (prototype pollution in lodash). Proceed?") and wait for explicit user confirmation.
3. On confirmation, call MCP tool `security_audit_repository` with:
   - `repoUrl`: workspace's GitHub URL OR `file://<absolute workspace path>` for local work.
   - `cveSource`: discriminated union — either `{ kind: 'cve-id', cveId: 'CVE-2024-XXXXX' }` (fetched from NVD) OR `{ kind: 'advisory-text', advisoryText: '<pasted text>' }`.
   - `ecosystem`: 'npm' default; ask if ambiguous.
4. The tool returns `{ jobId, eventId, sseUrl, status: 'queued' }` and the Inngest workflow runs asynchronously.
5. Stream progress via the returned `sseUrl` (Wave 4 wires the actual SSE route).
6. On completion, surface the audit URL for `jobId` and the test diff summary.

## Example invocations

- `/security-audit CVE-2024-12345`
- `/security-audit "lodash.merge before 4.17.21 is vulnerable to prototype pollution via attacker-controlled JSON"`
- `/security-audit CVE-2023-45857`

## Failure modes

- NVD fetch fails (network error, invalid CVE id) → tool throws `SecurityAuditAdvisoryFetchError` with a clear message. Inngest retries twice.
- LLM returns an unparseable mitigation set (Cartographer) → 2 retries with feedback, then fail with a clear error and the last LLM transcript.
- ts-morph parse fails on a proposed patch (Surgeon) → 2 retries, then mark file as unresolved.
- No vulnerable code patterns detected → Cartographer returns empty `rules: []`, workflow completes with zero patches (valid outcome).
- No `DATABASE_URL` → tool throws before queuing; surface verbatim.
