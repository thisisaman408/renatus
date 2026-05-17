import { serve } from 'inngest/next';
import { functions, inngest } from '@renatus/agents';

/**
 * Inngest serve handler — Next.js app-router style.
 *
 * Inngest's dev-server and cloud orchestrator hit this URL to discover the
 * function registry and to drive each step. The four agent workflows (migrate
 * / refactor / security_audit / qa) are all re-exported from `@renatus/agents`
 * via `functions`.
 *
 * Node runtime — the workflows touch drizzle + `@neondatabase/serverless`,
 * neither of which is compatible with the Edge runtime today.
 */
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;
// rationale: Inngest's serve handler wraps the request and produces its own
// caching headers; Next 16 occasionally tries to cache the GET response.
// Forcing dynamic disables that.

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions,
});
