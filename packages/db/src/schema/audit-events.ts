import { pgTable, text, timestamp, jsonb, uuid, index } from "drizzle-orm/pg-core";

/**
 * Append-only audit trail for all agent actions.
 * Every Cartographer, Surgeon, Examiner, and Auditor operation writes here.
 * 
 * Invariant: Never UPDATE or DELETE. Only INSERT.
 * 
 * The audit report aggregates these events and signs them with ed25519.
 */
export const auditEvents = pgTable(
  "audit_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    
    // Which job does this event belong to?
    jobId: uuid("job_id").notNull(),
    
    // Which agent produced this event?
    // "cartographer" | "surgeon" | "examiner" | "auditor" | "orchestrator"
    agentKind: text("agent_kind").notNull(),
    
    // What action did the agent take?
    // Examples: "breaking_change_map_created", "patch_proposed", "patch_applied", 
    //           "test_generated", "test_passed", "test_failed", "audit_signed"
    eventType: text("event_type").notNull(),
    
    // Structured event payload (agent-specific)
    // Cartographer: { ruleCount, breakingChangeCount, ... }
    // Surgeon: { fileId, patchId, confidence, ... }
    // Examiner: { testId, testResult, ... }
    // Auditor: { signature, publicKey, ... }
    payload: jsonb("payload").notNull(),
    
    // ISO 8601 timestamp when the event occurred
    timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
    
    // Optional: link to the specific entity this event is about
    // (e.g., patchId for "patch_applied", testId for "test_passed")
    entityId: uuid("entity_id"),
    entityType: text("entity_type"), // "patch" | "test" | "breaking_change_map" | etc.
  },
  (table) => ({
    // Index for querying all events for a job (audit report generation)
    jobIdIdx: index("audit_events_job_id_idx").on(table.jobId),
    
    // Index for querying events by agent (debugging, analytics)
    agentKindIdx: index("audit_events_agent_kind_idx").on(table.agentKind),
    
    // Index for querying events by type (e.g., all "patch_applied" events)
    eventTypeIdx: index("audit_events_event_type_idx").on(table.eventType),
    
    // Composite index for time-series queries (most recent events for a job)
    jobTimestampIdx: index("audit_events_job_timestamp_idx").on(table.jobId, table.timestamp),
  })
);

export type AuditEvent = typeof auditEvents.$inferSelect;
export type NewAuditEvent = typeof auditEvents.$inferInsert;

// Made with Bob
