export default function ReplayTestPage() {
  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '6rem 1.5rem' }}>
      <h1 style={{ fontSize: '2rem', margin: 0 }}>Replay smoke test</h1>
      <p style={{ marginTop: '1rem', color: '#a3a3a3', lineHeight: 1.6 }}>
        This route is reserved for the WebContainers in-browser audit replay. Wave 3 wires
        <code style={{ background: '#171717', padding: '0.1rem 0.4rem', borderRadius: 4, margin: '0 0.25rem' }}>
          @webcontainer/api
        </code>
        into this page so judges can re-run the migration locally without our backend.
      </p>
      <p style={{ marginTop: '1rem', color: '#737373' }}>
        Cross-origin isolation headers are already set on this route (see{' '}
        <code>next.config.ts</code>) — WebContainers will boot here.
      </p>
    </main>
  );
}
