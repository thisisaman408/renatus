import { pgTable, uuid, text, timestamp, jsonb } from 'drizzle-orm/pg-core';
import { mcpSessions } from './mcp-sessions';

export const jobs = pgTable('jobs', {
  id: uuid('id').primaryKey().defaultRandom(),
  sessionId: uuid('session_id').notNull().references(() => mcpSessions.id),
  repoUrl: text('repo_url').notNull(),
  sourceVersion: text('source_version').notNull(),
  targetVersion: text('target_version').notNull(),
  ecosystem: text('ecosystem', { enum: ['npm', 'pypi', 'cargo', 'maven'] }).notNull(),
  state: text('state', {
    enum: [
      'draft', 'planning', 'planned',
      'cloning', 'cloned',
      'indexing', 'indexed',
      'patching', 'patched',
      'testing', 'tested',
      'auditing', 'audited',
      'done', 'failed', 'aborted', 'paused',
    ],
  }).notNull().default('draft'),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().defaultNow(),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  metadata: jsonb('metadata').$type<Record<string, unknown>>(),
});

// Made with Bob
