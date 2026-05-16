import { pgTable, uuid, text, timestamp, jsonb } from 'drizzle-orm/pg-core';
import { jobs } from './jobs';

/**
 * web_jobs — direct-mode jobs initiated from apps/web/run, without an MCP client.
 *
 * The web app brings its own LLM (via Vercel AI Gateway routing to Groq /
 * Gemini / watsonx). A web_job rows is the per-visitor handle to a `jobs` row
 * — same Inngest workflow runs, same audit chain ends up.
 */
export const webJobs = pgTable('web_jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  jobId: uuid('job_id').notNull().references(() => jobs.id),
  /** Anonymous session cookie value; jobs are this visitor's while the cookie lives. */
  sessionCookie: text('session_cookie').notNull(),
  /** Provider the visitor picked: groq | gemini | watsonx | auto. */
  provider: text('provider', {
    enum: ['groq', 'gemini', 'watsonx', 'auto'],
  }).notNull().default('auto'),
  /** User-agent + referrer at job-creation time, for replay. */
  clientMetadata: jsonb('client_metadata').$type<Record<string, unknown>>(),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
});
