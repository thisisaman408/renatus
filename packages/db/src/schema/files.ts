import {
  pgTable,
  uuid,
  text,
  integer,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { repoSnapshots } from "./repo-snapshots";
import type { FileLanguage } from "@renatus/shared";

/**
 * files — one row per discovered file inside a snapshot.
 *
 * Unique on (snapshot_id, path) so the same path can recur across snapshots.
 * Index on `sha` powers future codemod-cache lookups by file-content hash.
 */
export const files = pgTable(
  "files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => repoSnapshots.id, { onDelete: "cascade" }),
    path: text("path").notNull(),
    language: text("language").$type<FileLanguage>().notNull(),
    sha: text("sha").notNull(),
    sizeBytes: integer("size_bytes").notNull(),
  },
  (t) => ({
    snapshotPathUnique: uniqueIndex("files_snapshot_path_unique").on(
      t.snapshotId,
      t.path,
    ),
    shaIdx: index("files_sha_idx").on(t.sha),
  }),
);

export type FileRow = typeof files.$inferSelect;
export type NewFile = typeof files.$inferInsert;

// Made with Bob
