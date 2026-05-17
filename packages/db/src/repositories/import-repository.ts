import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { eq } from "drizzle-orm";
import { imports, type ImportRow, type NewImport } from "../schema/imports.js";

export interface ImportEdgeInput {
  fromFileId: string;
  toFileId: string;
  importedSymbols: string[];
  isTypeOnly: boolean;
}

/**
 * Persistence for the `imports` edge table.
 *
 * Reads are typically performed via KnowledgeGraphRepository (recursive CTE);
 * this repo handles single-snapshot bulk writes and flat reads.
 */
export class ImportRepository {
  private db;

  constructor(databaseUrl: string) {
    const sql = neon(databaseUrl);
    this.db = drizzle(sql);
  }

  async bulkInsert(
    snapshotId: string,
    edges: ImportEdgeInput[],
  ): Promise<ImportRow[]> {
    if (edges.length === 0) {
      return [];
    }

    const rows: NewImport[] = edges.map((e) => ({
      snapshotId,
      fromFileId: e.fromFileId,
      toFileId: e.toFileId,
      importedSymbols: e.importedSymbols,
      isTypeOnly: e.isTypeOnly,
    }));

    return await this.db.insert(imports).values(rows).returning();
  }

  async getBySnapshot(snapshotId: string): Promise<ImportRow[]> {
    return await this.db
      .select()
      .from(imports)
      .where(eq(imports.snapshotId, snapshotId));
  }
}

// Made with Bob
