import { drizzle } from "drizzle-orm/neon-http";
import { neon } from "@neondatabase/serverless";
import { desc, eq } from "drizzle-orm";
import type { Ecosystem, JobState, AgentKind } from "@renatus/shared";
import { jobs } from "../schema/jobs.js";

/**
 * Row shape returned by JobRepository queries.
 *
 * Mirrors `jobs` columns. Drizzle's row inference would import a value type
 * we'd then have to thread through every consumer; instead we hand-roll the
 * shape so the public type surface is stable across schema tweaks.
 */
export interface JobRow {
  id: string;
  sessionId: string;
  repoUrl: string;
  sourceVersion: string;
  targetVersion: string;
  ecosystem: Ecosystem;
  agentKind: AgentKind;
  state: JobState;
  startedAt: Date;
  completedAt: Date | null;
  metadata: Record<string, unknown> | null;
}

/**
 * Input for {@link JobRepository.create}. `metadata` is optional and round-trips
 * as a JSONB column — small payloads like `{ ref, ruleSource }` from the
 * Tier-1 `migrate_repository` tool live there for orchestrator handoff.
 */
export interface CreateJobInput {
  sessionId: string;
  repoUrl: string;
  sourceVersion: string;
  targetVersion: string;
  ecosystem: Ecosystem;
  agentKind: AgentKind;
  metadata?: Record<string, unknown>;
}

/**
 * JobRepository — persistence for the `jobs` row that anchors every
 * orchestrated migration. The Tier-1 `migrate_repository` tool creates a row
 * here BEFORE firing the Inngest event, so the workflow always has a stable
 * id to attach snapshots, plans, batches, and patches to.
 *
 * State transitions are caller-driven (the Inngest workflow flips the state
 * column at each phase). This repo does not enforce a state machine; the
 * schema enum is the source of truth for legal values.
 */
export class JobRepository {
  private db;

  constructor(databaseUrl: string) {
    const sql = neon(databaseUrl);
    this.db = drizzle(sql);
  }

  /**
   * Insert a new job row. The DB assigns `id` (UUID v4 default), `state`
   * (`'draft'` default), and `startedAt` (`now()` default).
   */
  async create(input: CreateJobInput): Promise<JobRow> {
    const [inserted] = await this.db
      .insert(jobs)
      .values({
        sessionId: input.sessionId,
        repoUrl: input.repoUrl,
        sourceVersion: input.sourceVersion,
        targetVersion: input.targetVersion,
        ecosystem: input.ecosystem,
        agentKind: input.agentKind,
        metadata: input.metadata,
      })
      .returning();

    if (!inserted) {
      throw new Error("Failed to insert job row");
    }

    return rowFromDrizzle(inserted);
  }

  /**
   * Look up a job by id. Returns null when nothing matches; callers decide
   * whether that's an error.
   */
  async getById(id: string): Promise<JobRow | null> {
    const [row] = await this.db
      .select()
      .from(jobs)
      .where(eq(jobs.id, id))
      .limit(1);

    return row ? rowFromDrizzle(row) : null;
  }

  /**
   * Flip the `state` column. The Inngest workflow calls this from each step
   * — `cloning` → `cloned` → `indexing` → `indexed` → `patching` → `patched`.
   *
   * Idempotent at the DB level: writing the same state twice is a no-op.
   */
  async updateState(id: string, state: JobState): Promise<void> {
    await this.db.update(jobs).set({ state }).where(eq(jobs.id, id));
  }

  /**
   * Terminal-success transition. Sets `state = 'done'` and stamps
   * `completedAt` with `now()`. Separate method from `updateState` so the
   * "completion" semantic is explicit at the call site.
   */
  async markCompleted(id: string): Promise<void> {
    await this.db
      .update(jobs)
      .set({ state: "done", completedAt: new Date() })
      .where(eq(jobs.id, id));
  }

  /**
   * Return the most recently started jobs, newest first. Powers the
   * `/jobs` directory-index view in the web app — demo users want to see
   * what they (or anyone) just ran without remembering the job UUID.
   *
   * `limit` is enforced at the SQL layer; callers should keep it modest
   * (≤ 100) since each row is fetched fully. No pagination yet — the
   * demo footprint never hits the cap.
   */
  async getRecent(limit: number): Promise<JobRow[]> {
    const rows = await this.db
      .select()
      .from(jobs)
      .orderBy(desc(jobs.startedAt))
      .limit(limit);

    return rows.map(rowFromDrizzle);
  }
}

/**
 * Narrow the drizzle row's `ecosystem` / `agentKind` / `state` columns from
 * their raw `string` to the discriminated unions in `@renatus/shared`. The
 * schema enum guarantees these casts are safe.
 */
function rowFromDrizzle(row: {
  id: string;
  sessionId: string;
  repoUrl: string;
  sourceVersion: string;
  targetVersion: string;
  ecosystem: string;
  agentKind: string;
  state: string;
  startedAt: Date;
  completedAt: Date | null;
  metadata: Record<string, unknown> | null;
}): JobRow {
  return {
    id: row.id,
    sessionId: row.sessionId,
    repoUrl: row.repoUrl,
    sourceVersion: row.sourceVersion,
    targetVersion: row.targetVersion,
    ecosystem: row.ecosystem as Ecosystem,
    agentKind: row.agentKind as AgentKind,
    state: row.state as JobState,
    startedAt: row.startedAt,
    completedAt: row.completedAt,
    metadata: row.metadata,
  };
}

// Made with Bob
