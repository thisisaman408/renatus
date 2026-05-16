import type { ReactNode } from 'react';

export const metadata = {
  title: 'Renatus — audit-grade infrastructure for LLM code migrations',
  description:
    'Renatus is the production wrapper around LLM-driven code migrations: sandboxed trial runs, signed audit trails, and replayable diffs.',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif',
          background: '#0a0a0a',
          color: '#f5f5f5',
          minHeight: '100vh',
        }}
      >
        {children}
      </body>
    </html>
  );
}
