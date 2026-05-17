/**
 * POST /api/parse-intent
 *
 * Takes a plain-English prompt and uses the LlmRouter to extract a structured
 * intent for the /run form. Lets a judge type "migrate react-use to React 19"
 * instead of filling 6 form fields.
 *
 * Returns `{ agentKind, fields: { ... } }` ready to feed into the existing
 * /api/agents/[agentKind] dispatcher, OR `{ error: '...' }` if the intent
 * couldn't be parsed.
 */
import { NextResponse } from 'next/server';
import { z } from 'zod';
import { LlmRouter } from '@renatus/llm';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const RequestSchema = z.object({
  prompt: z.string().min(3).max(2000),
});

// What the LLM is expected to emit. We coerce a wide variety of inputs into
// this shape and validate with Zod before passing back to the client.
const ParsedIntentSchema = z.object({
  agentKind: z.enum(['migrate', 'refactor', 'security', 'qa']),
  repoUrl: z.string().min(1),
  ref: z.string().optional().nullable(),
  // migrate-specific
  ecosystem: z.enum(['npm', 'pypi', 'pip', 'cargo', 'maven', 'gradle']).optional().nullable(),
  fromVersion: z.string().optional().nullable(),
  toVersion: z.string().optional().nullable(),
  ruleKind: z.enum(['pack', 'changelog', 'guide-url']).optional().nullable(),
  sourceText: z.string().optional().nullable(),
  // refactor-specific
  intent: z.string().optional().nullable(),
  // security-specific
  cveKind: z.enum(['cve-id', 'advisory-text']).optional().nullable(),
  cveId: z.string().optional().nullable(),
  advisoryText: z.string().optional().nullable(),
  // qa-specific
  question: z.string().optional().nullable(),
  snapshotId: z.string().uuid().optional().nullable(),
});

const SYSTEM_PROMPT = `You are Renatus's intent parser. The user types a single sentence describing what they want Renatus to do; you emit a JSON object describing the agent + fields.

There are four agents:
- migrate: upgrade a codebase between dependency versions (e.g. React 18 → 19, Tailwind 3 → 4). Needs: repoUrl, ecosystem (npm/pypi/pip/cargo/maven/gradle), fromVersion, toVersion. If the user pastes a changelog or upgrade-guide URL, set ruleKind="changelog"|"guide-url" and put the source content into sourceText. Default ruleKind is "pack" (Renatus uses its bundled rule pack).
- refactor: natural-language code transformation (e.g. "rename getUser to loadUser"). Needs: repoUrl + intent (a short natural-language sentence).
- security: CVE-driven security audit. Needs: repoUrl + cveKind. If the user gives a CVE id like "CVE-2024-3094", set cveKind="cve-id" + cveId. If they paste advisory text, set cveKind="advisory-text" + advisoryText.
- qa: read-only Q&A on a codebase. Needs: repoUrl + question. If the user references a prior job (e.g. "ask my previous migration") and includes a UUID, set snapshotId.

Always emit valid JSON matching this exact shape (no markdown fences, no commentary):
{
  "agentKind": "migrate" | "refactor" | "security" | "qa",
  "repoUrl": string,
  "ref": string | null,
  "ecosystem": string | null,
  "fromVersion": string | null,
  "toVersion": string | null,
  "ruleKind": string | null,
  "sourceText": string | null,
  "intent": string | null,
  "cveKind": string | null,
  "cveId": string | null,
  "advisoryText": string | null,
  "question": string | null,
  "snapshotId": string | null
}

Rules:
- repoUrl: accept https://github.com/owner/repo, github.com/owner/repo (add https://), file:// paths. Always emit the full URL with https:// prefix.
- ref: **emit null unless the user explicitly named a branch, tag, or commit SHA**. Do NOT default to "main" — many repos still use "master" or other default branches, and Renatus will pick the repo's actual default when ref is null. Only set ref when the user said something like "from branch X" or "at tag vN" or "at commit abc123".
- fromVersion/toVersion: prefer "18.0.0" / "19.0.0" semver shape over bare "18" / "19" (Renatus's regex normalizes both, but full semver is safer).
- ecosystem: default "npm" if the repo is JavaScript/TypeScript and the user didn't say.
- ruleKind: default "pack". If the user said "use this changelog: ..." or pasted release-notes text, set "changelog". If they pasted a URL like an upgrade-guide link, set "guide-url".
- Always emit ALL fields; use null for fields that don't apply to the chosen agentKind.

If the input is ambiguous or doesn't mention a repo, emit { "agentKind": "qa", "repoUrl": "", ...nulls... } and the caller will surface the error.`;

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const parsedBody = RequestSchema.safeParse(body);
  if (!parsedBody.success) {
    return NextResponse.json(
      { error: 'prompt must be a string (3–2000 chars)' },
      { status: 400 },
    );
  }

  const router = new LlmRouter();
  let llmResponse: { content: string; provider: string; latencyMs: number };
  try {
    llmResponse = await router.reason({
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: parsedBody.data.prompt }],
      responseFormat: 'json',
      temperature: 0.0,
      maxTokens: 1024,
      metadata: { source: 'parse-intent' },
    });
  } catch (err) {
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? `LLM call failed: ${err.message}`
            : 'LLM call failed',
      },
      { status: 502 },
    );
  }

  // Strip code fences the LLM sometimes adds despite system prompt.
  const stripped = llmResponse.content
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  let parsed: unknown;
  try {
    parsed = JSON.parse(stripped);
  } catch (err) {
    return NextResponse.json(
      {
        error: `LLM returned non-JSON: ${err instanceof Error ? err.message : String(err)}`,
        raw: stripped.slice(0, 500),
      },
      { status: 502 },
    );
  }

  const validated = ParsedIntentSchema.safeParse(parsed);
  if (!validated.success) {
    return NextResponse.json(
      {
        error: 'LLM output did not match expected schema',
        issues: validated.error.issues,
        raw: parsed,
      },
      { status: 502 },
    );
  }

  if (!validated.data.repoUrl) {
    return NextResponse.json(
      {
        error:
          'Could not figure out which repo you want. Try: "Migrate https://github.com/owner/repo from React 18 to 19".',
      },
      { status: 422 },
    );
  }

  return NextResponse.json({
    intent: validated.data,
    llmProvider: llmResponse.provider,
    llmLatencyMs: llmResponse.latencyMs,
  });
}
