import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { sql } from "drizzle-orm";

/**
 * Knowledge-graph queries over the `imports` edge table.
 *
 * The hot read path is `findFilesTransitivelyImporting`, which uses the
 * recursive CTE specified in SYSTEM-DESIGN.md §9.2. The composite index
 * `(to_file_id, from_file_id)` on `imports` keeps each recursion step a
 * cheap index lookup.
 */
export class KnowledgeGraphRepository {
  private db;

  constructor(databaseUrl: string) {
    const neonSql = neon(databaseUrl);
    this.db = drizzle(neonSql);
  }

  /**
   * Returns the set of file ids that transitively import `toFileId`.
   *
   * Uses the recursive CTE from SYSTEM-DESIGN.md §9.2. Direct importers seed
   * the base case; each recursive step climbs one edge upstream. `UNION`
   * (not `UNION ALL`) guarantees termination on cycles.
   */
  async findFilesTransitivelyImporting(
    toFileId: string,
  ): Promise<string[]> {
    const result = await this.db.execute<{ from_file_id: string }>(sql`
      WITH RECURSIVE reachable AS (
        SELECT from_file_id FROM imports WHERE to_file_id = ${toFileId}
        UNION
        SELECT i.from_file_id FROM imports i
          JOIN reachable r ON i.to_file_id = r.from_file_id
      )
      SELECT DISTINCT from_file_id FROM reachable
    `);

    // neon-http returns rows as an array directly.
    const rows = Array.isArray(result)
      ? (result as Array<{ from_file_id: string }>)
      : ((result as { rows: Array<{ from_file_id: string }> }).rows ?? []);

    return rows.map((r) => r.from_file_id);
  }

  /**
   * Returns the set of file ids that import a given symbol from any source,
   * within a single snapshot. Uses the JSONB `?` operator for membership
   * (importedSymbols is a jsonb array of strings).
   */
  async findFilesImportingSymbol(
    snapshotId: string,
    symbolName: string,
  ): Promise<string[]> {
    const result = await this.db.execute<{ from_file_id: string }>(sql`
      SELECT DISTINCT from_file_id
      FROM imports
      WHERE snapshot_id = ${snapshotId}
        AND imported_symbols ? ${symbolName}
    `);

    const rows = Array.isArray(result)
      ? (result as Array<{ from_file_id: string }>)
      : ((result as { rows: Array<{ from_file_id: string }> }).rows ?? []);

    return rows.map((r) => r.from_file_id);
  }

  /**
   * Total edge count for a snapshot. Used by tests / health checks.
   */
  async getImportEdgeCount(snapshotId: string): Promise<number> {
    const result = await this.db.execute<{ count: string | number }>(sql`
      SELECT COUNT(*)::int AS count
      FROM imports
      WHERE snapshot_id = ${snapshotId}
    `);

    const rows = Array.isArray(result)
      ? (result as Array<{ count: string | number }>)
      : ((result as { rows: Array<{ count: string | number }> }).rows ?? []);

    const first = rows[0];
    if (!first) return 0;
    return typeof first.count === "number" ? first.count : Number(first.count);
  }
}

// Made with Bob
