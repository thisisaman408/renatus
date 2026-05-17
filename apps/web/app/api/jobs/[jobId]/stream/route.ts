import type { NextRequest } from 'next/server';
import {
  AuditEventRepository,
  JobRepository,
  type JobRow,
} from '@renatus/db';
import { requireDatabaseUrl } from '../../../../../lib/database-url';

/**
 * `/api/jobs/[jobId]/stream` — SSE backend.
 *
 * Polls the `audit_events` table every 1000ms and emits one SSE event per
 * audit_event row written since the last poll. Also emits a `state` event each
 * time the `jobs.state` column transitions. Heartbeats every 15s keep the
 * connection alive through any intermediate proxy that idles connections.
 *
 * Termination:
 *   - jobs.state ∈ {done, failed, aborted} → emit a final `state` and close.
 *   - 5 minutes elapse without a terminal state → close (heartbeat timeout).
 *   - Client aborts the connection → drain the loop on the next tick.
 *
 * Why polling rather than NOTIFY/LISTEN: neon-http doesn't support
 * LISTEN/NOTIFY, and a thin polling loop is fine for the demo budget. We
 * keep the loop interval at 1000ms — fast enough for the audit-events UI to
 * feel live, slow enough that 50 concurrent watchers don't melt the planet.
 *
 * Node runtime — drizzle + `@neondatabase/serverless` work on Node 20+; the
 * Edge runtime would need an HTTP-only neon adapter.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const POLL_INTERVAL_MS = 1000;
const HEARTBEAT_INTERVAL_MS = 15_000;
const MAX_DURATION_MS = 5 * 60 * 1000; // 5 minutes

const TERMINAL_STATES = new Set(['done', 'failed', 'aborted']);

interface RouteContext {
  // Next.js 16: `params` is async.
  params: Promise<{ jobId: string }>;
}

interface SsePayload {
  id: string;
  timestamp: string;
  agentKind: string;
  eventType: string;
  payload: Record<string, unknown>;
  entityId: string | null;
  entityType: string | null;
}

/**
 * Encode a payload as a single SSE event frame. Each frame is:
 *
 *   event: <type>\n
 *   data: <json>\n
 *   \n
 *
 * We use a typed `event:` line so the client can `addEventListener('audit', …)`
 * vs `addEventListener('state', …)` separately. A plain `data:` frame without
 * `event:` shows up as the default 'message' event.
 */
function frame(eventType: string, data: unknown): string {
  return `event: ${eventType}\ndata: ${JSON.stringify(data)}\n\n`;
}

export async function GET(
  req: NextRequest,
  context: RouteContext,
): Promise<Response> {
  const { jobId } = await context.params;

  // Validate jobId shape early — saves a DB round-trip on garbage requests.
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId)) {
    return new Response(JSON.stringify({ error: 'Invalid jobId' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  let databaseUrl: string;
  try {
    databaseUrl = requireDatabaseUrl();
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: err instanceof Error ? err.message : String(err),
      }),
      { status: 500, headers: { 'content-type': 'application/json' } },
    );
  }

  const jobRepo = new JobRepository(databaseUrl);
  const auditEventRepo = new AuditEventRepository(databaseUrl);

  // Confirm the job exists. If it doesn't, fail fast so the client UI can
  // render a 404 state instead of waiting on a hung stream.
  const initial = await jobRepo.getById(jobId);
  if (!initial) {
    return new Response(JSON.stringify({ error: 'Job not found' }), {
      status: 404,
      headers: { 'content-type': 'application/json' },
    });
  }

  const encoder = new TextEncoder();
  const abortSignal = req.signal;
  const startedAt = Date.now();

  // Track which events we've already emitted so we never double-send. Using
  // a Set of UUIDs keeps the check O(1) per poll.
  const seenEventIds = new Set<string>();
  let lastState: JobRow['state'] = initial.state;

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enqueue = (frameStr: string): boolean => {
        try {
          controller.enqueue(encoder.encode(frameStr));
          return true;
        } catch {
          // Controller closed (e.g. client disconnected mid-write). The
          // outer loop will pick this up on its next iteration via abortSignal.
          return false;
        }
      };

      // Send an immediate snapshot so the UI sees something on connect.
      enqueue(frame('state', { state: initial.state, jobId }));

      // Backfill: emit every audit event we already have so a freshly-opened
      // page doesn't have to refetch the initial page payload.
      try {
        const existing = await auditEventRepo.findByJobId(jobId);
        for (const event of existing) {
          seenEventIds.add(event.id);
          const payload: SsePayload = {
            id: event.id,
            timestamp: event.timestamp.toISOString(),
            agentKind: event.agentKind,
            eventType: event.eventType,
            payload: event.payload as Record<string, unknown>,
            entityId: event.entityId,
            entityType: event.entityType,
          };
          if (!enqueue(frame('audit', payload))) return;
        }
      } catch (err) {
        enqueue(
          frame('error', {
            message: err instanceof Error ? err.message : String(err),
          }),
        );
      }

      // If the job is already terminal, end now.
      if (TERMINAL_STATES.has(initial.state)) {
        enqueue(frame('done', { state: initial.state, jobId }));
        try {
          controller.close();
        } catch {
          /* already closed */
        }
        return;
      }

      // Main poll loop. We use setInterval rather than recursive setTimeout so
      // cancellation is a single clearInterval. The heartbeat is scheduled
      // separately so a slow poll doesn't push the comment frame off-schedule.
      let stopped = false;
      const stop = (): void => {
        if (stopped) return;
        stopped = true;
        clearInterval(pollHandle);
        clearInterval(heartbeatHandle);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };

      // Heartbeat — SSE comments (`: ...`) are ignored by the EventSource API
      // but they prevent proxy idle-timeouts from killing the stream.
      const heartbeatHandle = setInterval(() => {
        if (!enqueue(`: heartbeat ${Date.now()}\n\n`)) stop();
      }, HEARTBEAT_INTERVAL_MS);

      // Polls audit_events and the jobs row.
      const pollHandle = setInterval(async () => {
        if (abortSignal.aborted) {
          stop();
          return;
        }
        if (Date.now() - startedAt > MAX_DURATION_MS) {
          enqueue(
            frame('timeout', {
              jobId,
              durationMs: Date.now() - startedAt,
            }),
          );
          stop();
          return;
        }

        try {
          // 1. New audit events
          const events = await auditEventRepo.findByJobId(jobId);
          for (const event of events) {
            if (seenEventIds.has(event.id)) continue;
            seenEventIds.add(event.id);
            const payload: SsePayload = {
              id: event.id,
              timestamp: event.timestamp.toISOString(),
              agentKind: event.agentKind,
              eventType: event.eventType,
              payload: event.payload as Record<string, unknown>,
              entityId: event.entityId,
              entityType: event.entityType,
            };
            if (!enqueue(frame('audit', payload))) {
              stop();
              return;
            }
          }

          // 2. State transition
          const current = await jobRepo.getById(jobId);
          if (current && current.state !== lastState) {
            lastState = current.state;
            if (!enqueue(frame('state', { state: current.state, jobId }))) {
              stop();
              return;
            }
            if (TERMINAL_STATES.has(current.state)) {
              enqueue(frame('done', { state: current.state, jobId }));
              stop();
              return;
            }
          }
        } catch (err) {
          enqueue(
            frame('error', {
              message: err instanceof Error ? err.message : String(err),
            }),
          );
          // Don't stop on transient DB errors — neon-http occasionally
          // returns 5xx; the next poll usually succeeds. Hard failures will
          // surface again next tick.
        }
      }, POLL_INTERVAL_MS);

      // Abort wiring
      abortSignal.addEventListener('abort', stop, { once: true });
    },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      // Disable Nginx/Cloudflare buffering — many edge proxies will buffer
      // text/event-stream by default and break the live feed.
      'x-accel-buffering': 'no',
    },
  });
}
