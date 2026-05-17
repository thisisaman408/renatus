'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

/**
 * Live progress feed client island.
 *
 * Opens an EventSource against `/api/jobs/[jobId]/stream`. The stream emits:
 *   - `state`: { state, jobId } — most recent jobs.state value
 *   - `audit`: SsePayload — one row from audit_events
 *   - `done`: { state, jobId } — terminal state reached
 *   - `error`: { message } — transient or terminal stream error
 *   - `timeout`: { jobId, durationMs } — 5-min cap hit; feed will reopen next nav
 *
 * UI:
 *   - State badge at the top, color coded.
 *   - Most-recent event at the top of the list.
 *   - When state ∈ {audited, done}: a link to `/audit/[jobId]`.
 *   - For Q&A: when transcript arrives, render the answer + citations.
 */

interface AuditEventPayload {
  id: string;
  timestamp: string;
  agentKind: string;
  eventType: string;
  payload: Record<string, unknown>;
  entityId: string | null;
  entityType: string | null;
}

interface QaInitialTranscript {
  question: string;
  answer: string;
  citations: Array<{
    filePath: string;
    line?: number;
    sha: string;
    snippet?: string;
  }>;
}

interface JobLiveFeedProps {
  jobId: string;
  agentKind: string;
  initialState: string;
  initialEvents: AuditEventPayload[];
  initialTranscript: QaInitialTranscript | null;
}

const TERMINAL_STATES = new Set(['done', 'failed', 'aborted']);

export default function JobLiveFeed({
  jobId,
  agentKind,
  initialState,
  initialEvents,
  initialTranscript,
}: JobLiveFeedProps) {
  const [state, setState] = useState<string>(initialState);
  const [events, setEvents] = useState<AuditEventPayload[]>(initialEvents);
  const [transcript, setTranscript] =
    useState<QaInitialTranscript | null>(initialTranscript);
  const [streamError, setStreamError] = useState<string | null>(null);
  const [closed, setClosed] = useState<boolean>(false);

  // Track seen event ids client-side too — the server filters dupes within a
  // single stream, but on reconnect we get a fresh backfill and need to
  // de-dupe locally.
  const seenIds = useRef<Set<string>>(
    new Set(initialEvents.map((e) => e.id)),
  );

  // Poll the Q&A transcript on every state change for a Q&A job. Cheap:
  // single row by jobId. We avoid embedding the transcript in audit_events
  // because the canonical row lives in qa_transcripts.
  const fetchTranscript = useCallback(async () => {
    if (agentKind !== 'qa') return;
    try {
      const res = await fetch(`/api/jobs/${jobId}/qa-transcript`, {
        cache: 'no-store',
      });
      if (!res.ok) return;
      const data = (await res.json()) as {
        transcript: QaInitialTranscript | null;
      };
      if (data.transcript) setTranscript(data.transcript);
    } catch {
      /* transient — try again next tick */
    }
  }, [agentKind, jobId]);

  useEffect(() => {
    // Already terminal on first paint? Don't open a stream.
    if (TERMINAL_STATES.has(initialState)) {
      setClosed(true);
      if (agentKind === 'qa' && !initialTranscript) {
        void fetchTranscript();
      }
      return;
    }

    const src = new EventSource(`/api/jobs/${jobId}/stream`);

    src.addEventListener('state', (e) => {
      try {
        const data = JSON.parse((e as MessageEvent<string>).data) as {
          state: string;
        };
        setState(data.state);
        if (TERMINAL_STATES.has(data.state)) {
          setClosed(true);
          if (agentKind === 'qa') void fetchTranscript();
        } else if (
          data.state === 'audited' ||
          data.state === 'patched' ||
          data.state === 'tested'
        ) {
          if (agentKind === 'qa') void fetchTranscript();
        }
      } catch {
        /* malformed frame — ignore */
      }
    });

    src.addEventListener('audit', (e) => {
      try {
        const data = JSON.parse(
          (e as MessageEvent<string>).data,
        ) as AuditEventPayload;
        if (seenIds.current.has(data.id)) return;
        seenIds.current.add(data.id);
        setEvents((prev) => [data, ...prev]);
      } catch {
        /* malformed frame — ignore */
      }
    });

    src.addEventListener('done', (e) => {
      try {
        const data = JSON.parse((e as MessageEvent<string>).data) as {
          state: string;
        };
        setState(data.state);
      } catch {
        /* ignore */
      }
      setClosed(true);
      src.close();
      if (agentKind === 'qa') void fetchTranscript();
    });

    src.addEventListener('timeout', () => {
      setClosed(true);
      src.close();
    });

    src.addEventListener('error', (e) => {
      // EventSource fires its native `error` event on disconnect; for our
      // server-emitted `error` typed events the data is JSON. Disambiguate:
      // a typed-error MessageEvent has `.data`, a network disconnect doesn't.
      const msg = (e as MessageEvent<string>).data;
      if (typeof msg === 'string' && msg.length > 0) {
        try {
          const parsed = JSON.parse(msg) as { message?: string };
          if (parsed.message) {
            setStreamError(parsed.message);
            return;
          }
        } catch {
          /* fall through */
        }
      }
      setStreamError('Connection interrupted.');
    });

    return () => {
      src.close();
    };
  }, [
    jobId,
    agentKind,
    initialState,
    initialTranscript,
    fetchTranscript,
  ]);

  const stateBadgeClass = useMemo(() => {
    if (state === 'done' || state === 'audited') return 'badge-success';
    if (state === 'failed' || state === 'aborted') return 'badge-error';
    if (state === 'paused') return 'badge-warn';
    return 'badge-brand';
  }, [state]);

  return (
    <section style={{ marginTop: '2rem' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          marginBottom: '1.5rem',
          flexWrap: 'wrap',
        }}
      >
        <span className={`badge ${stateBadgeClass}`}>{state}</span>
        {!closed && (
          <span
            className="muted"
            style={{ fontSize: '0.875rem' }}
            aria-live="polite"
          >
            streaming live…
          </span>
        )}
        {closed && (
          <span className="muted" style={{ fontSize: '0.875rem' }}>
            stream closed
          </span>
        )}
        {(state === 'audited' || state === 'done') && (
          <a className="btn" href={`/audit/${jobId}`}>
            View signed audit report →
          </a>
        )}
      </div>

      {streamError && (
        <div
          className="card"
          style={{
            borderColor: 'rgba(245, 158, 11, 0.4)',
            background: 'rgba(245, 158, 11, 0.08)',
            color: 'var(--warn)',
            marginBottom: '1rem',
          }}
          role="alert"
        >
          <strong>Stream notice:</strong> {streamError}
        </div>
      )}

      {transcript && (
        <div className="card" style={{ marginBottom: '1.5rem' }}>
          <h3 style={{ marginTop: 0 }}>Q&amp;A transcript</h3>
          <p className="muted" style={{ marginBottom: '0.5rem', fontSize: '0.875rem' }}>
            Question
          </p>
          <p style={{ marginBottom: '1rem' }}>{transcript.question}</p>
          <p className="muted" style={{ marginBottom: '0.5rem', fontSize: '0.875rem' }}>
            Answer
          </p>
          <p style={{ whiteSpace: 'pre-wrap' }}>{transcript.answer}</p>
          {transcript.citations.length > 0 && (
            <>
              <p className="muted" style={{ marginTop: '1rem', marginBottom: '0.5rem', fontSize: '0.875rem' }}>
                Citations
              </p>
              <ul style={{ paddingLeft: '1.25rem', margin: 0 }}>
                {transcript.citations.map((c, i) => (
                  <li key={`${c.filePath}-${i}`} style={{ marginBottom: '0.25rem' }}>
                    <code>
                      {c.filePath}
                      {c.line !== undefined ? `:${c.line}` : ''}
                    </code>
                    {c.snippet && (
                      <>
                        {' — '}
                        <span className="muted">{c.snippet}</span>
                      </>
                    )}
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}

      <h2 style={{ marginBottom: '1rem' }}>Audit events</h2>
      {events.length === 0 ? (
        <p className="muted">
          No events yet — the workflow will start emitting once the orchestrator picks
          up the queued event (typically a few seconds).
        </p>
      ) : (
        <ol
          style={{
            listStyle: 'none',
            padding: 0,
            margin: 0,
            display: 'flex',
            flexDirection: 'column',
            gap: '0.5rem',
          }}
        >
          {events.map((event) => (
            <li
              key={event.id}
              className="card"
              style={{ padding: '0.75rem 1rem' }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  gap: '0.5rem',
                  flexWrap: 'wrap',
                }}
              >
                <span className="badge">{event.agentKind}</span>
                <span style={{ fontWeight: 500 }}>{event.eventType}</span>
                <span
                  className="mute"
                  style={{ fontSize: '0.75rem', marginLeft: 'auto' }}
                >
                  {new Date(event.timestamp).toLocaleTimeString()}
                </span>
              </div>
              {Object.keys(event.payload).length > 0 && (
                <details style={{ marginTop: '0.5rem' }}>
                  <summary
                    style={{
                      cursor: 'pointer',
                      fontSize: '0.8125rem',
                      color: 'var(--text-dim)',
                    }}
                  >
                    payload
                  </summary>
                  <pre style={{ marginTop: '0.5rem', fontSize: '0.75rem' }}>
                    {JSON.stringify(event.payload, null, 2)}
                  </pre>
                </details>
              )}
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
