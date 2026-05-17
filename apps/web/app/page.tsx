/**
 * Renatus landing page.
 *
 * Pure RSC. The pitch leads with "Four agents, one engine, signed audit." —
 * the three claims that anchor the demo arc:
 *   1. Migrate / Refactor / Security audit / Q&A all run on the same
 *      cartographer → surgeon → examiner → auditor pipeline.
 *   2. Every job emits an append-only audit_events log.
 *   3. The Auditor signs the report with an ed25519 key it generates per job,
 *      and the public key is returned in /audit/[jobId] so anyone can verify.
 */

const MCP_SNIPPET = `{
  "mcpServers": {
    "renatus": {
      "command": "npx",
      "args": ["-y", "@renatus/mcp-server"],
      "env": {}
    }
  }
}`;

interface AgentCard {
  href: string;
  title: string;
  blurb: string;
  badge: string;
}

const AGENTS: AgentCard[] = [
  {
    href: '/migrate',
    title: 'Migrate',
    blurb:
      'Cross-version code migration. Bundled rule packs, or feed in a changelog / diff / upgrade guide.',
    badge: 'tier-1',
  },
  {
    href: '/refactor',
    title: 'Refactor',
    blurb:
      'Codebase-wide refactor from a natural-language intent. No rules needed.',
    badge: 'tier-1',
  },
  {
    href: '/security',
    title: 'Security Audit',
    blurb:
      'CVE-driven patching. Provide a CVE id (fetched from NVD) or paste an advisory.',
    badge: 'tier-1',
  },
  {
    href: '/qa',
    title: 'Q&A',
    blurb:
      'Read-only natural-language Q&A across the codebase. Cited, signed transcripts.',
    badge: 'read-only',
  },
];

export default function HomePage() {
  return (
    <main className="container" style={{ padding: '4rem 1.5rem 6rem' }}>
      <section style={{ maxWidth: 760 }}>
        <p className="muted" style={{ marginBottom: '0.5rem', fontSize: '0.9375rem' }}>
          Renatus · audit-grade LLM code changes
        </p>
        <h1 style={{ fontSize: '3rem', lineHeight: 1.05 }}>
          Four agents, one engine, signed audit.
        </h1>
        <p className="muted" style={{ fontSize: '1.125rem', maxWidth: 640 }}>
          Renatus runs migrations, refactors, security audits, and codebase Q&A on
          the same cartographer → surgeon → examiner → auditor pipeline. Every
          run emits an append-only event log. The Auditor signs the report
          with an ed25519 key — anyone with the public key (returned with the
          report) can verify the bytes weren&apos;t tampered.
        </p>
      </section>

      <section style={{ marginTop: '3rem' }}>
        <h2 style={{ marginBottom: '1rem' }}>Run an agent</h2>
        <div className="grid-2">
          {AGENTS.map((agent) => (
            <a
              key={agent.href}
              className="card"
              href={agent.href}
              aria-label={`Open ${agent.title} form`}
              style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
            >
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'baseline',
                  marginBottom: '0.5rem',
                }}
              >
                <h3 style={{ margin: 0 }}>{agent.title}</h3>
                <span className="badge badge-brand">{agent.badge}</span>
              </div>
              <p className="muted" style={{ margin: 0, fontSize: '0.9375rem' }}>
                {agent.blurb}
              </p>
              <p
                style={{
                  margin: '0.75rem 0 0',
                  fontSize: '0.875rem',
                  color: 'var(--brand)',
                }}
              >
                Open form →
              </p>
            </a>
          ))}
        </div>
      </section>

      <section style={{ marginTop: '4rem' }}>
        <h2>Install as an MCP server</h2>
        <p className="muted" style={{ maxWidth: 640 }}>
          Renatus is also a Model Context Protocol server — drop the snippet
          below into your Bob, Claude Code, or Cursor MCP config and the four
          tier-1 tools (<code>migrate_repository</code>,{' '}
          <code>refactor_repository</code>, <code>security_audit_repository</code>,{' '}
          <code>query_codebase</code>) show up alongside your other tools.
        </p>
        <pre><code>{MCP_SNIPPET}</code></pre>
      </section>

      <section style={{ marginTop: '4rem' }}>
        <h2>Public key &amp; signature</h2>
        <p className="muted" style={{ maxWidth: 720 }}>
          Renatus generates a fresh ed25519 keypair per job. The private key
          stays on the server (encrypted with <code>RENATUS_KEK</code> when
          configured); the public key is embedded in the signed report and
          surfaced at <code>/audit/[jobId]</code>. Verify locally with{' '}
          <a href="/verify">/verify</a> or click <em>Verify signature</em> on
          any audit page — the widget re-canonicalizes the report, recomputes
          the SHA-256 hash, and runs ed25519 in the browser.
        </p>
      </section>

      <p className="mute" style={{ marginTop: '4rem', fontSize: '0.8125rem' }}>
        Built solo for the IBM Bob Hackathon (May 15–17, 2026). Submission deadline 17 May 2026.
        {' '}See <code>STATE-OF-RENATUS.md</code> in the repo for the full deliverable
        inventory, or <a href="/run">run an agent</a> now.
      </p>
    </main>
  );
}
