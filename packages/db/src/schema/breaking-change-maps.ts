import {
  pgTable,
  uuid,
  text,
  integer,
  timestamp,
} from "drizzle-orm/pg-core";
import type { AgentKind } from "@renatus/shared";

/**
 * breaking_change_maps — cache of Cartographer outputs across all agent kinds.
 *
 * One row per (sourceText, sourceKind, agentKind) tuple. The `cacheKey` column
 * is the sha256 of those inputs and is enforced UNIQUE so the orchestrator can
 * idempotently de-dupe Cartographer runs. Child rules live in
 * breaking_changes (1:N).
 */
export const breakingChangeMaps = pgTable("breaking_change_maps", {
  id: uuid("id").primaryKey().defaultRandom(),
  cacheKey: text("cache_key").notNull().unique(),
  agentKind: text("agent_kind").$type<AgentKind>().notNull(),
  sourceKind: text("source_kind", {
    enum: [
      "pack",
      "changelog",
      "diff",
      "guide-url",
      "refactor-intent",
      "cve-advisory",
    ],
  }).notNull(),
  ecosystem: text("ecosystem"),
  fromVersion: text("from_version"),
  toVersion: text("to_version"),
  ruleCount: integer("rule_count").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type BreakingChangeMapRow = typeof breakingChangeMaps.$inferSelect;
export type NewBreakingChangeMap = typeof breakingChangeMaps.$inferInsert;

// Made with Bob
