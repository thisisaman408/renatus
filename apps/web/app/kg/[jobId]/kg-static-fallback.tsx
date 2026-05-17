'use client';

import { useMemo } from 'react';
import type { KgData } from './kg-canvas';

/**
 * Static SVG fallback when `react-force-graph-2d` fails to load.
 *
 * Runs a small Fruchterman-Reingold layout (100 iterations) deterministically
 * seeded by node-id hash, then renders the result as plain SVG. No animation;
 * the same patch-confidence palette as the canvas variant. This is the
 * "graph still tells the story" path from the roadmap fallback matrix.
 */

const COLOR_UNPATCHED = '#cbd5e1';
const COLOR_HIGH = '#22c55e';
const COLOR_MID = '#eab308';
const COLOR_LOW = '#f97316';
const COLOR_BAD = '#ef4444';
const COLOR_EDGE = 'rgba(140, 140, 160, 0.45)';

interface StaticKgFallbackProps {
  data: KgData;
  width: number;
  height: number;
}

interface LaidOutNode {
  id: string;
  path: string;
  x: number;
  y: number;
  r: number;
  color: string;
  patchedRuleIds: string[];
}

/**
 * djb2 string hash → seeds the initial random positions deterministically.
 */
function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) {
    h = (h * 33) ^ s.charCodeAt(i);
  }
  // unsigned 32-bit
  return h >>> 0;
}

function paletteFor(confidence: number | null): string {
  if (confidence === null) return COLOR_UNPATCHED;
  if (confidence >= 0.85) return COLOR_HIGH;
  if (confidence >= 0.7) return COLOR_MID;
  if (confidence >= 0.5) return COLOR_LOW;
  return COLOR_BAD;
}

export default function StaticKgFallback({
  data,
  width,
  height,
}: StaticKgFallbackProps) {
  const laidOut = useMemo<LaidOutNode[]>(() => {
    if (data.nodes.length === 0) return [];
    // Deterministic seed positions: spread nodes around an initial circle.
    const positions = new Map<string, { x: number; y: number }>();
    const cx = width / 2;
    const cy = height / 2;
    const baseR = Math.min(width, height) * 0.4;
    for (const n of data.nodes) {
      const seed = djb2(n.id);
      const theta = (seed % 360) * (Math.PI / 180);
      const rj = 0.6 + ((seed >>> 8) % 100) / 250; // 0.6..1.0
      positions.set(n.id, {
        x: cx + Math.cos(theta) * baseR * rj,
        y: cy + Math.sin(theta) * baseR * rj,
      });
    }

    // Fruchterman-Reingold force iteration. Simple, no quadtree — fine for
    // <500 nodes which is well above the React fixture's 8.
    const k = Math.sqrt((width * height) / Math.max(1, data.nodes.length));
    const iterations = 100;
    let temperature = Math.min(width, height) / 10;

    const adj = new Map<string, Set<string>>();
    for (const e of data.edges) {
      if (!adj.has(e.fromId)) adj.set(e.fromId, new Set());
      if (!adj.has(e.toId)) adj.set(e.toId, new Set());
      adj.get(e.fromId)!.add(e.toId);
      adj.get(e.toId)!.add(e.fromId);
    }

    const ids = data.nodes.map((n) => n.id);
    const disp = new Map<string, { x: number; y: number }>();

    for (let iter = 0; iter < iterations; iter++) {
      for (const id of ids) disp.set(id, { x: 0, y: 0 });

      // Repulsive
      for (let i = 0; i < ids.length; i++) {
        const a = ids[i]!;
        const pa = positions.get(a)!;
        for (let j = i + 1; j < ids.length; j++) {
          const b = ids[j]!;
          const pb = positions.get(b)!;
          let dx = pa.x - pb.x;
          let dy = pa.y - pb.y;
          let d = Math.hypot(dx, dy);
          if (d < 0.01) {
            // Identical positions — jitter deterministically by hash.
            dx = ((djb2(a + b) % 100) - 50) / 100;
            dy = ((djb2(b + a) % 100) - 50) / 100;
            d = Math.hypot(dx, dy);
          }
          const f = (k * k) / d;
          const da = disp.get(a)!;
          const db = disp.get(b)!;
          da.x += (dx / d) * f;
          da.y += (dy / d) * f;
          db.x -= (dx / d) * f;
          db.y -= (dy / d) * f;
        }
      }

      // Attractive
      for (const e of data.edges) {
        const pa = positions.get(e.fromId);
        const pb = positions.get(e.toId);
        if (!pa || !pb) continue;
        const dx = pa.x - pb.x;
        const dy = pa.y - pb.y;
        const d = Math.hypot(dx, dy);
        if (d < 0.01) continue;
        const f = (d * d) / k;
        const da = disp.get(e.fromId)!;
        const db = disp.get(e.toId)!;
        da.x -= (dx / d) * f;
        da.y -= (dy / d) * f;
        db.x += (dx / d) * f;
        db.y += (dy / d) * f;
      }

      // Position update with cooling
      for (const id of ids) {
        const p = positions.get(id)!;
        const d = disp.get(id)!;
        const len = Math.hypot(d.x, d.y);
        if (len < 0.01) continue;
        p.x += (d.x / len) * Math.min(len, temperature);
        p.y += (d.y / len) * Math.min(len, temperature);
        // Bound inside the viewport with margin.
        p.x = Math.max(20, Math.min(width - 20, p.x));
        p.y = Math.max(20, Math.min(height - 20, p.y));
      }

      temperature *= 0.95;
    }

    return data.nodes.map((n) => {
      const pos = positions.get(n.id)!;
      const r = Math.max(4, Math.min(20, Math.sqrt(Math.max(1, n.sizeBytes)) * 0.4));
      return {
        id: n.id,
        path: n.path,
        x: pos.x,
        y: pos.y,
        r,
        color: paletteFor(n.patchedConfidence),
        patchedRuleIds: n.patchedRuleIds,
      };
    });
  }, [data.nodes, data.edges, width, height]);

  const pos = useMemo(() => {
    const m = new Map<string, LaidOutNode>();
    for (const n of laidOut) m.set(n.id, n);
    return m;
  }, [laidOut]);

  if (laidOut.length === 0) {
    return (
      <div className="card">
        <p className="muted" style={{ margin: 0 }}>
          Graph fallback active, but there are no indexed files for this job.
        </p>
      </div>
    );
  }

  return (
    <div>
      <p
        className="badge badge-warn"
        style={{ display: 'inline-block', marginBottom: '0.5rem' }}
      >
        Static fallback — canvas renderer unavailable in this browser
      </p>
      <svg
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        style={{
          background: '#0a0a0a',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-lg)',
          display: 'block',
          maxWidth: '100%',
        }}
      >
        {data.edges.map((e, i) => {
          const a = pos.get(e.fromId);
          const b = pos.get(e.toId);
          if (!a || !b) return null;
          return (
            <line
              key={`${e.fromId}-${e.toId}-${i}`}
              x1={a.x}
              y1={a.y}
              x2={b.x}
              y2={b.y}
              stroke={COLOR_EDGE}
              strokeWidth={0.6}
              strokeDasharray={e.isTypeOnly ? '2 2' : undefined}
            />
          );
        })}
        {laidOut.map((n) => (
          <g key={n.id}>
            <circle
              cx={n.x}
              cy={n.y}
              r={n.r}
              fill={n.color}
              stroke="rgba(0,0,0,0.25)"
              strokeWidth={0.5}
            >
              <title>
                {n.path}
                {n.patchedRuleIds.length > 0
                  ? `\nrules: ${n.patchedRuleIds.join(', ')}`
                  : ''}
              </title>
            </circle>
          </g>
        ))}
      </svg>
    </div>
  );
}
