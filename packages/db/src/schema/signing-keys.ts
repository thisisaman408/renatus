import {
  pgTable,
  uuid,
  text,
  jsonb,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { jobs } from "./jobs";

/**
 * signing_keys — per-job cryptographic key material for the Auditor.
 *
 * One row per (jobId, algorithm). The Auditor checks for an existing
 * keypair before generating a fresh one so re-running an audit yields
 * a stable, verifiable signature lineage.
 *
 * Storage rules:
 *   - When `RENATUS_KEK` is unset, the ed25519 private key lands in
 *     `privateKeyHex` as plaintext (development only; the Auditor emits
 *     a loud warning).
 *   - When `RENATUS_KEK` is set, the private key is AES-256-GCM encrypted
 *     and the ciphertext + IV + auth tag live in `encryptedPrivateKey`;
 *     `privateKeyHex` stays null. The `kekId` field lets us rotate the
 *     KEK (env var change) in a non-destructive way.
 *
 * The public key is always plaintext — it is, by definition, public.
 *
 * `algorithm` is single-value today (`ed25519`) but kept as text so we can
 * add curves later without a destructive migration.
 */
export const signingKeys = pgTable(
  "signing_keys",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    algorithm: text("algorithm").$type<"ed25519">().notNull(),
    publicKeyHex: text("public_key_hex").notNull(),
    privateKeyHex: text("private_key_hex"),
    encryptedPrivateKey: jsonb("encrypted_private_key").$type<{
      ciphertext: string;
      iv: string;
      authTag: string;
      alg: "aes-256-gcm";
      kekId: "env-kek-v1";
    }>(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    jobAlgorithmUnique: uniqueIndex("signing_keys_job_algorithm_unique").on(
      t.jobId,
      t.algorithm,
    ),
  }),
);

export type SigningKeyRow = typeof signingKeys.$inferSelect;
export type NewSigningKey = typeof signingKeys.$inferInsert;
