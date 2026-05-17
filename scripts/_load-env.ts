/**
 * Tiny dependency-free `.env` loader for the e2e verifier scripts.
 *
 * Resolves `.env` relative to this file (repo-root regardless of CWD), reads
 * `KEY=VALUE` lines, and populates `process.env`. **Renatus-scoped vars
 * ALWAYS override** any pre-existing process.env value (so a stale
 * `DATABASE_URL` from a parent shell's rc can't leak into the run). Other
 * vars use the standard "shell wins" semantics.
 *
 * Silently no-ops when `.env` is missing so the SKIPPED-on-no-keys path in
 * the verifier scripts still works on a fresh checkout.
 *
 * Imported as the very first import in the e2e scripts so it runs during
 * module evaluation, before any agent code reads `process.env.*`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Keys that should ALWAYS use the .env value, even if the parent shell has
// already exported them. Prevents cross-project leakage (e.g., a DATABASE_URL
// from a different project's shell rc shadowing Renatus's Neon URL).
const RENATUS_OVERRIDE_KEYS = new Set([
  "DATABASE_URL",
  "GROQ_API_KEY",
  "GEMINI_API_KEY",
  "WATSONX_API_KEY",
  "WATSONX_PROJECT_ID",
  "WATSONX_REGION",
  "VERCEL_AI_GATEWAY_URL",
  "VERCEL_AI_GATEWAY_API_KEY",
  "MCP_ENABLE_ELICITATION",
  "BOB_TASK_ID",
  "INNGEST_EVENT_KEY",
  "INNGEST_SIGNING_KEY",
  "RENATUS_KEK",
]);

const here = path.dirname(fileURLToPath(import.meta.url));
const envPath = path.resolve(here, "..", ".env");

try {
  const text = readFileSync(envPath, "utf-8");
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (line === "" || line.startsWith("#")) continue;
    const match = line.match(
      /^([A-Z_][A-Z0-9_]*)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)'|(.*?))\s*(?:#.*)?$/i,
    );
    if (!match) continue;
    const key = match[1] ?? "";
    if (key === "") continue;
    // For non-Renatus keys, preserve shell-wins. For Renatus keys, .env wins.
    if (
      !RENATUS_OVERRIDE_KEYS.has(key) &&
      process.env[key] !== undefined &&
      process.env[key] !== ""
    ) {
      continue;
    }
    let value: string;
    if (match[2] !== undefined) {
      // Double-quoted — unescape \n, \", \\
      value = match[2].replace(/\\(["\\nrt])/g, (_, c) => {
        if (c === "n") return "\n";
        if (c === "r") return "\r";
        if (c === "t") return "\t";
        return c;
      });
    } else if (match[3] !== undefined) {
      // Single-quoted — literal
      value = match[3];
    } else {
      value = match[4] ?? "";
    }
    process.env[key] = value;
  }
} catch (err) {
  // Silently swallow — the verifier's SKIPPED branch handles the no-keys case.
  // Only log on unexpected errors (not ENOENT).
  if (
    err instanceof Error &&
    "code" in err &&
    (err as NodeJS.ErrnoException).code !== "ENOENT"
  ) {
    console.warn(`[load-env] failed to read ${envPath}:`, err.message);
  }
}
