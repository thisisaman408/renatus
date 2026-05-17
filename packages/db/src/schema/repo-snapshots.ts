import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
import { jobs } from "./jobs";

/**
 * repo_snapshots — a frozen clone of the target repo at a specific commit.
 *
 * Each snapshot owns its downstream artifacts (files, imports, symbols,
 * patches) via cascading FKs.
 */
export const repoSnapshots = pgTable("repo_snapshots", {
  id: uuid("id").primaryKey().defaultRandom(),
  jobId: uuid("job_id")
    .notNull()
    .references(() => jobs.id, { onDelete: "cascade" }),
  repoUrl: text("repo_url").notNull(),
  ref: text("ref").notNull(),
  commitSha: text("commit_sha").notNull(),
  localPath: text("local_path").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type SnapshotRow = typeof repoSnapshots.$inferSelect;
export type NewSnapshot = typeof repoSnapshots.$inferInsert;

// Made with Bob
