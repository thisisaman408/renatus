import type {
  SandboxAdapter,
  SandboxRunRequest,
  SandboxRunResult,
} from '../sandbox-adapter.js';

/**
 * WebContainersAdapter — runs the audit replay in the user's browser.
 *
 * Stub for Wave 1. The real implementation uses @webcontainer/api and only
 * runs client-side (Node's fs/process imports are not available). Wave 3
 * wires this into apps/web/app/replay-test for the demo prop.
 */
export class WebContainersAdapter implements SandboxAdapter {
  async run(_req: SandboxRunRequest): Promise<SandboxRunResult> {
    throw new Error(
      'WebContainersAdapter must run client-side. Use it from apps/web only — Wave 3 deliverable.',
    );
  }
}
