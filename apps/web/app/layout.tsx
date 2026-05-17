import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'Renatus — four agents, one engine, signed audit',
  description:
    'Audit-grade infrastructure for LLM-driven code changes. Migrate, refactor, security-audit, and ask Q&A across any codebase. Every run produces an ed25519-signed audit report.',
};

/**
 * Renatus root layout. RSC. Sticky brand header + content slot. Global CSS
 * lives in `app/globals.css` and ships once via this import. Body theming
 * (dark background, antialiasing) is set in the stylesheet, not inline.
 */
export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        {/* Inter via the Google Fonts CDN — keeps the headers crisp without
            shipping a font file. The CSS stack falls back to system-ui if
            the network blocks the request. */}
        <link
          rel="preconnect"
          href="https://fonts.googleapis.com"
        />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
        />
      </head>
      <body suppressHydrationWarning>
        <header className="site-header">
          <div className="site-header__inner">
            <a className="site-header__brand" href="/">
              Renatus
            </a>
            <nav className="site-header__nav">
              <a href="/run">Run</a>
              <a href="/jobs">Jobs</a>
              <a href="/verify">Verify</a>
              {/* TODO(release): replace with the real Renatus repo URL once
                  the project is open-sourced. Placeholder for now. */}
              <a
                href="https://github.com/thisisaman408/renatus"
                target="_blank"
                rel="noopener noreferrer"
              >
                GitHub
              </a>
            </nav>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
