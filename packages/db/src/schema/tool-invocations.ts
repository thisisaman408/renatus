import { pgTable, uuid, text, timestamp, integer, jsonb } from 'drizzle-orm/pg-core';
import { mcpSessions } from './mcp-sessions';

export const toolInvocations = pgTable('tool_invocations', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id').notNull().references(() => mcpSessions.id),
  toolName: text('tool_name').notNull(),
  inputHash: text('input_hash').notNull(),
  responseHash: text('response_hash'),
  durationMs: integer('duration_ms'),
  errorCode: text('error_code'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  input: jsonb('input').$type<Record<string, unknown>>(),
  output: jsonb('output').$type<Record<string, unknown>>(),
});

// Made with Bob
