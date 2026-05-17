import { pgTable, uuid, text, jsonb, timestamp } from "drizzle-orm/pg-core";
import { jobs } from "./jobs";

/**
 * Migration plans table - stores the cartographer's output
 * 
 * Each plan contains a list of migration rules that apply to a specific
 * version-to-version migration for a given ecosystem.
 */
export const migrationPlans = pgTable("migration_plans", {
  id: uuid("id").primaryKey(),
  jobId: uuid("job_id")
    .notNull()
    .references(() => jobs.id, { onDelete: "cascade" }),
  ecosystem: text("ecosystem").notNull(),
  fromVersion: text("from_version").notNull(),
  toVersion: text("to_version").notNull(),
  // Store the full array of MigrationRule objects as JSONB
  rules: jsonb("rules").notNull().$type<Array<{
    id: string;
    severity: string;
    category: string;
    title: string;
    rationale: string;
    fromVersion: string;
    toVersion: string;
    ecosystem: string;
    detect: {
      kind: string;
      expr: string;
    };
    fix?: {
      kind: string;
      expr?: string;
      instructions?: string;
    };
  }>>(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type MigrationPlanRow = typeof migrationPlans.$inferSelect;
export type NewMigrationPlan = typeof migrationPlans.$inferInsert;

// Made with Bob
