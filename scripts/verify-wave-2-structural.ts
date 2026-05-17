#!/usr/bin/env tsx
/**
 * Wave 2 structural verifier — runs without DATABASE_URL or any LLM key.
 *
 * Exits 0 if every check passes; exits with the number of failures otherwise.
 *
 * Checks (in order):
 *   1. Fixture file presence + ts-morph parseability.
 *   2. All 5 React 18→19 rule detectors match the fixture content.
 *   3. Cartographer.planFromPack returns exactly 5 rules for npm 18→19
 *      (uses a no-op cache stub so DB access is not required).
 *   4. MCP server entry registers exactly the expected 12 tools (grep-based).
 *   5. dist/ build artifacts exist for @renatus/agents and @renatus/mcp-server.
 *
 * Run via `pnpm verify:wave-2`.
 */
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Project, ScriptKind } from "ts-morph";

import {
  Cartographer,
  type PlanResult,
} from "@renatus/agents";
import type { BreakingChangeMapRepository } from "@renatus/db";
import { LlmRouter } from "@renatus/llm";
import type { MigrationRule, Rule } from "@renatus/shared";

// ────────────────────────────────────────────────────────────────────────────
// Layout
// ────────────────────────────────────────────────────────────────────────────

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const FIXTURE_ROOT = path.join(REPO_ROOT, "test-repos", "fixture-react-18");
const TAILWIND_FIXTURE_ROOT = path.join(
  REPO_ROOT,
  "test-repos",
  "fixture-tailwind-3",
);

const FIXTURE_FILES: ReadonlyArray<{ relPath: string; kind: ScriptKind | null }> = [
  { relPath: "package.json", kind: null },
  { relPath: "tsconfig.json", kind: null },
  { relPath: "src/index.tsx", kind: ScriptKind.TSX },
  { relPath: "src/App.tsx", kind: ScriptKind.TSX },
  { relPath: "src/components/Button.tsx", kind: ScriptKind.TSX },
  { relPath: "src/components/Input.tsx", kind: ScriptKind.TSX },
  { relPath: "src/hooks/useFocus.ts", kind: ScriptKind.TS },
  { relPath: "src/types.ts", kind: ScriptKind.TS },
];

const TAILWIND_FIXTURE_FILES: ReadonlyArray<{ relPath: string }> = [
  { relPath: "package.json" },
  { relPath: "src/styles.css" },
  { relPath: "src/components/Card.tsx" },
  { relPath: "src/components/Modal.tsx" },
];

const EXPECTED_TAILWIND_RULE_IDS = [
  "tailwind-v4-css-import",
  "tailwind-v4-opacity-utilities",
  "tailwind-v4-shadow-rename",
  "tailwind-v4-default-border-color",
  "tailwind-v4-transform-filter-implicit",
];

const EXPECTED_MCP_TOOLS = [
  "ping",
  "llm_test",
  "cartograph_repository",
  "clone_repository",
  "index_repository",
  "plan_change",
  "find_affected_files",
  "propose_patch",
  "apply_patch",
  "migrate_repository",
  "refactor_repository",
  "examine",
  "security_audit_repository",
  "query_codebase",
];

// ────────────────────────────────────────────────────────────────────────────
// Tiny report harness — collects {description, ok, detail} rows and renders
// a single block at the end. Each check appends one row.
// ────────────────────────────────────────────────────────────────────────────

interface CheckResult {
  description: string;
  ok: boolean;
  detail?: string;
}

const results: CheckResult[] = [];

function record(description: string, ok: boolean, detail?: string): void {
  results.push({ description, ok, detail });
}

async function safe<T>(description: string, fn: () => Promise<T> | T): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    record(description, false, message);
    return undefined;
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Check 1 — fixture presence + ts-morph parseability
// ────────────────────────────────────────────────────────────────────────────

async function checkFixture(): Promise<Map<string, string>> {
  const contentsByRelPath = new Map<string, string>();

  for (const entry of FIXTURE_FILES) {
    const abs = path.join(FIXTURE_ROOT, entry.relPath);
    try {
      const stats = await stat(abs);
      if (!stats.isFile()) {
        record(`fixture file ${entry.relPath}`, false, "not a regular file");
        continue;
      }
      const text = await readFile(abs, "utf-8");
      contentsByRelPath.set(entry.relPath, text);
      record(`fixture file present: ${entry.relPath}`, true);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      record(`fixture file present: ${entry.relPath}`, false, message);
    }
  }

  // ts-morph parse — same compiler options the Indexer uses (in-memory FS).
  const project = new Project({
    useInMemoryFileSystem: true,
    compilerOptions: {
      allowJs: true,
      jsx: 4, // ts.JsxEmit.ReactJSX
      target: 7, // ts.ScriptTarget.ES2020
      module: 99, // ts.ModuleKind.ESNext
      moduleResolution: 100, // ts.ModuleResolutionKind.Bundler
      strict: false, // we only need a parse, not type-check
      noEmit: true,
    },
  });

  for (const entry of FIXTURE_FILES) {
    if (entry.kind === null) continue; // skip JSON
    const text = contentsByRelPath.get(entry.relPath);
    if (text === undefined) continue;
    try {
      const sf = project.createSourceFile(entry.relPath, text, {
        scriptKind: entry.kind,
        overwrite: true,
      });
      // Trigger AST realization. Any unparseable text throws here.
      sf.forEachDescendant(() => {});
      record(`fixture parses (ts-morph): ${entry.relPath}`, true);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      record(`fixture parses (ts-morph): ${entry.relPath}`, false, message);
    }
  }

  return contentsByRelPath;
}

// ────────────────────────────────────────────────────────────────────────────
// Check 2 — every Rule's detector regex matches the fixture
// ────────────────────────────────────────────────────────────────────────────

function checkRuleDetectors(
  contentsByRelPath: Map<string, string>,
  rules: Rule[],
): void {
  if (rules.length === 0) {
    record("rule detector check has rules to evaluate", false, "no rules supplied");
    return;
  }

  // Skip JSON / config files — detectors target source modules.
  const sourceFiles = [...contentsByRelPath.entries()].filter(([rel]) =>
    /\.(ts|tsx|js|jsx)$/i.test(rel),
  );

  // Restrict to migration rules (the only kind shipped in Wave 2).
  const migrationRules = rules.filter(
    (r): r is MigrationRule => r.kind === "migration",
  );

  for (const rule of migrationRules) {
    if (rule.detect.kind !== "pattern") {
      record(`rule ${rule.id} has pattern detector`, false, `kind=${rule.detect.kind}`);
      continue;
    }

    try {
      new RegExp(rule.detect.expr, "gm");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      record(`rule ${rule.id} regex compiles`, false, message);
      continue;
    }
    record(`rule ${rule.id} regex compiles`, true);

    const matchedIn: string[] = [];
    for (const [relPath, text] of sourceFiles) {
      // Fresh RegExp per file — /g preserves lastIndex across .test() calls.
      if (new RegExp(rule.detect.expr, "m").test(text)) {
        matchedIn.push(relPath);
      }
    }

    const ok = matchedIn.length >= 1;
    const detail = ok
      ? `matched in: ${matchedIn.join(", ")}`
      : `no fixture file matched /${rule.detect.expr}/m`;
    record(`rule ${rule.id} matches fixture`, ok, detail);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Check 3 — Cartographer.planFromPack returns exactly 5 rules without DB
// ────────────────────────────────────────────────────────────────────────────

const EXPECTED_RULE_IDS = [
  "react-19-useref-initial-arg",
  "react-19-defaultprops-removal",
  "react-19-string-refs-removal",
  "react-19-reactdom-render-removal",
  "react-19-proptypes-removal",
];

async function checkCartographerPack(): Promise<Rule[]> {
  const noopCache = {
    async findByCacheKey() {
      return null;
    },
    async save() {
      return {
        id: "noop",
        cacheKey: "",
        agentKind: "migrate" as const,
        sourceKind: "pack" as const,
        ecosystem: null,
        fromVersion: null,
        toVersion: null,
        ruleCount: 0,
        createdAt: new Date(),
      };
    },
  } as unknown as BreakingChangeMapRepository;

  // LlmRouter constructor never throws — it just registers zero adapters when
  // no env keys are present. planFromPack does not call the LLM, so this is
  // safe even with zero providers configured.
  const router = new LlmRouter();
  const cartographer = new Cartographer(router, noopCache);

  let result: PlanResult | undefined;
  try {
    result = await cartographer.planFromPack({
      agentKind: "migrate",
      ecosystem: "npm",
      fromVersion: "18.0.0",
      toVersion: "19.0.0",
      jobId: "00000000-0000-0000-0000-000000000000",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    record("Cartographer.planFromPack returns rules", false, message);
    return [];
  }

  if (!result) {
    record("Cartographer.planFromPack returns rules", false, "undefined result");
    return [];
  }

  record(
    "Cartographer.planFromPack returns exactly 5 rules",
    result.rules.length === 5,
    `rules=${result.rules.length}, sourceKind=${result.sourceKind}, cached=${result.cached}`,
  );

  const expectedIds = new Set(EXPECTED_RULE_IDS);
  const actualIds = new Set(result.rules.map((r) => r.id));
  const missing = [...expectedIds].filter((id) => !actualIds.has(id));
  record(
    "planFromPack rule ids match React 18→19 pack",
    missing.length === 0,
    missing.length === 0
      ? `ids=${[...actualIds].sort().join(",")}`
      : `missing: ${missing.join(", ")}`,
  );

  return result.rules;
}

// ────────────────────────────────────────────────────────────────────────────
// Check 4 — MCP server entry registers exactly the 12 expected tools
// ────────────────────────────────────────────────────────────────────────────

async function checkMcpRegistry(): Promise<void> {
  const mcpIndexPath = path.join(
    REPO_ROOT,
    "packages",
    "mcp-server",
    "src",
    "index.ts",
  );
  let text: string;
  try {
    text = await readFile(mcpIndexPath, "utf-8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    record("MCP server entry readable", false, message);
    return;
  }
  record("MCP server entry readable", true);

  // Grep for `name: 'toolName',` inside the ListToolsRequestSchema handler.
  // The MCP SDK requires every tool to declare a top-level `name` key, so a
  // simple regex over the source file is robust.
  const nameRe = /name:\s*['"]([a-zA-Z_]+)['"]/g;
  const found = new Set<string>();
  for (const match of text.matchAll(nameRe)) {
    if (match[1]) found.add(match[1]);
  }

  for (const expected of EXPECTED_MCP_TOOLS) {
    record(`MCP tool registered: ${expected}`, found.has(expected));
  }

  // The grep is permissive — there may be extra `name:` literals in unrelated
  // contexts (e.g. server metadata). We only require that the 12 expected
  // tools are present, not that NO others appear.
}

// ────────────────────────────────────────────────────────────────────────────
// Check 4b — Tailwind 3→4 pack: fixture presence, pack resolution, detectors
// ────────────────────────────────────────────────────────────────────────────

async function checkTailwindFixture(): Promise<Map<string, string>> {
  const contentsByRelPath = new Map<string, string>();
  for (const entry of TAILWIND_FIXTURE_FILES) {
    const abs = path.join(TAILWIND_FIXTURE_ROOT, entry.relPath);
    try {
      const stats = await stat(abs);
      if (!stats.isFile()) {
        record(
          `tailwind fixture file ${entry.relPath}`,
          false,
          "not a regular file",
        );
        continue;
      }
      const text = await readFile(abs, "utf-8");
      contentsByRelPath.set(entry.relPath, text);
      record(`tailwind fixture file present: ${entry.relPath}`, true);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      record(
        `tailwind fixture file present: ${entry.relPath}`,
        false,
        message,
      );
    }
  }
  return contentsByRelPath;
}

async function checkCartographerTailwindPack(): Promise<Rule[]> {
  const noopCache = {
    async findByCacheKey() {
      return null;
    },
    async save() {
      return {
        id: "noop",
        cacheKey: "",
        agentKind: "migrate" as const,
        sourceKind: "pack" as const,
        ecosystem: null,
        fromVersion: null,
        toVersion: null,
        ruleCount: 0,
        createdAt: new Date(),
      };
    },
  } as unknown as BreakingChangeMapRepository;

  const router = new LlmRouter();
  const cartographer = new Cartographer(router, noopCache);

  let result: PlanResult | undefined;
  try {
    result = await cartographer.planFromPack({
      agentKind: "migrate",
      ecosystem: "npm",
      fromVersion: "3.0.0",
      toVersion: "4.0.0",
      jobId: "00000000-0000-0000-0000-000000000001",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    record(
      "Cartographer.planFromPack returns Tailwind 3→4 rules",
      false,
      message,
    );
    return [];
  }

  if (!result) {
    record(
      "Cartographer.planFromPack returns Tailwind 3→4 rules",
      false,
      "undefined result",
    );
    return [];
  }

  record(
    "Cartographer.planFromPack returns exactly 5 Tailwind rules",
    result.rules.length === 5,
    `rules=${result.rules.length}, sourceKind=${result.sourceKind}, cached=${result.cached}`,
  );

  const expectedIds = new Set(EXPECTED_TAILWIND_RULE_IDS);
  const actualIds = new Set(result.rules.map((r) => r.id));
  const missing = [...expectedIds].filter((id) => !actualIds.has(id));
  record(
    "planFromPack rule ids match Tailwind 3→4 pack",
    missing.length === 0,
    missing.length === 0
      ? `ids=${[...actualIds].sort().join(",")}`
      : `missing: ${missing.join(", ")}`,
  );

  return result.rules;
}

function checkTailwindDetectors(
  contentsByRelPath: Map<string, string>,
  rules: Rule[],
): void {
  if (rules.length === 0) {
    record(
      "tailwind rule detector check has rules to evaluate",
      false,
      "no rules supplied",
    );
    return;
  }

  const sourceFiles = [...contentsByRelPath.entries()];

  const migrationRules = rules.filter(
    (r): r is MigrationRule => r.kind === "migration",
  );

  for (const rule of migrationRules) {
    if (rule.detect.kind !== "pattern") {
      record(
        `tailwind rule ${rule.id} has pattern detector`,
        false,
        `kind=${rule.detect.kind}`,
      );
      continue;
    }

    try {
      new RegExp(rule.detect.expr, "gm");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      record(`tailwind rule ${rule.id} regex compiles`, false, message);
      continue;
    }
    record(`tailwind rule ${rule.id} regex compiles`, true);

    const matchedIn: string[] = [];
    for (const [relPath, text] of sourceFiles) {
      if (new RegExp(rule.detect.expr, "m").test(text)) {
        matchedIn.push(relPath);
      }
    }

    const ok = matchedIn.length >= 1;
    const detail = ok
      ? `matched in: ${matchedIn.join(", ")}`
      : `no tailwind fixture file matched /${rule.detect.expr}/m`;
    record(`tailwind rule ${rule.id} matches fixture`, ok, detail);
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Check 5 — build artifacts present
// ────────────────────────────────────────────────────────────────────────────

async function checkBuildArtifacts(): Promise<void> {
  const required = [
    "packages/agents/dist/index.js",
    "packages/mcp-server/dist/index.js",
  ];
  let missing = 0;
  for (const rel of required) {
    const abs = path.join(REPO_ROOT, rel);
    try {
      const stats = await stat(abs);
      const ok = stats.isFile();
      record(`build artifact: ${rel}`, ok);
      if (!ok) missing += 1;
    } catch {
      record(`build artifact: ${rel}`, false, "missing");
      missing += 1;
    }
  }
  if (missing > 0) {
    console.error(
      "\n[hint] Build artifacts missing. Run `pnpm -r build` from the repo root.",
    );
  }
}

// ────────────────────────────────────────────────────────────────────────────
// Main
// ────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  console.log("Renatus Wave 2 — structural verification");
  console.log(`Repo root: ${REPO_ROOT}\n`);

  const contents = (await safe("check fixture", () => checkFixture())) ?? new Map();
  const rules = (await safe("check Cartographer.planFromPack", () => checkCartographerPack())) ?? [];
  await safe("check rule detectors", () => checkRuleDetectors(contents as Map<string, string>, rules));

  // Tailwind 3→4 pack section.
  const tailwindContents =
    (await safe("check tailwind fixture", () => checkTailwindFixture())) ?? new Map();
  const tailwindRules =
    (await safe("check Cartographer.planFromPack (tailwind)", () =>
      checkCartographerTailwindPack(),
    )) ?? [];
  await safe("check tailwind rule detectors", () =>
    checkTailwindDetectors(
      tailwindContents as Map<string, string>,
      tailwindRules,
    ),
  );

  await safe("check MCP registry", () => checkMcpRegistry());
  await safe("check build artifacts", () => checkBuildArtifacts());

  // Render report.
  console.log("Check results:");
  for (const row of results) {
    const mark = row.ok ? "[PASS]" : "[FAIL]";
    const tail = row.detail ? ` — ${row.detail}` : "";
    console.log(`  ${mark} ${row.description}${tail}`);
  }

  const passed = results.filter((r) => r.ok).length;
  const failed = results.length - passed;
  console.log(`\nPASS ${passed} / FAIL ${failed}`);
  process.exit(failed);
}

main().catch((err) => {
  console.error("Verifier crashed unexpectedly:", err);
  process.exit(1);
});
