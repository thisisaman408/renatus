import { drizzle } from 'drizzle-orm/neon-http';
import { neon } from '@neondatabase/serverless';
import { toolInvocations } from '../schema/tool-invocations.js';
import { createHash } from 'crypto';

export class ToolInvocationRepository {
  private db;

  constructor(databaseUrl: string) {
    const sql = neon(databaseUrl);
    this.db = drizzle(sql);
  }

  /**
   * Compute SHA256 hash of JSON data for audit trail
   */
  private computeHash(data: unknown): string {
    const json = JSON.stringify(data);
    return createHash('sha256').update(json).digest('hex');
  }

  async recordInvocation(params: {
    sessionId: string;
    toolName: string;
    input: Record<string, unknown>;
    output?: Record<string, unknown>;
    durationMs?: number;
    errorCode?: string;
  }) {
    const inputHash = this.computeHash(params.input);
    const responseHash = params.output ? this.computeHash(params.output) : null;

    const [invocation] = await this.db
      .insert(toolInvocations)
      .values({
        sessionId: params.sessionId,
        toolName: params.toolName,
        inputHash,
        responseHash,
        durationMs: params.durationMs,
        errorCode: params.errorCode,
        input: params.input,
        output: params.output,
      })
      .returning();

    return invocation;
  }
}

// Made with Bob
