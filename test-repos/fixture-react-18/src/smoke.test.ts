import { describe, it, expect } from 'vitest';

/**
 * Renatus replay smoke test.
 *
 * Lives in the fixture so WebContainers has something to actually run when
 * the user opens /replay/[jobId]. The Examiner agent also writes per-patch
 * snapshot tests into this directory; both flavors execute under the same
 * `pnpm test` command.
 */
describe('renatus replay smoke', () => {
  it('runs', () => {
    expect(1 + 1).toBe(2);
  });

  it('sees the patched react import surface', async () => {
    // After Renatus's migrate run, react-dom should be importable.
    // (This test is content-agnostic — it just proves WebContainers booted
    // a real Node runtime and resolved the modules.)
    const reactDom = await import('react-dom/client').catch(() => null);
    expect(reactDom).not.toBeNull();
  });
});
