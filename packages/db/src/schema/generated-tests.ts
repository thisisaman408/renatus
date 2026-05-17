import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { jobs } from "./jobs";
import { repoSnapshots } from "./repo-snapshots";
import { files } from "./files";
import { patches } from "./patches";

/**
 * generated_tests — tests synthesized by the Examiner for verifying patches
 * and CVE-replay / security-audit scenarios.
 *
 * `patchId` is nullable because some tests (notably CVE-replay and snapshot
 * security audits) are not bound to a specific patch — they cover the whole
 * migration. `passes` / `durationMs` are populated by the sandbox executor
 * after the test runs; both stay null until execution completes.
 *
 * `framework` and `strategy` are enforced as TS string-union literals at the
 * application layer; the column type is plain text so future variants don't
 * require a destructive migration.
 */
export type TestFramework =
  | "vitest"
  | "jest"
  | "mocha"
  | "playwright"
  | "unknown";

export type TestStrategy = "snapshot" | "property" | "cve-replay";

export const generatedTests = pgTable(
  "generated_tests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    patchId: uuid("patch_id").references(() => patches.id, {
      onDelete: "cascade",
    }),
    fileId: uuid("file_id")
      .notNull()
      .references(() => files.id, { onDelete: "cascade" }),
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => repoSnapshots.id, { onDelete: "cascade" }),
    framework: text("framework").$type<TestFramework>().notNull(),
    strategy: text("strategy").$type<TestStrategy>().notNull(),
    filePath: text("file_path").notNull(),
    testContents: text("test_contents").notNull(),
    passes: boolean("passes"),
    durationMs: integer("duration_ms"),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    jobIdx: index("generated_tests_job_idx").on(t.jobId),
    snapshotFrameworkIdx: index("generated_tests_snapshot_framework_idx").on(
      t.snapshotId,
      t.framework,
    ),
  }),
);

export type GeneratedTestRow = typeof generatedTests.$inferSelect;
export type NewGeneratedTest = typeof generatedTests.$inferInsert;

// Made with Bob
