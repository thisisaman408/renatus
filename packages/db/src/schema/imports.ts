import {
  pgTable,
  uuid,
  boolean,
  jsonb,
  index,
} from "drizzle-orm/pg-core";
import { repoSnapshots } from "./repo-snapshots";
import { files } from "./files";

/**
 * imports — directed edges in the import graph.
 *
 * `importedSymbols` is a JSONB array of names; empty array = side-effect import.
 * Index on (to_file_id, from_file_id) is required for the recursive CTE in
 * KnowledgeGraphRepository.findFilesTransitivelyImporting (see SYSTEM-DESIGN
 * §9.2).
 */
export const imports = pgTable(
  "imports",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    snapshotId: uuid("snapshot_id")
      .notNull()
      .references(() => repoSnapshots.id, { onDelete: "cascade" }),
    fromFileId: uuid("from_file_id")
      .notNull()
      .references(() => files.id, { onDelete: "cascade" }),
    toFileId: uuid("to_file_id")
      .notNull()
      .references(() => files.id, { onDelete: "cascade" }),
    importedSymbols: jsonb("imported_symbols")
      .$type<string[]>()
      .notNull()
      .default([]),
    isTypeOnly: boolean("is_type_only").notNull().default(false),
  },
  (t) => ({
    toFromIdx: index("imports_to_from_idx").on(t.toFileId, t.fromFileId),
  }),
);

export type ImportRow = typeof imports.$inferSelect;
export type NewImport = typeof imports.$inferInsert;

// Made with Bob
