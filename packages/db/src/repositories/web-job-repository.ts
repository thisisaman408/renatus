import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { eq } from "drizzle-orm";
import { webJobs } from "../schema/web-jobs.js";

/**
 * Provider routing tag selected by the web visitor. Mirrors the column enum on
 * the `web_jobs` table. `auto` lets the LlmRouter pick a provider; the three
 * explicit values pin the routing for the duration of the job.
 */
export type WebJobProvider = "groq" | "gemini" | "watsonx" | "auto";

/**
 * Row shape returned by {@link WebJobRepository} queries. Mirrors the
 * `web_jobs` columns; hand-rolled (rather than imported from drizzle's
 * `$inferSelect`) so the public type surface is stable across schema tweaks.
 */
export interface WebJobRow {
  id: string;
  jobId: string;
  sessionCookie: string;
  provider: WebJobProvider;
  clientMetadata: Record<string, unknown> | null;
  createdAt: Date;
}

/**
 * Input for {@link WebJobRepository.create}.
 *
 * `provider` defaults to `'auto'` (matching the schema default) — the LlmRouter
 * picks one of groq / gemini / watsonx per call. `clientMetadata` is a free-form
 * JSONB blob carrying user-agent, referrer, etc. captured at job-creation time
 * for replay.
 */
export interface CreateWebJobInput {
  jobId: string;
  sessionCookie: string;
  provider?: WebJobProvider;
  clientMetadata?: Record<string, unknown>;
}

/**
 * WebJobRepository — persistence for the `web_jobs` row that links an
 * anonymous browser session cookie to a `jobs` row created via the apps/web
 * surface (no MCP client). One `web_jobs` row is created at job submission
 * time and is never updated; per-visitor lookup happens via {@link getByJobId}.
 *
 * The web app is the second entry surface (the MCP server is the first); both
 * share the same `jobs` + downstream tables. This repo is the only piece of
 * persistence specific to the web surface — every other artefact (audit
 * events, patches, tests, transcripts) is keyed on `jobId` and is identical
 * between MCP-driven and web-driven runs.
 */
export class WebJobRepository {
  private db;

  constructor(databaseUrl: string) {
    const sql = neon(databaseUrl);
    this.db = drizzle(sql);
  }

  /**
   * Insert a new `web_jobs` row. The DB assigns `id` (UUID v4 default),
   * `createdAt` (`now()` default), and applies the `provider` default
   * (`'auto'`) when not supplied.
   */
  async create(input: CreateWebJobInput): Promise<WebJobRow> {
    const [inserted] = await this.db
      .insert(webJobs)
      .values({
        jobId: input.jobId,
        sessionCookie: input.sessionCookie,
        provider: input.provider ?? "auto",
        clientMetadata: input.clientMetadata,
      })
      .returning();

    if (!inserted) {
      throw new Error("Failed to insert web_jobs row");
    }

    return rowFromDrizzle(inserted);
  }

  /**
   * Look up the `web_jobs` row for a given job id. Returns null if the job
   * was not created via the web surface (e.g. an MCP-driven job).
   */
  async getByJobId(jobId: string): Promise<WebJobRow | null> {
    const [row] = await this.db
      .select()
      .from(webJobs)
      .where(eq(webJobs.jobId, jobId))
      .limit(1);

    return row ? rowFromDrizzle(row) : null;
  }
}

/**
 * Narrow the drizzle row's `provider` column from raw `string` to the
 * `WebJobProvider` union. The schema enum guarantees the cast is safe.
 */
function rowFromDrizzle(row: {
  id: string;
  jobId: string;
  sessionCookie: string;
  provider: string;
  clientMetadata: Record<string, unknown> | null;
  createdAt: Date;
}): WebJobRow {
  return {
    id: row.id,
    jobId: row.jobId,
    sessionCookie: row.sessionCookie,
    provider: row.provider as WebJobProvider,
    clientMetadata: row.clientMetadata,
    createdAt: row.createdAt,
  };
}

// Made with Bob
