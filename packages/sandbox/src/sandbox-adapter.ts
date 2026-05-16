import { z } from 'zod';

/**
 * SandboxAdapter — single interface over backend sandbox runtimes.
 *
 * Implementations live in packages/sandbox/src/adapters:
 *   - VercelSandboxAdapter   → Vercel Sandbox (default, server-side test runs)
 *   - WebContainersAdapter   → StackBlitz WebContainers (in-browser replay)
 *
 * The Auditor uses VercelSandboxAdapter to actually run migrated code and
 * tests. The audit replay UI uses WebContainersAdapter so judges can re-run
 * the same migration in their browser without a backend round-trip.
 */

export const SandboxFileSchema = z.object({
  path: z.string(),
  contents: z.string(),
});

export const SandboxRunRequestSchema = z.object({
  files: z.array(SandboxFileSchema),
  command: z.string(),
  timeoutMs: z.number().int().positive().optional(),
  env: z.record(z.string(), z.string()).optional(),
});

export type SandboxRunRequest = z.infer<typeof SandboxRunRequestSchema>;

export const SandboxRunResultSchema = z.object({
  exitCode: z.number().int(),
  stdout: z.string(),
  stderr: z.string(),
  durationMs: z.number().int().nonnegative(),
});

export type SandboxRunResult = z.infer<typeof SandboxRunResultSchema>;

export interface SandboxAdapter {
  run(req: SandboxRunRequest): Promise<SandboxRunResult>;
}
