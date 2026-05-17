import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { eq, inArray } from "drizzle-orm";
import {
  repoSnapshots,
  type SnapshotRow,
  type NewSnapshot,
} from "../schema/repo-snapshots.js";

/**
 * Persistence for `repo_snapshots` — frozen clones of target repos.
 */
export class SnapshotRepository {
  private db;

  constructor(databaseUrl: string) {
    const sql = neon(databaseUrl);
    this.db = drizzle(sql);
  }

  async create(input: {
    jobId: string;
    repoUrl: string;
    ref: string;
    commitSha: string;
    localPath: string;
  }): Promise<SnapshotRow> {
    const row: NewSnapshot = {
      jobId: input.jobId,
      repoUrl: input.repoUrl,
      ref: input.ref,
      commitSha: input.commitSha,
      localPath: input.localPath,
    };

    const [inserted] = await this.db
      .insert(repoSnapshots)
      .values(row)
      .returning();

    if (!inserted) {
      throw new Error("Failed to insert repo snapshot");
    }

    return inserted;
  }

  async getById(id: string): Promise<SnapshotRow | null> {
    const [snapshot] = await this.db
      .select()
      .from(repoSnapshots)
      .where(eq(repoSnapshots.id, id))
      .limit(1);

    return snapshot ?? null;
  }

  async getByJobId(jobId: string): Promise<SnapshotRow | null> {
    const [snapshot] = await this.db
      .select()
      .from(repoSnapshots)
      .where(eq(repoSnapshots.jobId, jobId))
      .limit(1);

    return snapshot ?? null;
  }

  /**
   * Batch lookup of snapshots by job ID. Returns a Map keyed by `jobId` so
   * callers can resolve in O(1) without a second pass. Missing jobs are
   * simply absent from the map.
   *
   * Used by `/jobs` index page to render snapshot info for ~50 rows in one
   * round trip instead of 50.
   */
  async getByJobIds(
    jobIds: ReadonlyArray<string>,
  ): Promise<Map<string, SnapshotRow>> {
    const out = new Map<string, SnapshotRow>();
    if (jobIds.length === 0) return out;

    const rows = await this.db
      .select()
      .from(repoSnapshots)
      .where(inArray(repoSnapshots.jobId, [...jobIds]));

    for (const row of rows) {
      // If multiple snapshots exist for a single job (shouldn't happen by
      // contract, but defensively), keep the first — same semantics as
      // `getByJobId` which `LIMIT 1`s.
      if (!out.has(row.jobId)) {
        out.set(row.jobId, row);
      }
    }
    return out;
  }
}

// Made with Bob
