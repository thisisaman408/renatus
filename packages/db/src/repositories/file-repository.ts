import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { and, eq } from "drizzle-orm";
import { files, type FileRow, type NewFile } from "../schema/files.js";
import type { FileLanguage } from "@renatus/shared";

export interface FileInput {
  path: string;
  language: FileLanguage;
  sha: string;
  sizeBytes: number;
}

/**
 * Persistence for `files`. Bulk insertion is the hot path for the indexer.
 */
export class FileRepository {
  private db;

  constructor(databaseUrl: string) {
    const sql = neon(databaseUrl);
    this.db = drizzle(sql);
  }

  async bulkInsert(
    snapshotId: string,
    fileInputs: FileInput[],
  ): Promise<FileRow[]> {
    if (fileInputs.length === 0) {
      return [];
    }

    const rows: NewFile[] = fileInputs.map((f) => ({
      snapshotId,
      path: f.path,
      language: f.language,
      sha: f.sha,
      sizeBytes: f.sizeBytes,
    }));

    return await this.db.insert(files).values(rows).returning();
  }

  async getBySnapshot(snapshotId: string): Promise<FileRow[]> {
    return await this.db
      .select()
      .from(files)
      .where(eq(files.snapshotId, snapshotId));
  }

  async getByPath(
    snapshotId: string,
    path: string,
  ): Promise<FileRow | null> {
    const [row] = await this.db
      .select()
      .from(files)
      .where(and(eq(files.snapshotId, snapshotId), eq(files.path, path)))
      .limit(1);

    return row ?? null;
  }
}

// Made with Bob
