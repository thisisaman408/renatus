import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { asc, eq, sql } from "drizzle-orm";
import {
  generatedTests,
  type GeneratedTestRow,
  type NewGeneratedTest,
} from "../schema/generated-tests.js";

/**
 * Persistence for the `generated_tests` table.
 *
 * Tests are produced by the Examiner. `passes` / `durationMs` are written
 * after sandbox execution via {@link TestRepository.updateResult}. Reads are
 * ordered by `createdAt` ascending so the audit report sees them in the order
 * they were generated.
 */
export class TestRepository {
  private db;

  constructor(databaseUrl: string) {
    const sql = neon(databaseUrl);
    this.db = drizzle(sql);
  }

  async bulkInsert(tests: NewGeneratedTest[]): Promise<GeneratedTestRow[]> {
    if (tests.length === 0) {
      return [];
    }

    return await this.db.insert(generatedTests).values(tests).returning();
  }

  async getByJob(jobId: string): Promise<GeneratedTestRow[]> {
    return await this.db
      .select()
      .from(generatedTests)
      .where(eq(generatedTests.jobId, jobId))
      .orderBy(asc(generatedTests.createdAt));
  }

  async getByPatch(patchId: string): Promise<GeneratedTestRow[]> {
    return await this.db
      .select()
      .from(generatedTests)
      .where(eq(generatedTests.patchId, patchId))
      .orderBy(asc(generatedTests.createdAt));
  }

  async updateResult(
    id: string,
    passes: boolean,
    durationMs: number,
  ): Promise<void> {
    await this.db
      .update(generatedTests)
      .set({ passes, durationMs })
      .where(eq(generatedTests.id, id));
  }

  async countByJob(jobId: string): Promise<number> {
    const [row] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(generatedTests)
      .where(eq(generatedTests.jobId, jobId));

    return row?.count ?? 0;
  }
}

// Made with Bob
