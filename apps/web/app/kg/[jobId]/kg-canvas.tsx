'use client';

import dynamic from 'next/dynamic';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ComponentType,
} from 'react';
import StaticKgFallback from './kg-static-fallback';

/**
 * `kg-canvas.tsx` — client-only island for `/kg/[jobId]`.
 *
 * Renders the knowledge graph via `react-force-graph-2d` (canvas).
 *
 *   - Nodes sized by sqrt(sizeBytes), clamped [4, 20].
 *   - Color by patchedConfidence:
 *       null   → slate-300 (unpatched)
 *       ≥ 0.85 → green
 *       ≥ 0.70 → yellow
 *       ≥ 0.50 → orange
 *       lower  → red
 *   - Edges thin gray; type-only edges dashed.
 *
 * The replay animation iterates `batchOrder` in order with a 600ms gap. Each
 * batch's nodes are pulsed (scale ×1.3 for 200ms) and re-colored from the
 * unpatched baseline to their patched palette. This is the data structure the
 * recursive CTE produced — visualising what Surgeon used to plan.
 *
 * The graph library is loaded via `dynamic(() => import(...), { ssr: false })`
 * because `react-force-graph-2d` reaches for `window` at module load.
 * Fallback: if the dynamic import fails (or the canvas dep blows up), we
 * render a static SVG via `kg-static-fallback.tsx` — same data, no animation.
 */

const COLOR_UNPATCHED = '#cbd5e1';
const COLOR_HIGH = '#22c55e';
const COLOR_MID = '#eab308';
const COLOR_LOW = '#f97316';
const COLOR_BAD = '#ef4444';
const COLOR_EDGE = 'rgba(140, 140, 160, 0.35)';

const NODE_SIZE_MIN = 4;
const NODE_SIZE_MAX = 20;

const BATCH_INTERVAL_MS = 600;
const PULSE_MS = 200;
const PULSE_SCALE = 1.3;

export interface KgData {
  nodes: Array<{
    id: string;
    path: string;
    sizeBytes: number;
    patchedConfidence: number | null;
    patchedRuleIds: string[];
  }>;
  edges: Array<{
    fromId: string;
    toId: string;
    isTypeOnly: boolean;
  }>;
  batchOrder: Array<{
    batchId: string;
    fileIds: string[];
    timestamp: string;
  }>;
}

// Internal graph-library shape: the library reads `id`, optionally `name`,
// and treats everything else as opaque user data. We keep our domain fields
// on each node so the painter can read them without a side map.
interface KgNode {
  id: string;
  path: string;
  sizeBytes: number;
  patchedConfidence: number | null;
  patchedRuleIds: string[];
  // Mutable rendering state — driven by the replay animation.
  activeConfidence: number | null;
  pulseStart: number | null;
  // Position is owned by the force simulator; declared optional here.
  x?: number;
  y?: number;
}

interface KgLink {
  source: string;
  target: string;
  isTypeOnly: boolean;
}

/**
 * `react-force-graph-2d` exposes an imperative ref handle with these methods.
 * We narrow the surface to what we actually call.
 */
interface ForceGraphHandle {
  // rationale: third-party node mutation (d3 sim state) — typed as any
  // in the upstream package; we cast to a narrow shape at call sites.
  d3Force(name: string, force?: unknown): unknown;
  zoomToFit(durationMs?: number, padding?: number): void;
  pauseAnimation(): void;
  resumeAnimation(): void;
}

/**
 * The library's `default` is a generic functional component (`FCwithRef`)
 * whose props differ slightly from what `next/dynamic`'s prop-pinning
 * machinery accepts (it requires `ref` to be a `MutableRefObject` of the
 * generic's `ForceGraphMethods`). We don't need the generic surface; we
 * pin the prop shape locally as `ForceGraphProps`, then cast the dynamic
 * result via `unknown` so the prop contract is the local interface only.
 *
 * The runtime is unchanged — `dynamic` just returns the component.
 */
interface ForceGraphProps {
  graphData: { nodes: KgNode[]; links: KgLink[] };
  width: number;
  height: number;
  backgroundColor: string;
  nodeRelSize: number;
  cooldownTicks: number;
  enableNodeDrag: boolean;
  nodeLabel: (node: KgNode) => string;
  nodeCanvasObject: (
    node: KgNode,
    ctx: CanvasRenderingContext2D,
    globalScale: number,
  ) => void;
  nodePointerAreaPaint: (
    node: KgNode,
    color: string,
    ctx: CanvasRenderingContext2D,
  ) => void;
  linkColor: () => string;
  linkWidth: number;
  linkLineDash: (link: KgLink) => number[] | null;
  ref?: React.Ref<ForceGraphHandle | null>;
}

// rationale: `next/dynamic` typing is parameterised by the inner component's
// props which conflict with the generic library type; we cast through
// `unknown` to pin our own narrower prop interface at the use site.
const ForceGraph = dynamic(
  () =>
    import('react-force-graph-2d')
      .then((m) => m.default as unknown as ComponentType<ForceGraphProps>)
      .catch(() => {
        // Will be caught by `loadFailed` state below — see useEffect.
        throw new Error('react-force-graph-2d import failed');
      }),
  { ssr: false, loading: () => <CanvasSkeleton /> },
) as ComponentType<ForceGraphProps>;

interface KgCanvasProps {
  data: KgData;
}

export default function KgCanvas({ data }: KgCanvasProps) {
  const [loadFailed, setLoadFailed] = useState(false);
  const [frozen, setFrozen] = useState(false);
  const [replayState, setReplayState] = useState<
    | { kind: 'idle' }
    | { kind: 'playing'; index: number }
    | { kind: 'done' }
  >({ kind: 'idle' });
  const [tick, setTick] = useState(0);
  const [{ width, height }, setSize] = useState({ width: 800, height: 600 });
  const containerRef = useRef<HTMLDivElement>(null);
  const fgRef = useRef<ForceGraphHandle | null>(null);

  // Mirror the input data into a mutable node/link list that carries
  // rendering state. The initial state has every node "unpatched"; the
  // replay animation walks `batchOrder` and flips activeConfidence per node.
  const nodes = useMemo<KgNode[]>(
    () =>
      data.nodes.map((n) => ({
        id: n.id,
        path: n.path,
        sizeBytes: n.sizeBytes,
        patchedConfidence: n.patchedConfidence,
        patchedRuleIds: n.patchedRuleIds,
        activeConfidence: null,
        pulseStart: null,
      })),
    [data.nodes],
  );

  const links = useMemo<KgLink[]>(
    () =>
      data.edges.map((e) => ({
        source: e.fromId,
        target: e.toId,
        isTypeOnly: e.isTypeOnly,
      })),
    [data.edges],
  );

  const nodeById = useMemo(() => {
    const m = new Map<string, KgNode>();
    for (const n of nodes) m.set(n.id, n);
    return m;
  }, [nodes]);

  // Responsive sizing. ResizeObserver gives us the container width; height
  // stays at 600 unless the viewport is narrower than 720 (mobile) — then we
  // shrink to keep both axes visible.
  useEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const update = () => {
      const w = Math.max(320, Math.min(1024, el.clientWidth));
      const h = w < 720 ? Math.round(w * 0.85) : 600;
      setSize({ width: w, height: h });
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => {
      ro.disconnect();
    };
  }, []);

  // Defensively detect dynamic-import failure. If the dynamic component
  // throws at chunk load time, React 19 surfaces it as an effect error. We
  // also handle the case where the module loads but has no default export.
  useEffect(() => {
    const t = setTimeout(() => {
      // If we have nodes but no force-graph DOM appeared after 4s, bail out.
      // This is a soft signal — exact detection isn't possible without a
      // ref into the dynamic chunk. The static fallback is identical data.
      if (
        containerRef.current &&
        containerRef.current.querySelector('canvas') === null &&
        nodes.length > 0
      ) {
        setLoadFailed(true);
      }
    }, 4000);
    return () => clearTimeout(t);
  }, [nodes.length]);

  // Freeze / unfreeze the simulation. The library's `pauseAnimation` halts
  // its requestAnimationFrame loop AND the d3 force step.
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    if (frozen) {
      fg.pauseAnimation();
    } else {
      fg.resumeAnimation();
    }
  }, [frozen]);

  // Replay animation. Walk batchOrder one step every BATCH_INTERVAL_MS;
  // for each batch, set every fileId's activeConfidence to its patched
  // confidence and start a pulse. We bump `tick` to force a re-render so
  // the canvas painter reads fresh node state. Using rAF for the pulse
  // itself would be smoother but the painter is invoked every frame by
  // the force-graph loop anyway, so reading mutable state is sufficient.
  useEffect(() => {
    if (replayState.kind !== 'playing') return;
    const { index } = replayState;
    if (index >= data.batchOrder.length) {
      setReplayState({ kind: 'done' });
      return;
    }

    const batch = data.batchOrder[index];
    if (!batch) {
      setReplayState({ kind: 'done' });
      return;
    }
    const now = performance.now();
    for (const fileId of batch.fileIds) {
      const node = nodeById.get(fileId);
      if (!node) continue;
      node.activeConfidence = node.patchedConfidence;
      node.pulseStart = now;
    }
    setTick((t) => t + 1);

    const handle = window.setTimeout(() => {
      setReplayState({ kind: 'playing', index: index + 1 });
    }, BATCH_INTERVAL_MS);
    return () => {
      window.clearTimeout(handle);
    };
  }, [replayState, data.batchOrder, nodeById]);

  const resetGraph = useCallback(() => {
    for (const n of nodes) {
      n.activeConfidence = null;
      n.pulseStart = null;
    }
    setTick((t) => t + 1);
    setReplayState({ kind: 'idle' });
  }, [nodes]);

  const startReplay = useCallback(() => {
    resetGraph();
    if (data.batchOrder.length === 0) {
      setReplayState({ kind: 'done' });
      return;
    }
    setReplayState({ kind: 'playing', index: 0 });
  }, [data.batchOrder.length, resetGraph]);

  const screenshotPng = useCallback(() => {
    if (!containerRef.current) return;
    const canvas = containerRef.current.querySelector('canvas');
    if (!canvas) return;
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `kg-${Date.now()}.png`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 'image/png');
  }, []);

  // Painter: drawn for every node every frame by force-graph. We do the
  // pulse interpolation here so the animation feels alive even between
  // BATCH_INTERVAL_MS steps.
  const drawNode = useCallback(
    (node: KgNode, ctx: CanvasRenderingContext2D, _globalScale: number) => {
      const baseSize = Math.max(
        NODE_SIZE_MIN,
        Math.min(NODE_SIZE_MAX, Math.sqrt(Math.max(1, node.sizeBytes)) * 0.4),
      );
      const conf = node.activeConfidence;
      let color: string;
      if (conf === null) {
        color = COLOR_UNPATCHED;
      } else if (conf >= 0.85) {
        color = COLOR_HIGH;
      } else if (conf >= 0.7) {
        color = COLOR_MID;
      } else if (conf >= 0.5) {
        color = COLOR_LOW;
      } else {
        color = COLOR_BAD;
      }

      // Pulse interpolation: linear from 1 → PULSE_SCALE over PULSE_MS,
      // then snap back to 1.
      let scale = 1;
      if (node.pulseStart !== null) {
        const elapsed = performance.now() - node.pulseStart;
        if (elapsed < PULSE_MS) {
          const t = elapsed / PULSE_MS;
          scale = 1 + (PULSE_SCALE - 1) * (1 - Math.abs(2 * t - 1));
        } else {
          node.pulseStart = null;
        }
      }

      const r = baseSize * scale;
      const x = node.x ?? 0;
      const y = node.y ?? 0;

      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = 'rgba(0, 0, 0, 0.25)';
      ctx.lineWidth = 0.5;
      ctx.stroke();
    },
    [],
  );

  const paintPointerArea = useCallback(
    (node: KgNode, color: string, ctx: CanvasRenderingContext2D) => {
      const baseSize = Math.max(
        NODE_SIZE_MIN,
        Math.min(NODE_SIZE_MAX, Math.sqrt(Math.max(1, node.sizeBytes)) * 0.4),
      );
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(node.x ?? 0, node.y ?? 0, baseSize + 2, 0, Math.PI * 2);
      ctx.fill();
    },
    [],
  );

  if (loadFailed) {
    return <StaticKgFallback data={data} width={width} height={height} />;
  }

  // Empty state — no files to graph. RSC has already validated the job
  // exists, so this means the indexer hasn't produced rows yet.
  if (nodes.length === 0) {
    return (
      <div className="card">
        <p className="muted" style={{ margin: 0 }}>
          No files have been indexed for this job yet. The graph will populate
          once the Indexer completes.
        </p>
      </div>
    );
  }

  return (
    <div>
      <ReplayToolbar
        replayState={replayState}
        batchCount={data.batchOrder.length}
        frozen={frozen}
        onPlay={startReplay}
        onReset={resetGraph}
        onToggleFreeze={() => setFrozen((f) => !f)}
        onScreenshot={screenshotPng}
      />
      <div
        ref={containerRef}
        style={containerStyle}
        data-tick={tick}
      >
        <ForceGraph
          graphData={{ nodes, links }}
          width={width}
          height={height}
          backgroundColor="#0a0a0a"
          nodeRelSize={1}
          cooldownTicks={frozen ? 0 : 100}
          enableNodeDrag={!frozen}
          nodeLabel={(node) => labelFor(node)}
          nodeCanvasObject={drawNode}
          nodePointerAreaPaint={paintPointerArea}
          linkColor={() => COLOR_EDGE}
          linkWidth={0.6}
          linkLineDash={(link) => (link.isTypeOnly ? [2, 2] : null)}
          ref={(handle: ForceGraphHandle | null) => {
            fgRef.current = handle;
          }}
        />
      </div>
      <Legend />
    </div>
  );
}

function CanvasSkeleton() {
  return (
    <div className="card" style={{ height: 600 }}>
      <p className="muted" style={{ margin: 0 }}>Loading graph…</p>
    </div>
  );
}

const containerStyle: CSSProperties = {
  border: '1px solid var(--border)',
  borderRadius: 'var(--radius-lg)',
  overflow: 'hidden',
  background: '#0a0a0a',
  width: '100%',
  maxWidth: '100%',
};

function labelFor(node: KgNode): string {
  const ruleSuffix =
    node.patchedRuleIds.length > 0
      ? `\nrules: ${node.patchedRuleIds.join(', ')}`
      : '';
  const confSuffix =
    node.patchedConfidence !== null
      ? `\nconfidence: ${(node.patchedConfidence * 100).toFixed(0)}%`
      : '';
  return `${node.path}${confSuffix}${ruleSuffix}`;
}

function ReplayToolbar({
  replayState,
  batchCount,
  frozen,
  onPlay,
  onReset,
  onToggleFreeze,
  onScreenshot,
}: {
  replayState:
    | { kind: 'idle' }
    | { kind: 'playing'; index: number }
    | { kind: 'done' };
  batchCount: number;
  frozen: boolean;
  onPlay: () => void;
  onReset: () => void;
  onToggleFreeze: () => void;
  onScreenshot: () => void;
}) {
  const status =
    replayState.kind === 'idle'
      ? `${batchCount} batches — press Replay to animate`
      : replayState.kind === 'playing'
        ? `Replaying batch ${replayState.index + 1} / ${batchCount}…`
        : `Replay complete — ${batchCount}/${batchCount} batches.`;
  const playLabel = replayState.kind === 'playing' ? 'Replaying…' : 'Replay';
  return (
    <div
      style={{
        display: 'flex',
        gap: '0.5rem',
        alignItems: 'center',
        marginBottom: '0.75rem',
        flexWrap: 'wrap',
      }}
    >
      <button
        type="button"
        className="btn btn-primary"
        onClick={onPlay}
        disabled={batchCount === 0 || replayState.kind === 'playing'}
      >
        {playLabel}
      </button>
      <button
        type="button"
        className="btn"
        onClick={onReset}
        disabled={replayState.kind === 'idle'}
      >
        Reset
      </button>
      <button type="button" className="btn" onClick={onToggleFreeze}>
        {frozen ? 'Unfreeze' : 'Freeze'}
      </button>
      <button type="button" className="btn" onClick={onScreenshot}>
        Screenshot
      </button>
      <span className="muted" style={{ fontSize: '0.8125rem' }}>
        {status}
      </span>
    </div>
  );
}

function Legend() {
  return (
    <div
      style={{
        display: 'flex',
        gap: '1rem',
        marginTop: '0.75rem',
        flexWrap: 'wrap',
        fontSize: '0.8125rem',
      }}
      className="muted"
    >
      <Swatch color={COLOR_UNPATCHED} label="Unpatched" />
      <Swatch color={COLOR_HIGH} label="Confidence ≥ 0.85" />
      <Swatch color={COLOR_MID} label="≥ 0.70" />
      <Swatch color={COLOR_LOW} label="≥ 0.50" />
      <Swatch color={COLOR_BAD} label="lower" />
      <span style={{ marginLeft: '0.5rem' }}>(dashed edges = type-only)</span>
    </div>
  );
}

function Swatch({ color, label }: { color: string; label: string }) {
  return (
    <span style={{ display: 'inline-flex', alignItems: 'center', gap: '0.25rem' }}>
      <span
        style={{
          display: 'inline-block',
          width: 10,
          height: 10,
          borderRadius: 999,
          background: color,
          border: '1px solid rgba(0,0,0,0.25)',
        }}
      />
      {label}
    </span>
  );
}
