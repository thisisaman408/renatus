import type {
  LlmAdapter,
  LlmCapabilities,
  ReasoningRequest,
  ReasoningResponse,
  ReasoningChunk,
} from '@renatus/shared';

/**
 * McpElicitationAdapter — uses MCP sampling to delegate reasoning to the host LLM
 * (Bob, Claude Code, Cursor, etc.)
 * 
 * This is a stub implementation. The actual MCP sampling call would be implemented
 * when the MCP SDK provides the sampling capability.
 */
export class McpElicitationAdapter implements LlmAdapter {
  async reason(req: ReasoningRequest): Promise<ReasoningResponse> {
    const startTime = Date.now();
    
    // Stub: In a real implementation, this would use MCP sampling
    // to delegate to the host LLM (Bob, Claude, etc.)
    const content = `[MCP Elicitation Stub] Would delegate to host LLM with prompt: ${req.messages[req.messages.length - 1]?.content ?? ''}`;
    
    return {
      content,
      provider: 'mcp',
      model: 'host-llm',
      usage: {
        inputTokens: 0,
        outputTokens: 0,
      },
      latencyMs: Date.now() - startTime,
    };
  }

  async *stream(req: ReasoningRequest): AsyncIterable<ReasoningChunk> {
    // Stub: streaming not implemented yet
    const response = await this.reason(req);
    yield {
      delta: response.content,
      finishReason: 'stop',
    };
  }

  capabilities(): LlmCapabilities {
    return {
      contextWindow: 200_000, // Assume host LLM has large context
      supportsTools: true,
      supportsStreaming: false,
      provider: 'mcp',
      model: 'host-llm',
    };
  }
}

// Made with Bob
