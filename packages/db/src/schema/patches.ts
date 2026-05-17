import {
  pgTable,
  uuid,
  text,
  jsonb,
  integer,
  real,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { jobs } from "./jobs";
import { repoSnapshots } from "./repo-snapshots";
import { files } from "./files";
import type { PatchStatus } from "@renatus/shared";

/**
 * patches — per-file patches proposed by the Surgeon.
 *
 * `before`/`after` carry full file contents so the Examiner can re-render
 * diffs deterministically. `confidence` is a Postgres real (single precision);
 * the [0, 1] range is enforced at the application layer via the Zod
 * ConfidenceSchema. `llmTranscriptId` is intentionally unconstrained — the
 * transcripts table arrives in Wave 3.
 */
export const patches = pgTable(
  "patches",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => repoSnapshots.id, { onDelete: "cascade" }),
    fileId: uuid("file_id")
      .notNull()
      .references(() => files.id, { onDelete: "cascade" }),
    filePath: text("file_path").notNull(),
    before: text("before").notNull(),
    after: text("after").notNull(),
    appliedRuleIds: jsonb("applied_rule_ids")
      .$type<string[]>()
      .notNull()
      .default([]),
    confidence: real("confidence").notNull(),
    status: text("status")
      .$type<PatchStatus>()
      .notNull()
      .default("proposed"),
    rationale: text("rationale"),
    retries: integer("retries").notNull().default(0),
    llmTranscriptId: uuid("llm_transcript_id"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    jobIdx: index("patches_job_idx").on(t.jobId),
    snapshotStatusIdx: index("patches_snapshot_status_idx").on(
      t.snapshotId,
      t.status,
    ),
  }),
);

export type PatchRow = typeof patches.$inferSelect;
export type NewPatch = typeof patches.$inferInsert;

// Made with Bob
