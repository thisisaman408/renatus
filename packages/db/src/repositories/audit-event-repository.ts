import { neon } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-http";
import { desc, eq, and } from "drizzle-orm";
import { auditEvents, type AuditEvent, type NewAuditEvent } from "../schema/audit-events.js";

/**
 * Repository for append-only audit events.
 * 
 * Invariant: This repository ONLY supports INSERT and SELECT.
 * No UPDATE or DELETE methods exist by design.
 */
export class AuditEventRepository {
  private db;

  constructor(databaseUrl: string) {
    const sql = neon(databaseUrl);
    this.db = drizzle(sql);
  }

  /**
   * Record a new audit event.
   * This is the ONLY write operation allowed on audit_events.
   */
  async create(event: NewAuditEvent): Promise<AuditEvent> {
    const [created] = await this.db
      .insert(auditEvents)
      .values(event)
      .returning();
    
    if (!created) {
      throw new Error("Failed to create audit event");
    }
    
    return created;
  }

  /**
   * Get all audit events for a job, ordered by timestamp (oldest first).
   * Used by the Auditor to generate the audit report.
   */
  async findByJobId(jobId: string): Promise<AuditEvent[]> {
    return this.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.jobId, jobId))
      .orderBy(auditEvents.timestamp);
  }

  /**
   * Get the most recent N events for a job.
   * Useful for real-time progress tracking in the UI.
   */
  async findRecentByJobId(jobId: string, limit: number = 10): Promise<AuditEvent[]> {
    return this.db
      .select()
      .from(auditEvents)
      .where(eq(auditEvents.jobId, jobId))
      .orderBy(desc(auditEvents.timestamp))
      .limit(limit);
  }

  /**
   * Get all events of a specific type for a job.
   * Example: all "patch_applied" events to see what files were changed.
   */
  async findByJobIdAndEventType(jobId: string, eventType: string): Promise<AuditEvent[]> {
    return this.db
      .select()
      .from(auditEvents)
      .where(and(
        eq(auditEvents.jobId, jobId),
        eq(auditEvents.eventType, eventType)
      ))
      .orderBy(auditEvents.timestamp);
  }

  /**
   * Get all events produced by a specific agent for a job.
   * Example: all Surgeon events to see the patch history.
   */
  async findByJobIdAndAgentKind(jobId: string, agentKind: string): Promise<AuditEvent[]> {
    return this.db
      .select()
      .from(auditEvents)
      .where(and(
        eq(auditEvents.jobId, jobId),
        eq(auditEvents.agentKind, agentKind)
      ))
      .orderBy(auditEvents.timestamp);
  }
}

// Made with Bob
