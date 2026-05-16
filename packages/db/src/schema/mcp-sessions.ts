import { pgTable, uuid, text, timestamp, jsonb } from 'drizzle-orm/pg-core';

export const mcpSessions = pgTable('mcp_sessions', {
  id: uuid('id').primaryKey().defaultRandom(),
  bobTaskId: text('bob_task_id').notNull().unique(),
  transport: text('transport', { enum: ['stdio', 'http'] }).notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
});

// Made with Bob
