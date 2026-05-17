import {
  pgTable,
  uuid,
  text,
  boolean,
  integer,
} from "drizzle-orm/pg-core";
import { files } from "./files";
import type { SymbolKind } from "@renatus/shared";

/**
 * symbols — one row per top-level symbol surfaced by the indexer.
 *
 * Used by the Surgeon to scope edits and by the Cartographer to bind rules to
 * specific call sites.
 */
export const symbols = pgTable("symbols", {
  id: uuid("id").primaryKey().defaultRandom(),
  fileId: uuid("file_id")
    .notNull()
    .references(() => files.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  kind: text("kind").$type<SymbolKind>().notNull(),
  isExported: boolean("is_exported").notNull().default(false),
  line: integer("line").notNull(),
});

export type SymbolRow = typeof symbols.$inferSelect;
export type NewSymbol = typeof symbols.$inferInsert;

// Made with Bob
