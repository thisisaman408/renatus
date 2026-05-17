import {
  pgTable,
  uuid,
  text,
  jsonb,
  integer,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { jobs } from "./jobs";
import { repoSnapshots } from "./repo-snapshots";

/**
 * qa_transcripts — append-only record of a Codebase Q&A interaction.
 *
 * The Q&A agent (Wave 4) runs the read-only clone → index → retrieve → answer
 * pipeline. Each ask produces exactly one transcript row, signed with the same
 * ed25519 + canonicalJson primitives the Auditor uses. The signature shape
 * mirrors `Signature` in `packages/agents/src/auditor/types.ts` so the web app
 * can verify Q&A transcripts and signed audit reports through one widget.
 *
 * One transcript per job: the workflow is one-shot per `query_codebase` call,
 * never branches. `snapshotId` is nullable because a job can fail before clone
 * lands a snapshot row — we still want to persist the transcript with the
 * recorded failure context.
 *
 * Citations are typed as `{ filePath, line?, sha, snippet? }` so the web app
 * can deep-link to a specific line in the snapshot's working tree.
 */
export const qaTranscripts = pgTable(
  "qa_transcripts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    jobId: uuid("job_id")
      .notNull()
      .references(() => jobs.id, { onDelete: "cascade" }),
    snapshotId: uuid("snapshot_id").references(() => repoSnapshots.id, {
      onDelete: "cascade",
    }),
    question: text("question").notNull(),
    answer: text("answer").notNull(),
    citations: jsonb("citations")
      .$type<
        Array<{
          filePath: string;
          line?: number;
          sha: string;
          snippet?: string;
        }>
      >()
      .notNull()
      .default([]),
    signature: jsonb("signature")
      .$type<{
        algorithm: "ed25519";
        value: string;
        publicKey: string;
        messageHash: string;
        signedAt: string;
      }>()
      .notNull(),
    llmProvider: text("llm_provider").notNull(),
    llmLatencyMs: integer("llm_latency_ms").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => ({
    jobIdx: index("qa_transcripts_job_idx").on(t.jobId),
  }),
);

export type QaTranscriptRow = typeof qaTranscripts.$inferSelect;
export type NewQaTranscript = typeof qaTranscripts.$inferInsert;
