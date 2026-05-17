import RunForm, { type AgentKey } from './run-form';

/**
 * `/run` — tabbed picker for the four agent forms.
 *
 * RSC wrapper. The tab state is read from `?agent=` so deep-links (`/migrate`,
 * `/refactor`, `/security`, `/qa`) land on the right form without a client
 * round-trip. The form itself is a client island (`run-form.tsx`).
 */

const AGENT_KEYS = ['migrate', 'refactor', 'security', 'qa'] as const;

function pickAgentFromParam(value: string | string[] | undefined): AgentKey {
  if (Array.isArray(value)) {
    const head = value[0];
    if (head && (AGENT_KEYS as readonly string[]).includes(head)) {
      return head as AgentKey;
    }
  } else if (value && (AGENT_KEYS as readonly string[]).includes(value)) {
    return value as AgentKey;
  }
  return 'migrate';
}

interface PageProps {
  searchParams: Promise<{ agent?: string | string[] }>;
}

export default async function RunPage({ searchParams }: PageProps) {
  // Next.js 16: `searchParams` is async — we await it before reading. The
  // type contract enforces it; forgetting `await` would error at type-check.
  const sp = await searchParams;
  const initialAgent = pickAgentFromParam(sp.agent);

  return (
    <main className="container" style={{ padding: '3rem 1.5rem 6rem' }}>
      <p className="muted" style={{ marginBottom: '0.5rem', fontSize: '0.9375rem' }}>
        Renatus · run an agent
      </p>
      <h1 style={{ marginBottom: '0.5rem' }}>Pick an agent</h1>
      <p className="muted" style={{ maxWidth: 640 }}>
        Each agent runs on the same engine. The only difference is the input
        shape and the system prompt the Cartographer uses to plan the work.
        Submit a form and watch the live progress feed on the next page.
      </p>

      <RunForm initialAgent={initialAgent} />
    </main>
  );
}
