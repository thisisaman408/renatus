import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { eq } from "drizzle-orm";
import {
  symbols,
  type SymbolRow,
  type NewSymbol,
} from "../schema/symbols.js";
import type { SymbolKind } from "@renatus/shared";

export interface SymbolInput {
  fileId: string;
  name: string;
  kind: SymbolKind;
  isExported: boolean;
  line: number;
}

/**
 * Persistence for the `symbols` table.
 */
export class SymbolRepository {
  private db;

  constructor(databaseUrl: string) {
    const sql = neon(databaseUrl);
    this.db = drizzle(sql);
  }

  async bulkInsert(symbolInputs: SymbolInput[]): Promise<SymbolRow[]> {
    if (symbolInputs.length === 0) {
      return [];
    }

    const rows: NewSymbol[] = symbolInputs.map((s) => ({
      fileId: s.fileId,
      name: s.name,
      kind: s.kind,
      isExported: s.isExported,
      line: s.line,
    }));

    return await this.db.insert(symbols).values(rows).returning();
  }

  async getByFile(fileId: string): Promise<SymbolRow[]> {
    return await this.db
      .select()
      .from(symbols)
      .where(eq(symbols.fileId, fileId));
  }
}

// Made with Bob
