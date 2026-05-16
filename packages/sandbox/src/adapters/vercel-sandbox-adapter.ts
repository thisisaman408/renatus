import type {
  SandboxAdapter,
  SandboxRunRequest,
  SandboxRunResult,
} from '../sandbox-adapter.js';

/**
 * VercelSandboxAdapter — runs migration trial-runs on Vercel Sandbox.
 *
 * Stub for Wave 1. Wave 3 implements: provision sandbox via @vercel/sandbox,
 * mount files, exec command, stream logs, tear down.
 */
export class VercelSandboxAdapter implements SandboxAdapter {
  async run(_req: SandboxRunRequest): Promise<SandboxRunResult> {
    throw new Error('VercelSandboxAdapter not yet implemented — Wave 3 deliverable.');
  }
}
