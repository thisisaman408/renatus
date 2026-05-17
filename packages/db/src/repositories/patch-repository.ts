import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { eq } from "drizzle-orm";
import { patches, type PatchRow, type NewPatch } from "../schema/patches.js";
import type { PatchStatus } from "@renatus/shared";

/**
 * Persistence for the `patches` table.
 */
export class PatchRepository {
  private db;

  constructor(databaseUrl: string) {
    const sql = neon(databaseUrl);
    this.db = drizzle(sql);
  }

  async bulkInsert(rows: NewPatch[]): Promise<PatchRow[]> {
    if (rows.length === 0) {
      return [];
    }

    return await this.db.insert(patches).values(rows).returning();
  }

  async getByJob(jobId: string): Promise<PatchRow[]> {
    return await this.db
      .select()
      .from(patches)
      .where(eq(patches.jobId, jobId));
  }

  async getById(id: string): Promise<PatchRow | null> {
    const [patch] = await this.db
      .select()
      .from(patches)
      .where(eq(patches.id, id))
      .limit(1);

    return patch ?? null;
  }

  async updateStatus(id: string, status: PatchStatus): Promise<void> {
    await this.db
      .update(patches)
      .set({ status })
      .where(eq(patches.id, id));
  }
}

// Made with Bob
