import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { and, eq } from "drizzle-orm";
import {
  signingKeys,
  type SigningKeyRow,
  type NewSigningKey,
} from "../schema/signing-keys.js";

/**
 * Persistence for the `signing_keys` table.
 *
 * Append-mostly: keys are written once at audit-time and read on
 * subsequent audits of the same job. There is no update method —
 * if a job's keypair needs to change, that's a new job.
 */
export class SigningKeyRepository {
  private db;

  constructor(databaseUrl: string) {
    const sql = neon(databaseUrl);
    this.db = drizzle(sql);
  }

  async create(row: NewSigningKey): Promise<SigningKeyRow> {
    const [created] = await this.db
      .insert(signingKeys)
      .values(row)
      .returning();

    if (!created) {
      throw new Error("Failed to create signing key row");
    }
    return created;
  }

  async getByJobId(
    jobId: string,
    algorithm: "ed25519" = "ed25519",
  ): Promise<SigningKeyRow | null> {
    const [row] = await this.db
      .select()
      .from(signingKeys)
      .where(
        and(
          eq(signingKeys.jobId, jobId),
          eq(signingKeys.algorithm, algorithm),
        ),
      )
      .limit(1);

    return row ?? null;
  }
}
