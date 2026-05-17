import { z } from "zod";

/**
 * AgentKind — the four orchestrated agent variants.
 *
 * - `migrate`: dependency version migration (default Wave-2 path)
 * - `refactor`: non-version-tied source-code refactor
 * - `security_audit`: vulnerability mitigation
 * - `qa`: quality / test-coverage hardening
 */
export const AgentKindSchema = z.enum([
  "migrate",
  "refactor",
  "security_audit",
  "qa",
]);
export type AgentKind = z.infer<typeof AgentKindSchema>;

// Made with Bob
