import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { eq } from 'drizzle-orm';
import { mcpSessions } from '../schema/mcp-sessions.js';

export class McpSessionRepository {
  private db;

  constructor(databaseUrl: string) {
    const sql = neon(databaseUrl);
    this.db = drizzle(sql);
  }

  async upsertSession(bobTaskId: string, transport: 'stdio' | 'http', metadata?: Record<string, unknown>) {
    const existing = await this.db
      .select()
      .from(mcpSessions)
      .where(eq(mcpSessions.bobTaskId, bobTaskId))
      .limit(1);

    if (existing.length > 0) {
      // Update lastSeenAt
      const [updated] = await this.db
        .update(mcpSessions)
        .set({
          lastSeenAt: new Date(),
          metadata: metadata ?? existing[0]?.metadata,
        })
        .where(eq(mcpSessions.bobTaskId, bobTaskId))
        .returning();
      return updated;
    } else {
      // Insert new session
      const [inserted] = await this.db
        .insert(mcpSessions)
        .values({
          bobTaskId,
          transport,
          metadata,
        })
        .returning();
      return inserted;
    }
  }

  async getSessionByBobTaskId(bobTaskId: string) {
    const [session] = await this.db
      .select()
      .from(mcpSessions)
      .where(eq(mcpSessions.bobTaskId, bobTaskId))
      .limit(1);
    return session ?? null;
  }
}

// Made with Bob
