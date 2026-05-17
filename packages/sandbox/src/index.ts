export * from './sandbox-adapter.js';
export { VercelSandboxAdapter } from './adapters/vercel-sandbox-adapter.js';
export { WebContainersAdapter } from './adapters/webcontainers-adapter.js';

import { VercelSandboxAdapter } from './adapters/vercel-sandbox-adapter.js';
import { WebContainersAdapter } from './adapters/webcontainers-adapter.js';
import type { SandboxAdapter } from './sandbox-adapter.js';

/**
 * Get a sandbox adapter by name.
 *
 * Wave 4 deliverable: the Auditor will use this to replay migrated code
 * in a hermetic sandbox (Vercel Sandbox server-side; WebContainers in
 * the browser-replay UI). The Wave 3 Auditor signs the audit_events log
 * directly and does NOT consume this factory — it is kept here for
 * Wave 4 wiring and the existing sandbox-adapter contract tests.
 */
export function getSandboxAdapter(adapter: 'vercel' | 'webcontainers'): SandboxAdapter {
  switch (adapter) {
    case 'vercel':
      return new VercelSandboxAdapter();
    case 'webcontainers':
      return new WebContainersAdapter();
    default:
      throw new Error(`Unknown sandbox adapter: ${adapter}`);
  }
}

// Made with Bob
