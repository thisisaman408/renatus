import { randomUUID } from 'node:crypto';
import { NextResponse, type NextRequest } from 'next/server';
import { z } from 'zod';
import { inngest } from '@renatus/agents';
import {
  JobRepository,
  McpSessionRepository,
  SnapshotRepository,
  WebJobRepository,
  type WebJobProvider,
} from '@renatus/db';
import { EcosystemSchema } from '@renatus/shared';
import { requireDatabaseUrl } from '../../../../lib/database-url';

/**
 * `/api/jobs/[agentKind]` — single parameterized POST handler covering all
 * four agent entry points. Mirrors the `Tier-1 MCP tool` shape used by
 * `packages/mcp-server/src/tools/*-repository.ts`, with two web-app additions:
 *
 *   1. We create a `web_jobs` row alongside the `jobs` row, linking the
 *      visitor's anonymous session cookie to the job.
 *   2. We mint and set a session cookie if the request didn't carry one.
 *
 * The four supported agentKinds map 1:1 to the four Tier-1 MCP tools and
 * their Inngest events:
 *
 *   - migrate   → `renatus/migrate.requested`
 *   - refactor  → `renatus/refactor.requested`
 *   - security  → `renatus/security-audit.requested`
 *   - qa        → `renatus/qa.requested`
 *
 * Node runtime — drizzle + `@neondatabase/serverless` work on Node 20+; the
 * Edge runtime would need an HTTP-only neon adapter.
 */
export const runtime = 'nodejs';
// Don't try to statically analyze this route — it always runs per-request.
export const dynamic = 'force-dynamic';

// ────────────────────────────────────────────────────────────────────────────
// Per-agent body schemas. We re-declare them here (rather than import from
// `@renatus/mcp-server`) to keep the web app's runtime dep graph free of the
// MCP server entry point. The shapes are identical to those in
// `packages/mcp-server/src/tools/*-repository.ts`; if they ever diverge, both
// places need to update — that's a deliberate seam.
// ────────────────────────────────────────────────────────────────────────────

const MigrateBodySchema = z.object({
  repoUrl: z.string().min(1),
  ref: z.string().optional(),
  ecosystem: EcosystemSchema.default('npm'),
  fromVersion: z.string().min(1),
  toVersion: z.string().min(1),
  ruleSource: z
    .discriminatedUnion('kind', [
      z.object({ kind: z.literal('pack') }),
      z.object({ kind: z.literal('changelog'), sourceText: z.string().min(1) }),
      z.object({ kind: z.literal('diff'), sourceText: z.string().min(1) }),
      z.object({ kind: z.literal('guide-url'), sourceText: z.string().min(1) }),
      z.object({
        kind: z.literal('refactor-intent'),
        sourceText: z.string().min(1),
      }),
      z.object({
        kind: z.literal('cve-advisory'),
        sourceText: z.string().min(1),
      }),
    ])
    .default({ kind: 'pack' }),
});

const RefactorBodySchema = z.object({
  repoUrl: z.string().min(1),
  ref: z.string().optional(),
  ecosystem: EcosystemSchema.default('npm'),
  intent: z.string().min(1),
});

const SecurityBodySchema = z.object({
  repoUrl: z.string().min(1),
  ref: z.string().optional(),
  ecosystem: EcosystemSchema.default('npm'),
  cveSource: z.discriminatedUnion('kind', [
    z.object({
      kind: z.literal('cve-id'),
      cveId: z.string().regex(/^CVE-\d{4}-\d+$/i),
    }),
    z.object({
      kind: z.literal('advisory-text'),
      advisoryText: z.string().min(1),
    }),
  ]),
});

// Q&A accepts either a fresh repoUrl OR a cached snapshotId from a prior job.
// .refine() enforces the mutual-exclusion contract at the schema boundary so
// the dispatcher can branch on `b.snapshotId` without re-validating.
const QaBodySchema = z
  .object({
    repoUrl: z.string().min(1).optional(),
    ref: z.string().optional(),
    snapshotId: z.string().uuid().optional(),
    question: z.string().min(1),
  })
  .refine((b) => !!b.repoUrl || !!b.snapshotId, {
    message: 'Either repoUrl OR snapshotId is required',
  });

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

const AGENT_KINDS = ['migrate', 'refactor', 'security', 'qa'] as const;
type AgentKind = (typeof AGENT_KINDS)[number];

function isAgentKind(value: string): value is AgentKind {
  return (AGENT_KINDS as readonly string[]).includes(value);
}

const SESSION_COOKIE_NAME = 'renatus_web_session';
const SESSION_COOKIE_MAX_AGE = 60 * 60 * 24 * 30; // 30 days

/**
 * Read the visitor's session cookie if present, else mint one. We don't
 * persist anything in-memory; the cookie's only persistence is the `web_jobs`
 * row that points to a job — so the visitor's "session" is implicitly the
 * set of jobs created with this cookie value.
 */
function ensureSessionCookie(req: NextRequest): { value: string; setCookie: boolean } {
  const existing = req.cookies.get(SESSION_COOKIE_NAME)?.value;
  if (existing && existing.length > 0) {
    return { value: existing, setCookie: false };
  }
  return { value: `web-${randomUUID()}`, setCookie: true };
}

function applySessionCookie(
  res: NextResponse,
  cookieValue: string,
  setCookie: boolean,
): void {
  if (!setCookie) return;
  res.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: cookieValue,
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: SESSION_COOKIE_MAX_AGE,
  });
}

interface RouteContext {
  // Next.js 16: `params` is async — we await it before reading.
  params: Promise<{ agentKind: string }>;
}

interface SuccessBody {
  jobId: string;
  eventId: string;
  sseUrl: string;
  status: 'queued';
  agentKind: AgentKind;
}

interface ErrorBody {
  error: string;
  detail?: unknown;
}

// ────────────────────────────────────────────────────────────────────────────
// POST handler
// ────────────────────────────────────────────────────────────────────────────

export async function POST(
  req: NextRequest,
  context: RouteContext,
): Promise<NextResponse<SuccessBody | ErrorBody>> {
  const { agentKind: rawAgentKind } = await context.params;
  if (!isAgentKind(rawAgentKind)) {
    return NextResponse.json<ErrorBody>(
      {
        error: `Unknown agentKind: ${rawAgentKind}. Expected one of ${AGENT_KINDS.join(', ')}.`,
      },
      { status: 404 },
    );
  }
  const agentKind: AgentKind = rawAgentKind;

  let body: unknown;
  try {
    body = await req.json();
  } catch (err) {
    return NextResponse.json<ErrorBody>(
      {
        error: 'Invalid JSON body',
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 400 },
    );
  }

  let databaseUrl: string;
  try {
    databaseUrl = requireDatabaseUrl();
  } catch (err) {
    return NextResponse.json<ErrorBody>(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }

  // Parse the body with the schema for the requested agent. The schema is the
  // entire contract; we trust it after this point.
  const parsed = parseBodyForAgent(agentKind, body);
  if (!parsed.ok) {
    return NextResponse.json<ErrorBody>(
      {
        error: 'Invalid request body',
        detail: parsed.issues,
      },
      { status: 422 },
    );
  }

  const session = ensureSessionCookie(req);
  const sessionRepo = new McpSessionRepository(databaseUrl);
  const jobRepo = new JobRepository(databaseUrl);
  const webJobRepo = new WebJobRepository(databaseUrl);

  // Use the session cookie as the bobTaskId so that all jobs submitted by
  // the same browser end up sharing one MCP session row — this mirrors how
  // multiple Bob tasks share one session via bobTaskId in the MCP path.
  const bobTaskId = `web-${session.value}`;
  const mcpSession = await sessionRepo.upsertSession(bobTaskId, 'http', {
    surface: 'web',
    userAgent: req.headers.get('user-agent') ?? null,
    referer: req.headers.get('referer') ?? null,
  });
  if (!mcpSession) {
    return NextResponse.json<ErrorBody>(
      { error: 'Failed to ensure MCP session row' },
      { status: 500 },
    );
  }

  // Each agent kind needs slightly different `jobs` columns and Inngest event
  // payloads. We branch once on agentKind and produce both.
  let dispatched: DispatchOutput;
  try {
    dispatched = await dispatchAgent({
      agentKind,
      body: parsed.value,
      sessionId: mcpSession.id,
      jobRepo,
      databaseUrl,
    });
  } catch (err) {
    // Surfaces the cached-snapshot not-found case (and any other dispatch-time
    // validation failure) as a clean 422 rather than a 500.
    return NextResponse.json<ErrorBody>(
      {
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 422 },
    );
  }

  // Persist the web_jobs link row. `provider` defaults to 'auto'; we'll wire
  // a per-visitor provider picker in a later wave.
  const clientMetadata: Record<string, unknown> = {
    surface: 'web',
    userAgent: req.headers.get('user-agent') ?? null,
    referer: req.headers.get('referer') ?? null,
  };
  const provider: WebJobProvider = 'auto';
  await webJobRepo.create({
    jobId: dispatched.jobId,
    sessionCookie: session.value,
    provider,
    clientMetadata,
  });

  const sseUrl = `/api/jobs/${dispatched.jobId}/stream`;
  const res = NextResponse.json<SuccessBody>(
    {
      jobId: dispatched.jobId,
      eventId: dispatched.eventId,
      sseUrl,
      status: 'queued',
      agentKind,
    },
    { status: 202 },
  );
  applySessionCookie(res, session.value, session.setCookie);
  return res;
}

// ────────────────────────────────────────────────────────────────────────────
// Per-agent dispatch — create the job row, fire the Inngest event, return ids
// ────────────────────────────────────────────────────────────────────────────

interface DispatchInput {
  agentKind: AgentKind;
  body: ParsedBody;
  sessionId: string;
  jobRepo: JobRepository;
  databaseUrl: string;
}

interface DispatchOutput {
  jobId: string;
  eventId: string;
}

async function dispatchAgent({
  agentKind,
  body,
  sessionId,
  jobRepo,
  databaseUrl,
}: DispatchInput): Promise<DispatchOutput> {
  if (agentKind === 'migrate') {
    const b = body as z.infer<typeof MigrateBodySchema>;
    const job = await jobRepo.create({
      sessionId,
      repoUrl: b.repoUrl,
      sourceVersion: b.fromVersion,
      targetVersion: b.toVersion,
      ecosystem: b.ecosystem,
      agentKind: 'migrate',
      metadata: { ref: b.ref ?? null, ruleSource: b.ruleSource },
    });
    const send = await inngest.send({
      name: 'renatus/migrate.requested',
      data: {
        jobId: job.id,
        repoUrl: b.repoUrl,
        ref: b.ref,
        ecosystem: b.ecosystem,
        fromVersion: b.fromVersion,
        toVersion: b.toVersion,
        agentKind: 'migrate',
        ruleSource: b.ruleSource,
      },
    });
    return { jobId: job.id, eventId: send.ids[0] ?? 'unknown' };
  }

  if (agentKind === 'refactor') {
    const b = body as z.infer<typeof RefactorBodySchema>;
    const job = await jobRepo.create({
      sessionId,
      repoUrl: b.repoUrl,
      sourceVersion: 'refactor',
      targetVersion: 'refactor',
      ecosystem: b.ecosystem,
      agentKind: 'refactor',
      metadata: { ref: b.ref ?? null, intent: b.intent },
    });
    const send = await inngest.send({
      name: 'renatus/refactor.requested',
      data: {
        jobId: job.id,
        repoUrl: b.repoUrl,
        ref: b.ref,
        ecosystem: b.ecosystem,
        intent: b.intent,
      },
    });
    return { jobId: job.id, eventId: send.ids[0] ?? 'unknown' };
  }

  if (agentKind === 'security') {
    const b = body as z.infer<typeof SecurityBodySchema>;
    const job = await jobRepo.create({
      sessionId,
      repoUrl: b.repoUrl,
      sourceVersion: 'security',
      targetVersion: 'security',
      ecosystem: b.ecosystem,
      agentKind: 'security_audit',
      metadata: { ref: b.ref ?? null, cveSource: b.cveSource },
    });
    const send = await inngest.send({
      name: 'renatus/security-audit.requested',
      data: {
        jobId: job.id,
        repoUrl: b.repoUrl,
        ref: b.ref,
        ecosystem: b.ecosystem,
        cveSource: b.cveSource,
      },
    });
    return { jobId: job.id, eventId: send.ids[0] ?? 'unknown' };
  }

  // qa — accepts either a fresh repoUrl OR a cached snapshotId. On the
  // cached path we look up the source snapshot's repoUrl/ref so the jobs row
  // still has a human-readable URL for the audit page.
  const b = body as z.infer<typeof QaBodySchema>;
  let qaJobRepoUrl: string;
  let qaJobRef: string | null;
  if (b.snapshotId) {
    const snapshotRepo = new SnapshotRepository(databaseUrl);
    const snapshot = await snapshotRepo.getById(b.snapshotId);
    if (!snapshot) {
      throw new Error(
        `Snapshot ${b.snapshotId} not found — pass a snapshotId from a completed job, or omit it to clone fresh.`,
      );
    }
    qaJobRepoUrl = snapshot.repoUrl;
    qaJobRef = snapshot.ref;
  } else {
    // refine() guarantees repoUrl is present on this branch.
    qaJobRepoUrl = b.repoUrl as string;
    qaJobRef = b.ref ?? null;
  }

  const job = await jobRepo.create({
    sessionId,
    repoUrl: qaJobRepoUrl,
    sourceVersion: 'qa',
    targetVersion: 'qa',
    ecosystem: 'npm',
    agentKind: 'qa',
    metadata: {
      ref: qaJobRef,
      question: b.question,
      sourceKind: b.snapshotId ? 'cached' : 'fresh',
      sourceSnapshotId: b.snapshotId ?? null,
    },
  });

  const source = b.snapshotId
    ? ({ kind: 'cached' as const, snapshotId: b.snapshotId } as const)
    : ({
        kind: 'fresh' as const,
        repoUrl: b.repoUrl as string,
        ref: b.ref,
      } as const);

  const send = await inngest.send({
    name: 'renatus/qa.requested',
    data: {
      jobId: job.id,
      question: b.question,
      source,
    },
  });
  return { jobId: job.id, eventId: send.ids[0] ?? 'unknown' };
}

// ────────────────────────────────────────────────────────────────────────────
// Per-agent body parser. Returns a discriminated union so callers can write a
// single `if (!parsed.ok)` check.
//
// We type `value` as the union of all four schema outputs; the dispatcher
// narrows by re-checking `agentKind`. This matches how the MCP tools dispatch.
// ────────────────────────────────────────────────────────────────────────────

type ParsedBody =
  | z.infer<typeof MigrateBodySchema>
  | z.infer<typeof RefactorBodySchema>
  | z.infer<typeof SecurityBodySchema>
  | z.infer<typeof QaBodySchema>;

type ParseResult =
  | { ok: true; value: ParsedBody }
  | { ok: false; issues: z.ZodIssue[] };

function parseBodyForAgent(agentKind: AgentKind, body: unknown): ParseResult {
  switch (agentKind) {
    case 'migrate': {
      const result = MigrateBodySchema.safeParse(body);
      return result.success
        ? { ok: true, value: result.data }
        : { ok: false, issues: result.error.issues };
    }
    case 'refactor': {
      const result = RefactorBodySchema.safeParse(body);
      return result.success
        ? { ok: true, value: result.data }
        : { ok: false, issues: result.error.issues };
    }
    case 'security': {
      const result = SecurityBodySchema.safeParse(body);
      return result.success
        ? { ok: true, value: result.data }
        : { ok: false, issues: result.error.issues };
    }
    case 'qa': {
      const result = QaBodySchema.safeParse(body);
      return result.success
        ? { ok: true, value: result.data }
        : { ok: false, issues: result.error.issues };
    }
  }
}
