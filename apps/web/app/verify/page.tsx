import VerifyForm from './verify-form';

/**
 * `/verify` — standalone signature verifier.
 *
 * Paste a report JSON, the signature JSON (or public key + signature hex +
 * message hash hex), and click verify. Everything runs in the browser: no
 * server round-trip, no DB read. Useful for sharing a report out-of-band
 * (e.g. emailed to a security team) and verifying without trusting Renatus.
 */
export default function VerifyPage() {
  return (
    <main className="container" style={{ padding: '3rem 1.5rem 6rem' }}>
      <p className="muted" style={{ marginBottom: '0.5rem', fontSize: '0.9375rem' }}>
        Renatus · standalone verifier
      </p>
      <h1 style={{ marginBottom: '0.25rem' }}>Verify a signature</h1>
      <p className="muted" style={{ maxWidth: 640 }}>
        Paste a canonical audit report JSON and its signature object. The
        verifier runs entirely in your browser — re-canonicalizes the report,
        re-computes SHA-256, and runs ed25519.verify via{' '}
        <code>@noble/curves</code>. Renatus servers are not consulted.
      </p>

      {/* Why-this-matters callout. The verify page was previously a wall of
       * JSON inputs with no context — a demo viewer would shrug. This panel
       * explains the *point* of the page before they hit the textareas. */}
      <section
        className="card"
        style={{
          marginTop: '1.5rem',
          marginBottom: '2rem',
          borderColor: 'var(--brand)',
          maxWidth: 760,
        }}
      >
        <p style={{ margin: 0 }}>
          <strong>Cryptographic provenance for AI-generated code.</strong>{' '}
          Every Renatus patch is signed with an ed25519 key bound to the job.
          Anyone — an auditor, a compliance reviewer, or you in 6 months —
          can paste a signed report here and confirm it hasn&apos;t been
          tampered with. <strong>No Renatus account, no server call.</strong>{' '}
          All verification runs in your browser via{' '}
          <code>@noble/curves</code> over canonical JSON. The same
          verification logic ships in our MCP server and the CLI.
        </p>
      </section>

      <VerifyForm />
    </main>
  );
}
