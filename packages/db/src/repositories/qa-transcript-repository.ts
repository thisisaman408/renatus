import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { eq } from "drizzle-orm";
import {
  qaTranscripts,
  type QaTranscriptRow,
  type NewQaTranscript,
} from "../schema/qa-transcripts.js";

/**
 * Persistence for the `qa_transcripts` table.
 *
 * One transcript per job — the Q&A workflow is one-shot. Methods mirror
 * `PatchRepository` (single insert via `.values([row]).returning()[0]`, a
 * `getById`, and a `getByJob` that returns the single row when present).
 */
export class QaTranscriptRepository {
  private db;

  constructor(databaseUrl: string) {
    const sql = neon(databaseUrl);
    this.db = drizzle(sql);
  }

  async create(row: NewQaTranscript): Promise<QaTranscriptRow> {
    const [inserted] = await this.db
      .insert(qaTranscripts)
      .values([row])
      .returning();

    if (!inserted) {
      throw new Error("Failed to create qa_transcripts row");
    }
    return inserted;
  }

  async getById(id: string): Promise<QaTranscriptRow | null> {
    const [row] = await this.db
      .select()
      .from(qaTranscripts)
      .where(eq(qaTranscripts.id, id))
      .limit(1);

    return row ?? null;
  }

  /**
   * Q&A is one-shot per job — at most one transcript row exists. Returns
   * null when no transcript has been recorded yet for the job.
   */
  async getByJob(jobId: string): Promise<QaTranscriptRow | null> {
    const [row] = await this.db
      .select()
      .from(qaTranscripts)
      .where(eq(qaTranscripts.jobId, jobId))
      .limit(1);

    return row ?? null;
  }
}
