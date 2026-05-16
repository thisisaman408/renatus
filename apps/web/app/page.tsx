export default function HomePage() {
  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '6rem 1.5rem' }}>
      <h1 style={{ fontSize: '3rem', margin: 0, letterSpacing: '-0.02em' }}>Renatus</h1>
      <p style={{ fontSize: '1.25rem', color: '#a3a3a3', marginTop: '0.5rem' }}>
        Audit-grade infrastructure for LLM-driven code migrations.
      </p>
      <p style={{ marginTop: '2rem', color: '#d4d4d4', lineHeight: 1.6 }}>
        Sandbox every change. Sign the audit chain. Replay the diff in a browser without
        the backend. Built solo for the IBM Bob Hackathon (May 15–17, 2026).
      </p>
      <p style={{ marginTop: '2rem' }}>
        <a
          href="/replay-test"
          style={{ color: '#60a5fa', textDecoration: 'underline' }}
        >
          → WebContainers replay smoke test
        </a>
      </p>
      <p style={{ marginTop: '4rem', color: '#525252', fontSize: '0.875rem' }}>
        Wave 1 status: MCP server live, audit chain wired, LLM router routed.
        Wave 2 (agents) in flight.
      </p>
    </main>
  );
}
