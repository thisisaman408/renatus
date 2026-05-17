'use client';

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from 'react';

/**
 * `replay-canvas.tsx` — client-only WebContainers test runner.
 *
 * Flow:
 *   1. GET /api/jobs/[jobId]/replay-tree
 *   2. `WebContainer.boot()` — requires SharedArrayBuffer (set in
 *      `next.config.ts` via the cross-origin isolation headers on /replay).
 *   3. `wc.mount(fixture)` — fixture files from the snapshot.
 *   4. For each patch: `wc.fs.writeFile(filePath, patch.after)`.
 *   5. `pnpm install` (fallback `npm install` if pnpm spawn fails).
 *   6. `pnpm test` (fallback `npm test`).
 *   7. Surface exit code / PASS/FAIL.
 *
 * The WebContainers SDK is `dynamic` imported (`{ ssr: false }` is implicit
 * because this is a client component, but the import is also gated behind
 * `useEffect` so SSR never reaches it). The library throws on boot if the
 * host page isn't cross-origin-isolated — we catch and surface a clear error.
 */

const TERMINAL_HEIGHT = 600;
const MAX_TERMINAL_LINES = 2000;

interface ReplayCanvasProps {
  jobId: string;
}

interface ReplayTreeBody {
  fixtureFiles: Record<string, string>;
  patches: Array<{ filePath: string; after: string }>;
  framework: 'vitest' | 'jest' | 'mocha' | 'playwright' | 'unknown';
  snapshotCommitSha: string;
  totalBytes: number;
}

type Step = 'idle' | 'mount' | 'install' | 'test' | 'done';

interface StepState {
  current: Step;
  exitCode: number | null;
  error: string | null;
}

export default function ReplayCanvas({ jobId }: ReplayCanvasProps) {
  const [stepState, setStepState] = useState<StepState>({
    current: 'idle',
    exitCode: null,
    error: null,
  });
  const [terminalLines, setTerminalLines] = useState<string[]>([]);
  const [running, setRunning] = useState(false);
  const terminalRef = useRef<HTMLDivElement>(null);
  // The WebContainer instance — used to tear down on unmount.
  // rationale: `@webcontainer/api`'s `WebContainer` is a runtime class with
  // a deep surface (fs, spawn, mount, teardown); typing it via the SDK
  // requires importing the type, which we do dynamically. The narrow
  // shape below is enough for our usage.
  const wcRef = useRef<{
    teardown: () => void;
  } | null>(null);

  const append = useCallback((chunk: string) => {
    if (!chunk) return;
    setTerminalLines((prev) => {
      const next = [...prev];
      const lines = chunk.split('\n');
      // Append to the last line if it had no terminator; otherwise push new.
      if (next.length > 0 && !next[next.length - 1]!.endsWith('\n')) {
        const lastIdx = next.length - 1;
        next[lastIdx] = next[lastIdx] + (lines[0] ?? '');
        lines.shift();
      }
      for (const l of lines) next.push(l);
      // Cap retained lines so a runaway install doesn't OOM the page.
      if (next.length > MAX_TERMINAL_LINES) {
        return next.slice(next.length - MAX_TERMINAL_LINES);
      }
      return next;
    });
  }, []);

  // Auto-scroll the terminal pane to the bottom on new output.
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.scrollTop = terminalRef.current.scrollHeight;
    }
  }, [terminalLines.length]);

  // Clean up on unmount.
  useEffect(() => {
    return () => {
      const wc = wcRef.current;
      if (wc) {
        try {
          wc.teardown();
        } catch {
          // Teardown errors during unmount are non-fatal.
        }
        wcRef.current = null;
      }
    };
  }, []);

  const startReplay = useCallback(async () => {
    if (running) return;
    setRunning(true);
    setTerminalLines([]);
    setStepState({ current: 'mount', exitCode: null, error: null });
    append('[renatus] booting WebContainer...\n');

    let tree: ReplayTreeBody;
    try {
      const res = await fetch(`/api/jobs/${jobId}/replay-tree`, {
        cache: 'no-store',
      });
      if (!res.ok) {
        const errText = await res.text();
        throw new Error(`replay-tree fetch ${res.status}: ${errText}`);
      }
      tree = (await res.json()) as ReplayTreeBody;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      setStepState({
        current: 'idle',
        exitCode: null,
        error: `Could not load replay tree: ${reason}`,
      });
      setRunning(false);
      return;
    }

    append(
      `[renatus] tree loaded: ${
        Object.keys(tree.fixtureFiles).length
      } files, ${tree.patches.length} patches, framework=${tree.framework}\n`,
    );

    // Dynamically import the SDK so the (browser-only) module isn't pulled
    // into any SSR or worker bundles.
    let WebContainerCtor;
    try {
      // rationale: the SDK's module shape is a named export with a static
      // `boot` factory; we narrow by destructuring.
      const mod = await import('@webcontainer/api');
      WebContainerCtor = mod.WebContainer;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      setStepState({
        current: 'idle',
        exitCode: null,
        error: `WebContainers SDK failed to load: ${reason}. WebContainers requires Chrome 109+ or Safari 16.4+, with cross-origin isolation. Watch the pre-recorded demo on the project site.`,
      });
      setRunning(false);
      return;
    }

    let wc;
    try {
      wc = await WebContainerCtor.boot();
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      const coiOk =
        typeof window !== 'undefined' &&
        // rationale: `crossOriginIsolated` is a window property added by the
        // HTML spec; TS lib.dom currently types it but older versions don't.
        (window as unknown as { crossOriginIsolated?: boolean })
          .crossOriginIsolated === true;
      setStepState({
        current: 'idle',
        exitCode: null,
        error: coiOk
          ? `WebContainers failed to boot: ${reason}`
          : `WebContainers requires Chrome 109+ or Safari 16.4+, with cross-origin isolation (this page is not isolated — got crossOriginIsolated=${String(
              coiOk,
            )}). Underlying error: ${reason}`,
      });
      setRunning(false);
      return;
    }

    // rationale: `teardown` lives on the instance; we close over it so the
    // unmount cleanup can release the SAB-backed VM even if a step throws.
    wcRef.current = { teardown: () => wc.teardown() };
    append('[renatus] WebContainer booted ok\n');

    try {
      // Step 1 — mount. Convert flat map to the nested `FileSystemTree`
      // shape required by `wc.mount`. Each terminal entry is
      // `{ file: { contents } }`; intermediate path segments are
      // `{ directory: { ... } }`.
      append('[renatus] mounting fixture...\n');
      const mountTree = toMountTree(tree.fixtureFiles);
      await wc.mount(mountTree);

      // Overwrite each patched file with `after` text.
      for (const patch of tree.patches) {
        const normalized = patch.filePath.replace(/^\/+/, '');
        // Ensure parent dirs exist (mount might not have created them if the
        // patched path is new).
        const dir = normalized.includes('/')
          ? normalized.slice(0, normalized.lastIndexOf('/'))
          : '';
        if (dir) {
          try {
            await wc.fs.mkdir(dir, { recursive: true });
          } catch {
            // Ignore mkdir failures for existing dirs.
          }
        }
        await wc.fs.writeFile(normalized, patch.after);
      }
      append(
        `[renatus] mount complete: ${
          Object.keys(tree.fixtureFiles).length
        } files, ${tree.patches.length} patches applied\n`,
      );

      // Step 2 — install. Prefer pnpm (the repo standard); fall back to npm.
      setStepState((s) => ({ ...s, current: 'install' }));
      const installExit = await runWithFallback(wc, append, [
        ['pnpm', ['install']],
        ['npm', ['install']],
      ]);
      if (installExit !== 0) {
        setStepState({
          current: 'done',
          exitCode: installExit,
          error: `Install failed with exit code ${installExit}.`,
        });
        setRunning(false);
        return;
      }

      // Step 3 — test.
      setStepState((s) => ({ ...s, current: 'test' }));
      const testExit = await runWithFallback(wc, append, [
        ['pnpm', ['test']],
        ['npm', ['test']],
      ]);

      setStepState({
        current: 'done',
        exitCode: testExit,
        error:
          testExit === 0
            ? null
            : `Tests exited with code ${testExit}.`,
      });
      setRunning(false);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      append(`[renatus] error: ${reason}\n`);
      setStepState({
        current: 'done',
        exitCode: null,
        error: reason,
      });
      setRunning(false);
    }
  }, [jobId, append, running]);

  return (
    <div>
      <StepIndicator state={stepState} />

      <div style={toolbarStyle}>
        <button
          type="button"
          className="btn btn-primary"
          onClick={startReplay}
          disabled={running}
        >
          {running ? 'Running…' : 'Run replay'}
        </button>
        {stepState.current === 'done' && stepState.exitCode === 0 && (
          <span className="badge badge-success">tests passed</span>
        )}
        {stepState.current === 'done' &&
          stepState.exitCode !== null &&
          stepState.exitCode !== 0 && (
            <span className="badge badge-error">
              exit code {stepState.exitCode}
            </span>
          )}
        {stepState.error && stepState.current !== 'done' && (
          <span className="badge badge-error">boot failed</span>
        )}
      </div>

      {stepState.error && (
        <div
          role="alert"
          className="card"
          style={{
            marginTop: '0.75rem',
            borderColor: 'rgba(239, 68, 68, 0.4)',
            background: 'rgba(239, 68, 68, 0.08)',
            color: 'var(--error)',
            fontSize: '0.9375rem',
          }}
        >
          {stepState.error}
        </div>
      )}

      <div ref={terminalRef} style={terminalStyle} aria-label="replay terminal">
        {terminalLines.length === 0 ? (
          <span style={{ color: '#22c55e' }}>
            $ click &quot;Run replay&quot; to boot WebContainers in your
            browser…
          </span>
        ) : (
          terminalLines.map((line, i) => (
            <div key={i} style={{ whiteSpace: 'pre-wrap' }}>
              {line}
            </div>
          ))
        )}
      </div>
    </div>
  );
}

const toolbarStyle: CSSProperties = {
  display: 'flex',
  gap: '0.5rem',
  alignItems: 'center',
  marginTop: '0.75rem',
};

const terminalStyle: CSSProperties = {
  marginTop: '0.75rem',
  height: TERMINAL_HEIGHT,
  overflow: 'auto',
  background: '#000',
  color: '#22c55e',
  padding: '0.75rem 1rem',
  borderRadius: 'var(--radius)',
  border: '1px solid var(--border)',
  fontFamily: 'var(--font-mono)',
  fontSize: '0.8125rem',
  lineHeight: 1.5,
};

function StepIndicator({ state }: { state: StepState }) {
  const steps: Array<{ key: Step; label: string }> = [
    { key: 'mount', label: 'Mount' },
    { key: 'install', label: 'Install' },
    { key: 'test', label: 'Test' },
    { key: 'done', label: 'Done' },
  ];
  const order: Record<Step, number> = {
    idle: -1,
    mount: 0,
    install: 1,
    test: 2,
    done: 3,
  };
  const current = order[state.current];
  return (
    <div
      style={{
        display: 'flex',
        gap: '0.5rem',
        alignItems: 'center',
        flexWrap: 'wrap',
        fontSize: '0.875rem',
      }}
    >
      {steps.map((s, i) => {
        const isPast = order[s.key] < current;
        const isActive = order[s.key] === current;
        const cls = isActive
          ? 'badge badge-brand'
          : isPast
            ? 'badge badge-success'
            : 'badge';
        return (
          <span
            key={s.key}
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}
          >
            <span className={cls}>{s.label}</span>
            {i < steps.length - 1 && (
              <span className="mute" aria-hidden="true">
                →
              </span>
            )}
          </span>
        );
      })}
    </div>
  );
}

/**
 * Run a list of fallback commands. Stop at the first one whose spawn succeeds
 * (regardless of exit code) — return its exit code. If every command fails to
 * spawn, return -1 and write an error to the terminal.
 *
 * We pipe stdout/stderr to the terminal pane via a WHATWG WritableStream.
 */
async function runWithFallback(
  wc: WebContainerInstance,
  append: (chunk: string) => void,
  attempts: ReadonlyArray<[string, string[]]>,
): Promise<number> {
  for (const [cmd, args] of attempts) {
    append(`$ ${cmd} ${args.join(' ')}\n`);
    try {
      const proc = await wc.spawn(cmd, args);
      proc.output.pipeTo(
        new WritableStream<string>({
          write(chunk) {
            append(chunk);
          },
        }),
      );
      const code = await proc.exit;
      append(`\n[exit] ${cmd} ${args.join(' ')} → ${code}\n`);
      return code;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      append(`[renatus] spawn ${cmd} failed: ${reason}\n`);
      continue;
    }
  }
  append('[renatus] all command attempts failed to spawn\n');
  return -1;
}

interface WebContainerProc {
  output: ReadableStream<string>;
  exit: Promise<number>;
}

interface WebContainerInstance {
  spawn(cmd: string, args: string[]): Promise<WebContainerProc>;
  fs: {
    writeFile(path: string, contents: string): Promise<void>;
    mkdir(path: string, opts?: { recursive?: boolean }): Promise<void>;
  };
  mount(tree: MountTree): Promise<void>;
  teardown(): void;
}

/**
 * WebContainers' `mount` accepts a recursive `FileSystemTree`. Each terminal
 * node is `{ file: { contents } }` (text or Uint8Array); directories are
 * `{ directory: <subtree> }`. We build this from the flat `{ path: contents }`
 * map the API route returns.
 */
type MountTree = {
  [name: string]:
    | { file: { contents: string } }
    | { directory: MountTree };
};

function toMountTree(flat: Record<string, string>): MountTree {
  const root: MountTree = {};
  for (const [rawPath, contents] of Object.entries(flat)) {
    const parts = rawPath.split('/').filter((p) => p.length > 0);
    if (parts.length === 0) continue;
    let cursor = root;
    for (let i = 0; i < parts.length - 1; i++) {
      const segment = parts[i]!;
      const existing = cursor[segment];
      if (existing && 'directory' in existing) {
        cursor = existing.directory;
      } else {
        const dir: MountTree = {};
        cursor[segment] = { directory: dir };
        cursor = dir;
      }
    }
    const leaf = parts[parts.length - 1]!;
    cursor[leaf] = { file: { contents } };
  }
  return root;
}
