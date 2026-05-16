import { McpSessionRepository, ToolInvocationRepository } from '@renatus/db';
import { randomUUID } from 'crypto';

/**
 * Audit context for MCP tool invocations
 */
interface AuditContext {
  sessionRepo: McpSessionRepository;
  invocationRepo: ToolInvocationRepository;
  bobTaskId: string;
  transport: 'stdio' | 'http';
}

let auditContext: AuditContext | null = null;

/**
 * Initialize audit context with database connection
 */
export function initializeAudit(databaseUrl: string) {
  const sessionRepo = new McpSessionRepository(databaseUrl);
  const invocationRepo = new ToolInvocationRepository(databaseUrl);
  
  // Generate a stable Bob task ID for this process
  // In a real MCP implementation, this would come from request metadata
  const bobTaskId = process.env.BOB_TASK_ID ?? `mcp-${randomUUID()}`;
  
  auditContext = {
    sessionRepo,
    invocationRepo,
    bobTaskId,
    transport: 'stdio',
  };
}

/**
 * Higher-order function that wraps tool handlers with audit logging
 */
export function withAudit<TInput, TOutput>(
  toolName: string,
  handler: (input: TInput) => Promise<TOutput>
): (input: TInput) => Promise<TOutput> {
  return async (input: TInput): Promise<TOutput> => {
    if (!auditContext) {
      // If audit is not initialized, just run the tool without logging
      return handler(input);
    }

    const startTime = Date.now();
    let output: TOutput | undefined;
    let errorCode: string | undefined;

    try {
      // Ensure session exists
      const session = await auditContext.sessionRepo.upsertSession(
        auditContext.bobTaskId,
        auditContext.transport
      );

      // Execute the tool
      output = await handler(input);

      // Record successful invocation
      const durationMs = Date.now() - startTime;
      if (session) {
        await auditContext.invocationRepo.recordInvocation({
          sessionId: session.id,
          toolName,
          input: input as Record<string, unknown>,
          output: output as Record<string, unknown>,
          durationMs,
        });
      }

      return output;
    } catch (error) {
      // Record failed invocation
      const durationMs = Date.now() - startTime;
      errorCode = error instanceof Error ? error.name : 'UnknownError';

      // Try to record the error, but don't fail if we can't
      try {
        const errorSession = await auditContext.sessionRepo.upsertSession(
          auditContext.bobTaskId,
          auditContext.transport
        );

        if (errorSession) {
          await auditContext.invocationRepo.recordInvocation({
            sessionId: errorSession.id,
            toolName,
            input: input as Record<string, unknown>,
            durationMs,
            errorCode,
          });
        }
      } catch (auditError) {
        console.error('Failed to record audit trail:', auditError);
      }

      throw error;
    }
  };
}

// Made with Bob
