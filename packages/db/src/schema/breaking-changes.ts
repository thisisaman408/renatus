import {
  pgTable,
  uuid,
  text,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { breakingChangeMaps } from "./breaking-change-maps";
import type { Rule, RuleSeverity } from "@renatus/shared";

/**
 * breaking_changes — individual polymorphic rules attached to a
 * breaking_change_maps row.
 *
 * `payload` carries the full Zod-validated Rule object so the consumer can
 * round-trip through Zod without column drift; flat columns (kind/severity/
 * category/title/rationale) are denormalized for fast scans.
 */
export const breakingChanges = pgTable(
  "breaking_changes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    mapId: uuid("map_id")
      .notNull()
      .references(() => breakingChangeMaps.id, { onDelete: "cascade" }),
    ruleId: text("rule_id").notNull(),
    kind: text("kind", { enum: ["migration", "refactor", "mitigation"] })
      .notNull(),
    severity: text("severity").$type<RuleSeverity>().notNull(),
    category: text("category").notNull(),
    title: text("title").notNull(),
    rationale: text("rationale").notNull(),
    payload: jsonb("payload").$type<Rule>().notNull(),
  },
  (t) => ({
    mapIdx: index("breaking_changes_map_idx").on(t.mapId),
  }),
);

export type BreakingChangeRow = typeof breakingChanges.$inferSelect;
export type NewBreakingChange = typeof breakingChanges.$inferInsert;

// Made with Bob
