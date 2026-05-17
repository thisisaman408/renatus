'use client';

import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useTransition,
  type FormEvent,
} from 'react';

/**
 * Tabbed agent picker + per-agent form. Client island.
 *
 * Tab state lives in the URL via `?agent=...` so deep links work and so
 * back/forward navigates between forms. We use `history.replaceState` to keep
 * the URL in sync without a full route push (which would re-fetch the RSC
 * shell for no reason).
 *
 * Submission: POST to `/api/agents/{agentKind}` and on success navigate to
 * `/jobs/{jobId}` for the SSE live feed.
 */

export type AgentKey = 'migrate' | 'refactor' | 'security' | 'qa';

const AGENT_LABELS: Record<AgentKey, string> = {
  migrate: 'Migrate',
  refactor: 'Refactor',
  security: 'Security audit',
  qa: 'Q&A',
};

const AGENT_ORDER: AgentKey[] = ['migrate', 'refactor', 'security', 'qa'];

interface RunFormProps {
  initialAgent: AgentKey;
}

/**
 * One-time prefill values pulled from `window.location.search` on mount.
 * Each key maps to a `defaultValue=` on the matching input — we use
 * `defaultValue` (uncontrolled) so the user can freely edit after the
 * initial paint without React fighting their keystrokes.
 *
 * Keys are intentionally narrow; unknown query params are ignored.
 */
interface Prefill {
  repoUrl?: string;
  ref?: string;
  ecosystem?: string;
  fromVersion?: string;
  toVersion?: string;
  intent?: string;
  cveId?: string;
  advisoryText?: string;
  question?: string;
  snapshotId?: string;
}

const PREFILL_KEYS: readonly (keyof Prefill)[] = [
  'repoUrl',
  'ref',
  'ecosystem',
  'fromVersion',
  'toVersion',
  'intent',
  'cveId',
  'advisoryText',
  'question',
  'snapshotId',
];

function readPrefillFromSearch(search: string): Prefill {
  const params = new URLSearchParams(search);
  const out: Prefill = {};
  for (const k of PREFILL_KEYS) {
    const raw = params.get(k);
    if (raw !== null && raw !== '') {
      out[k] = raw;
    }
  }
  return out;
}

interface JobCreatedResponse {
  jobId: string;
  eventId: string;
}

interface ApiErrorResponse {
  error: string;
  detail?: unknown;
}

export default function RunForm({ initialAgent }: RunFormProps) {
  const [agent, setAgent] = useState<AgentKey>(initialAgent);

  // Read prefill from `window.location.search` exactly once, on mount.
  // We capture in state so subsequent `?agent=` rewrites by the effect
  // below don't clobber the original prefill values (URLSearchParams
  // round-trips the unknown keys, but useMemo on `location.search` would
  // re-fire when we replaceState — easier to snapshot once).
  const [prefill, setPrefill] = useState<Prefill>({});
  useEffect(() => {
    if (typeof window === 'undefined') return;
    setPrefill(readPrefillFromSearch(window.location.search));
  }, []);

  // Keep `?agent=` in sync with the visible tab. We use replaceState so back-
  // forward still works (each tab gets a real history entry on click below).
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const params = new URLSearchParams(window.location.search);
    if (params.get('agent') !== agent) {
      params.set('agent', agent);
      const next = `${window.location.pathname}?${params.toString()}`;
      window.history.replaceState(null, '', next);
    }
  }, [agent]);

  return (
    <div style={{ marginTop: '2rem' }}>
      <SmartPrompt onAgentDetected={setAgent} />

      {/* Visual separator between the two independent paths: the smart-prompt
       * (LLM dispatches directly) and the manual form (tab + fields). They
       * share no state — the tab below does NOT change the agent the LLM
       * picks above. */}
      <div
        role="separator"
        aria-orientation="horizontal"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          margin: '2rem 0 1.25rem',
        }}
      >
        <hr style={{ flex: 1, margin: 0 }} />
        <span
          className="muted"
          style={{
            fontSize: '0.8125rem',
            textTransform: 'uppercase',
            letterSpacing: '0.08em',
            whiteSpace: 'nowrap',
          }}
        >
          — or fill the form manually below —
        </span>
        <hr style={{ flex: 1, margin: 0 }} />
      </div>

      <div
        role="tablist"
        aria-label="Agent picker"
        style={{
          display: 'flex',
          gap: '0.5rem',
          borderBottom: '1px solid var(--border)',
          marginBottom: '1.5rem',
        }}
      >
        {AGENT_ORDER.map((key) => {
          const active = key === agent;
          return (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setAgent(key)}
              style={{
                padding: '0.625rem 1rem',
                background: 'transparent',
                border: 'none',
                borderBottom: active
                  ? '2px solid var(--brand)'
                  : '2px solid transparent',
                color: active ? 'var(--text)' : 'var(--text-dim)',
                cursor: 'pointer',
                fontFamily: 'inherit',
                fontSize: '0.9375rem',
                fontWeight: 500,
                marginBottom: '-1px',
              }}
            >
              {AGENT_LABELS[key]}
            </button>
          );
        })}
      </div>

      <p
        className="muted"
        style={{
          fontSize: '0.875rem',
          marginBottom: '1rem',
          fontStyle: 'italic',
        }}
      >
        Manual {AGENT_LABELS[agent]} dispatch
      </p>

      <AgentForm key={agent} agent={agent} prefill={prefill} />
    </div>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Heuristic agent prediction — pure, sync, runs on every keystroke.
// ────────────────────────────────────────────────────────────────────────────

/**
 * Tiny rule-based predictor: tells the user which agent the LLM will likely
 * pick if they hit Run right now. Runs locally on every keystroke — no
 * network, no LLM call. Priority order (first match wins):
 *
 *   1. security  — "cve-", "cve ", "vulnerab", "exploit"
 *   2. migrate   — "migrate", "upgrade", "from X to Y" (numeric or vN)
 *   3. refactor  — "refactor", "rename", "extract", "split", "consolidate"
 *   4. qa        — question word at start OR "?" anywhere
 *   5. qa        — safe default (Q&A on a repo is always valid)
 *
 * Returns `null` when the prompt is effectively empty, so callers can render
 * a distinct "auto-detect" state instead of misleading the user.
 */
function predictAgent(prompt: string): AgentKey | null {
  const trimmed = prompt.trim();
  if (trimmed.length === 0) return null;
  const lower = trimmed.toLowerCase();

  // 1. security
  if (
    lower.includes('cve-') ||
    lower.includes('cve ') ||
    lower.includes('vulnerab') ||
    lower.includes('exploit')
  ) {
    return 'security';
  }

  // 2. migrate — explicit keyword or version-range pattern
  if (
    lower.includes('migrate') ||
    lower.includes('upgrade') ||
    /\bfrom\s+\d+(?:\.\d+)*\s+to\s+\d+(?:\.\d+)*/i.test(trimmed) ||
    /\bv?\d+(?:\.\d+)*\s+to\s+v?\d+(?:\.\d+)*/i.test(trimmed)
  ) {
    return 'migrate';
  }

  // 3. refactor
  if (
    lower.includes('refactor') ||
    lower.includes('rename') ||
    lower.includes('extract') ||
    lower.includes('split') ||
    lower.includes('consolidate')
  ) {
    return 'refactor';
  }

  // 4. qa — question word OR question mark
  if (
    /^(where|what|how|why|when|which|who)\b/i.test(trimmed) ||
    trimmed.includes('?')
  ) {
    return 'qa';
  }

  // 5. default
  return 'qa';
}

// ────────────────────────────────────────────────────────────────────────────
// SmartPrompt — plain-English entry. LLM parses → directly dispatches.
// ────────────────────────────────────────────────────────────────────────────

interface ParsedIntent {
  agentKind: 'migrate' | 'refactor' | 'security' | 'qa';
  repoUrl: string;
  ref?: string | null;
  ecosystem?: string | null;
  fromVersion?: string | null;
  toVersion?: string | null;
  ruleKind?: 'pack' | 'changelog' | 'guide-url' | null;
  sourceText?: string | null;
  intent?: string | null;
  cveKind?: 'cve-id' | 'advisory-text' | null;
  cveId?: string | null;
  advisoryText?: string | null;
  question?: string | null;
  snapshotId?: string | null;
}

interface ParseIntentResponse {
  intent?: ParsedIntent;
  error?: string;
  raw?: unknown;
}

const EXAMPLES = [
  'Migrate https://github.com/streamich/react-use from React 18 to 19',
  'Refactor https://github.com/owner/repo to rename getUser to loadUser',
  'Security audit https://github.com/owner/repo for CVE-2024-3094',
  'Where is auth middleware in https://github.com/owner/repo ?',
];

function SmartPrompt({
  onAgentDetected,
}: {
  onAgentDetected: (agent: AgentKey) => void;
}) {
  const [prompt, setPrompt] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Live agent prediction. Recomputed on every keystroke, but the heuristic
  // is O(n) over the trimmed prompt with a tiny constant — cheaper than a
  // React render, so no debouncing needed.
  const predicted = useMemo(() => predictAgent(prompt), [prompt]);

  const submit = useCallback(async () => {
    setError(null);
    setStatus(null);
    if (prompt.trim().length < 3) {
      setError('Type at least a few words.');
      return;
    }
    setBusy(true);
    try {
      // 1. LLM parses the intent.
      setStatus('Parsing your request with watsonx Granite…');
      const parseRes = await fetch('/api/parse-intent', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ prompt }),
      });
      const parseJson = (await parseRes.json()) as ParseIntentResponse;
      if (!parseRes.ok || !parseJson.intent) {
        setError(parseJson.error ?? `Parse failed (${parseRes.status})`);
        return;
      }
      const intent = parseJson.intent;
      onAgentDetected(intent.agentKind as AgentKey);

      // 2. Build the dispatch body for this agent.
      const body = buildDispatchBody(intent);
      if (typeof body === 'string') {
        setError(body);
        return;
      }

      // 3. Dispatch.
      setStatus(
        `Dispatching ${intent.agentKind} on ${intent.repoUrl}…`,
      );
      const runRes = await fetch(`/api/agents/${intent.agentKind}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!runRes.ok) {
        let msg = `Dispatch failed (${runRes.status})`;
        try {
          const j = (await runRes.json()) as { error?: string };
          if (j.error) msg = j.error;
        } catch {
          /* ignore */
        }
        setError(msg);
        return;
      }
      const payload = (await runRes.json()) as { jobId?: string };
      if (!payload.jobId) {
        setError('Server returned no jobId.');
        return;
      }
      window.location.assign(`/jobs/${payload.jobId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }, [prompt, onAgentDetected]);

  return (
    <div
      style={{
        background: 'var(--card)',
        border: '1px solid var(--border)',
        borderRadius: '12px',
        padding: '1.25rem',
      }}
    >
      <label
        htmlFor="smart-prompt"
        style={{
          display: 'block',
          fontSize: '1.0625rem',
          fontWeight: 600,
          marginBottom: '0.5rem',
        }}
      >
        Tell Renatus what you want
      </label>
      <p
        style={{
          color: 'var(--text-dim)',
          fontSize: '0.875rem',
          margin: '0 0 0.75rem',
        }}
      >
        One sentence. Renatus picks the right agent, fills the form, dispatches
        the job. Examples:{' '}
        <em style={{ color: 'var(--text)' }}>
          “Migrate streamich/react-use to React 19”
        </em>
        ,{' '}
        <em style={{ color: 'var(--text)' }}>
          “Audit owner/repo for CVE-2024-3094”
        </em>
        .
      </p>
      <textarea
        id="smart-prompt"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault();
            void submit();
          }
        }}
        rows={2}
        placeholder={EXAMPLES[0]}
        disabled={busy}
        style={{ width: '100%', resize: 'vertical' }}
      />
      {/* Live agent-prediction badge. Pure client heuristic — we never block
       * the user's keystrokes on an LLM call. The phrasing makes it clear
       * this is the auto-detected dispatch path, NOT linked to the manual
       * tabs below. */}
      <div
        aria-live="polite"
        style={{
          marginTop: '0.625rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.25rem',
        }}
      >
        <div>
          <span
            className={
              predicted === null ? 'badge' : 'badge badge-brand'
            }
            style={
              predicted === null ? { color: 'var(--text-mute)' } : undefined
            }
          >
            {predicted === null
              ? 'Auto-detected agent: auto-detect'
              : `Auto-detected agent: ${predicted}`}
          </span>
        </div>
        <p
          className="mute"
          style={{ margin: 0, fontSize: '0.75rem', fontStyle: 'italic' }}
        >
          The form below is a separate manual path — pick a tab if you&apos;d
          rather fill fields yourself.
        </p>
      </div>
      <div
        style={{
          display: 'flex',
          gap: '0.75rem',
          alignItems: 'center',
          marginTop: '0.75rem',
          flexWrap: 'wrap',
        }}
      >
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void submit()}
          disabled={busy}
        >
          {busy ? 'Working…' : 'Run (⌘↩)'}
        </button>
        {status && !error && (
          <span style={{ color: 'var(--text-dim)', fontSize: '0.875rem' }}>
            {status}
          </span>
        )}
        {error && (
          <span className="badge badge-error" role="alert">
            {error}
          </span>
        )}
      </div>
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.5rem',
          marginTop: '0.75rem',
        }}
      >
        {EXAMPLES.map((ex) => (
          <button
            key={ex}
            type="button"
            onClick={() => setPrompt(ex)}
            disabled={busy}
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              borderRadius: '6px',
              padding: '0.25rem 0.625rem',
              fontSize: '0.8125rem',
              color: 'var(--text-dim)',
              cursor: 'pointer',
            }}
          >
            {ex}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Build the per-agent dispatch body from a parsed intent. Returns a string
 * error message if required fields are missing.
 */
function buildDispatchBody(
  i: ParsedIntent,
): Record<string, unknown> | string {
  if (!i.repoUrl && i.agentKind !== 'qa') {
    return 'Could not identify a repo URL in your prompt.';
  }
  switch (i.agentKind) {
    case 'migrate': {
      const ruleKind = i.ruleKind ?? 'pack';
      const ruleSource =
        ruleKind === 'pack'
          ? { kind: 'pack' as const }
          : { kind: ruleKind, sourceText: i.sourceText ?? '' };
      return {
        repoUrl: i.repoUrl,
        ref: i.ref ?? undefined,
        ecosystem: i.ecosystem ?? 'npm',
        fromVersion: i.fromVersion ?? '18.0.0',
        toVersion: i.toVersion ?? '19.0.0',
        ruleSource,
      };
    }
    case 'refactor':
      if (!i.intent) return 'Refactor needs an intent — say what to change.';
      return {
        repoUrl: i.repoUrl,
        ref: i.ref ?? undefined,
        intent: i.intent,
        ecosystem: i.ecosystem ?? 'npm',
      };
    case 'security': {
      const cveKind = i.cveKind ?? (i.cveId ? 'cve-id' : 'advisory-text');
      if (cveKind === 'cve-id' && !i.cveId)
        return 'Security needs a CVE id (e.g. CVE-2024-3094) or advisory text.';
      if (cveKind === 'advisory-text' && !i.advisoryText)
        return 'Security needs advisory text or a CVE id.';
      const cveSource =
        cveKind === 'cve-id'
          ? { kind: 'cve-id' as const, cveId: i.cveId! }
          : { kind: 'advisory-text' as const, advisoryText: i.advisoryText! };
      return {
        repoUrl: i.repoUrl,
        ref: i.ref ?? undefined,
        ecosystem: i.ecosystem ?? 'npm',
        cveSource,
      };
    }
    case 'qa':
      if (!i.question) return 'Q&A needs a question.';
      if (i.snapshotId) {
        return { snapshotId: i.snapshotId, question: i.question };
      }
      if (!i.repoUrl) {
        return 'Q&A needs either a repo URL or a snapshotId.';
      }
      return {
        repoUrl: i.repoUrl,
        ref: i.ref ?? undefined,
        question: i.question,
      };
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Per-agent form
// ────────────────────────────────────────────────────────────────────────────

interface AgentFormProps {
  agent: AgentKey;
  prefill: Prefill;
}

function AgentForm({ agent, prefill }: AgentFormProps) {
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      setSubmitError(null);
      const formEl = event.currentTarget;
      const body = collectFormBody(agent, formEl);
      startTransition(async () => {
        try {
          const res = await fetch(`/api/agents/${agent}`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
          });
          if (!res.ok) {
            // Best-effort: surface the server's error string.
            let errMsg = `Request failed (${res.status})`;
            try {
              const parsed = (await res.json()) as ApiErrorResponse;
              if (parsed.error) errMsg = parsed.error;
            } catch {
              /* parsing error — keep generic */
            }
            setSubmitError(errMsg);
            return;
          }
          const payload = (await res.json()) as JobCreatedResponse;
          if (!payload.jobId) {
            setSubmitError('Server returned no jobId.');
            return;
          }
          // Hard navigate to the SSE page. We don't useRouter here because we
          // want the browser to fully arm a fresh EventSource (a soft
          // navigation can leak listeners across forms).
          window.location.assign(`/jobs/${payload.jobId}`);
        } catch (err) {
          setSubmitError(err instanceof Error ? err.message : String(err));
        }
      });
    },
    [agent],
  );

  return (
    <form onSubmit={handleSubmit} noValidate>
      {agent === 'migrate' && <MigrateFields prefill={prefill} />}
      {agent === 'refactor' && <RefactorFields prefill={prefill} />}
      {agent === 'security' && <SecurityFields prefill={prefill} />}
      {agent === 'qa' && <QaFields prefill={prefill} />}

      <div
        style={{
          display: 'flex',
          gap: '0.75rem',
          alignItems: 'center',
          marginTop: '1.5rem',
        }}
      >
        <button
          className="btn btn-primary"
          type="submit"
          disabled={isPending}
        >
          {isPending ? 'Submitting…' : 'Run agent'}
        </button>
        {submitError && (
          <span className="badge badge-error" role="alert">
            {submitError}
          </span>
        )}
      </div>
    </form>
  );
}

// Shared first-row inputs for all 4 agents. Ecosystem is NOT included here —
// migrate renders a visible select for it, refactor/security/qa accept the
// route-handler's `EcosystemSchema.default('npm')` from the server.
//
// Prefill: `repoUrl` and `ref` are honored here; downstream fields wire up
// their own prefill in each per-agent component below.
function RepoFields({ prefill }: { prefill: Prefill }) {
  return (
    <>
      <div className="field">
        <label htmlFor="repoUrl">Repository URL</label>
        <input
          id="repoUrl"
          name="repoUrl"
          type="url"
          required
          placeholder="https://github.com/owner/repo"
          defaultValue={prefill.repoUrl}
        />
        <p className="field-help">
          Public https URL, ssh URL, or file:// path for local repos.
        </p>
      </div>
      <div className="field">
        <label htmlFor="ref">Ref (optional)</label>
        <input
          id="ref"
          name="ref"
          type="text"
          placeholder="main"
          defaultValue={prefill.ref}
        />
        <p className="field-help">Branch, tag, or commit SHA. Defaults to <code>main</code>.</p>
      </div>
    </>
  );
}

function MigrateFields({ prefill }: { prefill: Prefill }) {
  const [ruleKind, setRuleKind] = useState<'pack' | 'changelog' | 'guide-url'>(
    'pack',
  );
  return (
    <>
      <RepoFields prefill={prefill} />
      <div className="field">
        <label htmlFor="ecosystem-select">Ecosystem</label>
        <select
          id="ecosystem-select"
          name="ecosystem"
          defaultValue={prefill.ecosystem ?? 'npm'}
        >
          <option value="npm">npm</option>
          <option value="pypi">pypi</option>
          <option value="pip">pip</option>
          <option value="cargo">cargo</option>
          <option value="maven">maven</option>
          <option value="gradle">gradle</option>
        </select>
      </div>
      <div className="field">
        <label htmlFor="fromVersion">From version</label>
        <input
          id="fromVersion"
          name="fromVersion"
          type="text"
          required
          defaultValue={prefill.fromVersion ?? '18.0.0'}
          placeholder="18.0.0"
        />
        <p className="field-help">Default React 18→19 — change for Tailwind, Node, etc.</p>
      </div>
      <div className="field">
        <label htmlFor="toVersion">To version</label>
        <input
          id="toVersion"
          name="toVersion"
          type="text"
          required
          defaultValue={prefill.toVersion ?? '19.0.0'}
          placeholder="19.0.0"
        />
      </div>
      <div className="field">
        <label htmlFor="ruleKind">Rule source</label>
        <select
          id="ruleKind"
          name="ruleKind"
          value={ruleKind}
          onChange={(e) =>
            setRuleKind(e.target.value as 'pack' | 'changelog' | 'guide-url')
          }
        >
          <option value="pack">pack — bundled (e.g. tailwind-3-to-4)</option>
          <option value="changelog">changelog — paste release notes</option>
          <option value="guide-url">guide-url — paste an upgrade-guide URL or text</option>
        </select>
      </div>
      {ruleKind !== 'pack' && (
        <div className="field">
          <label htmlFor="sourceText">
            {ruleKind === 'changelog' ? 'Changelog text' : 'Guide URL or content'}
          </label>
          <textarea
            id="sourceText"
            name="sourceText"
            required
            rows={6}
            placeholder={
              ruleKind === 'changelog'
                ? 'Paste the upstream changelog…'
                : 'https://… or paste the guide text…'
            }
          />
        </div>
      )}
    </>
  );
}

function RefactorFields({ prefill }: { prefill: Prefill }) {
  return (
    <>
      <RepoFields prefill={prefill} />
      <div className="field">
        <label htmlFor="intent">Refactor intent</label>
        <textarea
          id="intent"
          name="intent"
          required
          rows={5}
          placeholder="Rename getUser to loadUser across the codebase."
          defaultValue={prefill.intent}
        />
        <p className="field-help">
          Natural-language description of the change. The Cartographer turns
          this into structured rules.
        </p>
      </div>
    </>
  );
}

function SecurityFields({ prefill }: { prefill: Prefill }) {
  // If the caller pre-filled `advisoryText` (and not `cveId`), start on the
  // advisory-text branch so their text doesn't end up hidden behind the
  // CVE-id branch.
  const initialCveKind: 'cve-id' | 'advisory-text' =
    prefill.advisoryText && !prefill.cveId ? 'advisory-text' : 'cve-id';
  const [cveKind, setCveKind] = useState<'cve-id' | 'advisory-text'>(
    initialCveKind,
  );
  return (
    <>
      <RepoFields prefill={prefill} />
      <div className="field">
        <label htmlFor="cveKind">Source</label>
        <select
          id="cveKind"
          name="cveKind"
          value={cveKind}
          onChange={(e) =>
            setCveKind(e.target.value as 'cve-id' | 'advisory-text')
          }
        >
          <option value="cve-id">cve-id — fetched from NVD</option>
          <option value="advisory-text">advisory-text — paste below</option>
        </select>
      </div>
      {cveKind === 'cve-id' ? (
        <div className="field">
          <label htmlFor="cveId">CVE identifier</label>
          <input
            id="cveId"
            name="cveId"
            type="text"
            required
            pattern="CVE-\d{4}-\d+"
            placeholder="CVE-2024-12345"
            defaultValue={prefill.cveId}
          />
          <p className="field-help">
            We fetch the advisory text from the public NVD REST API.
          </p>
        </div>
      ) : (
        <div className="field">
          <label htmlFor="advisoryText">Advisory text</label>
          <textarea
            id="advisoryText"
            name="advisoryText"
            required
            rows={8}
            placeholder="Paste the security advisory, CVE description, or vendor bulletin…"
            defaultValue={prefill.advisoryText}
          />
        </div>
      )}
    </>
  );
}

function QaFields({ prefill }: { prefill: Prefill }) {
  // Source mode toggle: 'fresh' (clone+index a new repo) or 'cached' (reuse
  // an existing snapshot from a prior job, skipping clone+index). If the
  // caller pre-filled `snapshotId` we boot directly into cached mode so the
  // input is visible.
  const initialSourceMode: 'fresh' | 'cached' = prefill.snapshotId
    ? 'cached'
    : 'fresh';
  const [sourceMode, setSourceMode] = useState<'fresh' | 'cached'>(
    initialSourceMode,
  );
  return (
    <>
      <div className="field">
        <label htmlFor="qaSourceMode">Source</label>
        <select
          id="qaSourceMode"
          name="qaSourceMode"
          value={sourceMode}
          onChange={(e) => setSourceMode(e.target.value as 'fresh' | 'cached')}
        >
          <option value="fresh">fresh — clone + index a new repo</option>
          <option value="cached">
            cached — reuse a snapshot from a prior job (faster)
          </option>
        </select>
        <p className="field-help">
          Cached mode skips clone + index. Paste the <code>snapshotId</code>{' '}
          shown on a completed job&apos;s audit page.
        </p>
      </div>
      {sourceMode === 'fresh' ? (
        <RepoFields prefill={prefill} />
      ) : (
        <div className="field">
          <label htmlFor="snapshotId">Source snapshot ID (UUID)</label>
          <input
            id="snapshotId"
            name="snapshotId"
            type="text"
            required
            pattern="[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}"
            placeholder="e.g. 3f9b3c8a-1234-5678-9abc-def012345678"
            defaultValue={prefill.snapshotId}
          />
          <p className="field-help">
            Find this on any completed job&apos;s <code>/audit/[jobId]</code>{' '}
            page. The Q&amp;A workflow will reuse the indexed snapshot
            byte-for-byte.
          </p>
        </div>
      )}
      <div className="field">
        <label htmlFor="question">Question</label>
        <textarea
          id="question"
          name="question"
          required
          rows={4}
          placeholder="Where is the auth middleware composed?"
          defaultValue={prefill.question}
        />
        <p className="field-help">
          Read-only. The Q&A agent retrieves and answers — it never writes a
          patch. The transcript is signed.
        </p>
      </div>
    </>
  );
}

// ────────────────────────────────────────────────────────────────────────────
// Form → request body
// ────────────────────────────────────────────────────────────────────────────

/**
 * Pull form fields off the DOM and shape them into the JSON body our route
 * handler expects. The shape mirrors the per-agent Zod schemas in
 * `packages/mcp-server/src/tools/*-repository.ts` — the route handler re-parses
 * the body with the same schemas so any drift here surfaces as a 422.
 */
function collectFormBody(
  agent: AgentKey,
  formEl: HTMLFormElement,
): Record<string, unknown> {
  const fd = new FormData(formEl);
  const v = (name: string): string => {
    const raw = fd.get(name);
    return typeof raw === 'string' ? raw.trim() : '';
  };

  const repoUrl = v('repoUrl');
  const ref = v('ref') || undefined;

  if (agent === 'migrate') {
    const ruleKind = (v('ruleKind') || 'pack') as
      | 'pack'
      | 'changelog'
      | 'guide-url';
    const ruleSource =
      ruleKind === 'pack'
        ? { kind: 'pack' as const }
        : ruleKind === 'changelog'
          ? { kind: 'changelog' as const, sourceText: v('sourceText') }
          : { kind: 'guide-url' as const, sourceText: v('sourceText') };
    return {
      repoUrl,
      ref,
      ecosystem: v('ecosystem') || 'npm',
      fromVersion: v('fromVersion'),
      toVersion: v('toVersion'),
      ruleSource,
    };
  }

  if (agent === 'refactor') {
    return {
      repoUrl,
      ref,
      intent: v('intent'),
    };
  }

  if (agent === 'security') {
    const cveKind = (v('cveKind') || 'cve-id') as 'cve-id' | 'advisory-text';
    const cveSource =
      cveKind === 'cve-id'
        ? { kind: 'cve-id' as const, cveId: v('cveId') }
        : {
            kind: 'advisory-text' as const,
            advisoryText: v('advisoryText'),
          };
    return {
      repoUrl,
      ref,
      cveSource,
    };
  }

  // qa — two source modes:
  //   • fresh   → sends { question, repoUrl, ref }
  //   • cached  → sends { question, snapshotId } (server skips clone+index)
  // The /api/agents/qa route's QaBodySchema.refine() enforces exactly one of
  // (repoUrl, snapshotId), so we drop the unused field on each branch rather
  // than send empty strings.
  const qaSourceMode = (v('qaSourceMode') || 'fresh') as 'fresh' | 'cached';
  if (qaSourceMode === 'cached') {
    return {
      snapshotId: v('snapshotId'),
      question: v('question'),
    };
  }
  return {
    repoUrl,
    ref,
    question: v('question'),
  };
}

