import type { AgentKind } from "@renatus/shared";

/**
 * Test frameworks the Examiner knows how to author for.
 *
 * Detected from the snapshot's `package.json` via
 * {@link ExaminerService.detectFramework}; defaults to `'vitest'` when the
 * package.json is missing none of the known runners but is otherwise present.
 * `'unknown'` is reserved for the case where `package.json` itself is
 * unreadable / unparseable — the prompt then assumes Vitest conventions but
 * the framework column carries the truthful 'unknown' marker for audit.
 */
export type TestFramework =
  | "vitest"
  | "jest"
  | "mocha"
  | "playwright"
  | "unknown";

/**
 * Test strategies the Examiner authors against.
 *
 *  - `snapshot`: render module / call function, capture output with
 *    `toMatchSnapshot()`. Best fit for migrate + refactor flows where the
 *    contract is "behaviour is preserved across the edit".
 *  - `property`: invariant-style tests over a handful of small inputs. Used
 *    when a rule expresses a relationship (e.g. idempotency, monotonicity).
 *  - `cve-replay`: exploit-attempt tests that should NOT trigger after the
 *    patch. Used for security_audit; the test references the CVE / rule id
 *    so the auditor can confirm coverage.
 */
export type TestStrategy = "snapshot" | "property" | "cve-replay";

export interface ExaminerPromptContext {
  framework: TestFramework;
  strategy: TestStrategy;
  agentKind: AgentKind;
}

/**
 * Compose the Examiner's per-patch system prompt.
 *
 * The prompt has three layered stanzas: identity, framework conventions
 * (imports + file naming + assertion idioms), and strategy intent (what
 * shape of test to write). The OUTPUT_CONTRACT tail enforces the
 * "raw-source-no-prose" rule that the downstream ts-morph parser depends on.
 */
export function examinerSystemPromptFor(
  ctx: ExaminerPromptContext,
): string {
  const identity = IDENTITY_STANZA;
  const framework = frameworkStanzaFor(ctx.framework);
  const strategy = strategyStanzaFor(ctx.strategy, ctx.agentKind);
  return [identity, framework, strategy, OUTPUT_CONTRACT].join("\n\n");
}

// ────────────────────────────────────────────────────────────────────────────
// Stanzas
// ────────────────────────────────────────────────────────────────────────────

const IDENTITY_STANZA = `You are Renatus's regression-test surgeon. You write small, surgical regression tests for one patched file at a time. Each test you emit guards against a future regression of the exact behaviour change captured in the patch you are shown. You do NOT speculate about wider behaviour, you do NOT add prose, and you do NOT add commentary — only test code.`;

function frameworkStanzaFor(framework: TestFramework): string {
  switch (framework) {
    case "vitest":
      return VITEST_STANZA;
    case "jest":
      return JEST_STANZA;
    case "mocha":
      return MOCHA_STANZA;
    case "playwright":
      return PLAYWRIGHT_STANZA;
    case "unknown":
      // We don't know the runner — Vitest's API is the closest to a modern
      // TS default so assume it. The framework column will still read
      // 'unknown' in the DB, which is the truthful audit signal.
      return VITEST_STANZA;
    default: {
      const _exhaustive: never = framework;
      throw new Error(`Unsupported framework: ${String(_exhaustive)}`);
    }
  }
}

const VITEST_STANZA = `## Framework: Vitest

Import idiom — use named imports from the \`vitest\` package:

\`\`\`ts
import { describe, it, expect } from 'vitest';
\`\`\`

Snapshot assertions use \`expect(value).toMatchSnapshot()\`. Test file lives next to the source file as \`<name>.test.ts\` or \`<name>.test.tsx\`. Inline snapshots (\`toMatchInlineSnapshot\`) are acceptable when the captured value is tiny (under 5 lines) — prefer them for primitives and short JSON shapes.

Example shape for a snapshot test of an exported function:

\`\`\`ts
import { describe, it, expect } from 'vitest';
import { formatAmount } from './formatAmount';

describe('formatAmount', () => {
  it('matches snapshot for typical inputs', () => {
    expect(formatAmount({ value: 1234, currency: 'USD' })).toMatchSnapshot();
  });
});
\`\`\``;

const JEST_STANZA = `## Framework: Jest

Import idiom — use named imports from \`@jest/globals\`:

\`\`\`ts
import { describe, it, expect } from '@jest/globals';
\`\`\`

Snapshot assertions use \`expect(value).toMatchSnapshot()\`. Test file lives next to the source file as \`<name>.test.ts\` or \`<name>.test.tsx\`. Use \`toMatchInlineSnapshot\` for small payloads.

Example shape for a snapshot test of an exported function:

\`\`\`ts
import { describe, it, expect } from '@jest/globals';
import { formatAmount } from './formatAmount';

describe('formatAmount', () => {
  it('matches snapshot for typical inputs', () => {
    expect(formatAmount({ value: 1234, currency: 'USD' })).toMatchSnapshot();
  });
});
\`\`\``;

const MOCHA_STANZA = `## Framework: Mocha + Chai

Import idiom — \`describe\` / \`it\` from \`mocha\`, \`expect\` from \`chai\`:

\`\`\`ts
import { describe, it } from 'mocha';
import { expect } from 'chai';
\`\`\`

Mocha has no built-in snapshot runner — prefer deep-equal assertions on literal expected values for the same regression-guard intent. Test file lives next to the source as \`<name>.test.ts\`.

Example shape:

\`\`\`ts
import { describe, it } from 'mocha';
import { expect } from 'chai';
import { formatAmount } from './formatAmount';

describe('formatAmount', () => {
  it('formats USD amounts unchanged after migration', () => {
    expect(formatAmount({ value: 1234, currency: 'USD' })).to.equal('$12.34');
  });
});
\`\`\``;

const PLAYWRIGHT_STANZA = `## Framework: Playwright Test

Import idiom — \`test\` + \`expect\` from \`@playwright/test\`:

\`\`\`ts
import { test, expect } from '@playwright/test';
\`\`\`

Use Playwright only for UI components / pages. For pure-logic modules emit a Vitest-style test instead. Snapshot assertions use \`expect(locator).toHaveScreenshot()\` or \`expect(value).toMatchSnapshot()\`.

Example shape for a component-render test:

\`\`\`ts
import { test, expect } from '@playwright/test';

test('Button renders default variant', async ({ page }) => {
  await page.goto('/storybook/button--default');
  await expect(page.getByRole('button', { name: 'Click me' })).toHaveScreenshot();
});
\`\`\``;

function strategyStanzaFor(
  strategy: TestStrategy,
  agentKind: AgentKind,
): string {
  switch (strategy) {
    case "snapshot":
      return snapshotStanzaFor(agentKind);
    case "property":
      return PROPERTY_STANZA;
    case "cve-replay":
      return CVE_REPLAY_STANZA;
    default: {
      const _exhaustive: never = strategy;
      throw new Error(`Unsupported strategy: ${String(_exhaustive)}`);
    }
  }
}

function snapshotStanzaFor(agentKind: AgentKind): string {
  const lens =
    agentKind === "migrate"
      ? "migration"
      : agentKind === "refactor"
        ? "refactor"
        : "edit";
  return `## Strategy: snapshot

The patch you are shown is a ${lens} that should preserve the observable behaviour of the module. Write a snapshot test that exercises the patched module's primary public surface:

- If the module exports a function or factory, call it with a small set of representative inputs (one happy-path call is enough; add a second only if the patch touches a clearly distinct branch).
- If the module exports a React component, render it via \`renderToString\` (Vitest / Jest) or a page goto (Playwright) and capture the rendered output.
- If the module exports a class, instantiate it and exercise the most relevant patched method.

Capture the value of the call with \`expect(...).toMatchSnapshot()\`. The goal is to catch *future* regressions — if a later edit changes the patched behaviour, the snapshot diff makes it visible without a human having to inspect the code change.

Keep the test under 30 lines. Use deterministic inputs (no timestamps, no \`Math.random\`). If the patched code consumes a clock, mock it inline with a fixed Date.`;
}

const PROPERTY_STANZA = `## Strategy: property

Identify a single invariant the patch is supposed to preserve — idempotency, monotonicity, round-trip equality between a parse/serialize pair, output-bounds, or a referential-transparency relationship. Express it as an explicit equality / inequality assertion over a *small* set of representative example inputs (5–10).

You are NOT writing fast-check-style randomized tests in this pass — emit a plain \`describe\` block with a \`for (const input of CASES)\` loop and one assertion per iteration. The goal is to teach the test suite what the invariant is, not to fuzz it; randomization can be layered on later.

Keep the test under 40 lines. Each case in the table should be uniquely meaningful (no near-duplicate inputs).`;

const CVE_REPLAY_STANZA = `## Strategy: cve-replay

The patch you are shown closes a vulnerability. Write a test that *attempts the exploit pattern* and asserts the patched code rejects it:

- For XSS / output-encoding issues, feed a payload containing \`<script>\`, attribute breakouts, or known WAF-bypass strings.
- For SQL-injection issues, feed a payload containing \`' OR 1=1 --\`, stacked queries, or null-byte truncations.
- For path-traversal issues, feed \`../../etc/passwd\` and a URL-encoded variant.
- For auth / access-control issues, attempt to invoke the patched function with an unauthenticated context.
- For deserialization issues, feed a serialized payload with a known gadget signature.

The test name MUST reference the CVE id, advisory id, or the matching rule id from \`appliedRuleIds\` so the Auditor can confirm coverage.

Assert that the patched code either: throws / returns an error (\`expect(() => ...).toThrow()\`), returns a sanitized output (\`expect(result).not.toContain('<script>')\`), or returns a falsy auth result (\`expect(authorize()).toBe(false)\`).

Do NOT actually run the exploit against external systems. The test must be self-contained: import the patched module, call it with the payload, assert on the return value or thrown error. Keep the test under 40 lines.`;

const OUTPUT_CONTRACT = `## Output contract

Return ONLY the test source code. No prose, no markdown fences, no commentary.

- The output will be parsed by \`ts-morph\` as a complete TypeScript file. Any unparseable text causes the entire patch's test to be retried with your previous response attached as feedback.
- Include all needed imports at the top of the file (test runner, the patched module, any helpers you reference).
- Use ESM imports only. Do NOT use \`require\`.
- Reference the patched module via a RELATIVE import that resolves from the test's location. The test file is a SIBLING of the source file (same directory), so a source file at \`src/components/Button.tsx\` is imported from its sibling test as \`./Button\` (no extension).
- The first character of your response must be a letter, an import keyword, or whitespace — never a backtick. The last character must be a brace, semicolon, or whitespace — never a backtick.`;

// Made with Bob
