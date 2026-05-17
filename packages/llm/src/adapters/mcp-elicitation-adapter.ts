import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { CreateMessageResultSchema } from '@modelcontextprotocol/sdk/types.js';
import type {
  LlmAdapter,
  LlmCapabilities,
  ReasoningRequest,
  ReasoningResponse,
  ReasoningChunk,
} from '@renatus/shared';

/**
 * McpElicitationAdapter — delegates reasoning to the HOST LLM via MCP
 * `sampling/createMessage`. When Renatus runs as an MCP server under a host
 * that supports sampling (Bob, Claude Code, Cursor), the host's own LLM does
 * the work — the caller pays the inference cost, not Renatus.
 *
 * Architecture:
 *   - `@renatus/llm` doesn't depend on `@renatus/mcp-server`, so the adapter
 *     can't import the live `Server` instance directly.
 *   - Instead, `@renatus/mcp-server`'s bootstrap calls `setMcpServer(server)`
 *     after `server.connect(transport)`. The module-level singleton is shared
 *     across all imports inside one Node process (ESM module-cache guarantee).
 *   - When the LlmRouter selects this adapter (`MCP_ENABLE_ELICITATION=true`,
 *     priority #1 in the routing policy), `reason()` reads the registered
 *     Server and issues a `sampling/createMessage` request back to the host.
 *
 * The adapter throws if it's invoked before `setMcpServer()` ran — which is
 * the correct failure mode for misconfigured deployments (stand-alone
 * Renatus boots with `MCP_ENABLE_ELICITATION=false` and never hits this).
 */

/* Process-level singleton holding the active MCP Server reference. */
let _mcpServer: Server | null = null;

export function setMcpServer(server: Server): void {
  _mcpServer = server;
}

export function getMcpServer(): Server | null {
  return _mcpServer;
}

export class McpElicitationError extends Error {
  override readonly name = 'McpElicitationError';
  constructor(
    message: string,
    public override readonly cause?: unknown,
  ) {
    super(message);
  }
}

export class McpElicitationAdapter implements LlmAdapter {
  async reason(req: ReasoningRequest): Promise<ReasoningResponse> {
    const server = _mcpServer;
    if (!server) {
      throw new McpElicitationError(
        'MCP server not initialized — set MCP_ENABLE_ELICITATION=false or ' +
          'ensure the MCP server bootstrap calls setMcpServer() after ' +
          'server.connect(transport).',
      );
    }

    const startTime = Date.now();
    const { systemPrompt, mcpMessages } = mapToMcpMessages(req);

    const params: {
      messages: Array<{
        role: 'user' | 'assistant';
        content: { type: 'text'; text: string };
      }>;
      systemPrompt?: string;
      includeContext: 'none';
      temperature?: number;
      maxTokens: number;
      metadata?: Record<string, unknown>;
    } = {
      messages: mcpMessages,
      includeContext: 'none',
      maxTokens: req.maxTokens ?? 4096,
    };
    if (systemPrompt !== undefined) params.systemPrompt = systemPrompt;
    if (req.temperature !== undefined) params.temperature = req.temperature;
    if (req.metadata !== undefined) {
      params.metadata = req.metadata as Record<string, unknown>;
    }

    let response: { model: string; content: { type: string; text?: string } };
    try {
      response = await server.request(
        { method: 'sampling/createMessage', params },
        CreateMessageResultSchema,
      );
    } catch (err) {
      throw new McpElicitationError(
        `MCP host rejected sampling request: ${
          err instanceof Error ? err.message : String(err)
        }`,
        err,
      );
    }

    const content = response.content;
    if (content.type !== 'text' || typeof content.text !== 'string') {
      throw new McpElicitationError(
        `MCP host returned unsupported content type: ${content.type}`,
      );
    }

    return {
      content: content.text,
      provider: 'mcp',
      model: response.model ?? 'host-llm',
      // MCP sampling does not surface token counts. Report 0/0 rather than
      // fabricating values that would mislead telemetry-driven routing.
      usage: { inputTokens: 0, outputTokens: 0 },
      latencyMs: Date.now() - startTime,
    };
  }

  async *stream(req: ReasoningRequest): AsyncIterable<ReasoningChunk> {
    // MCP sampling is not streaming in the current spec. Fall back to a
    // single-chunk yield from reason() — same shape as the Groq/Gemini/
    // Watsonx adapters when their underlying transport doesn't stream.
    const response = await this.reason(req);
    yield { delta: response.content, finishReason: 'stop' };
  }

  capabilities(): LlmCapabilities {
    return {
      // Host LLM is typically Claude/Bob-tier — assume 200k context.
      contextWindow: 200_000,
      supportsTools: true,
      supportsStreaming: false,
      provider: 'mcp',
      model: 'host-llm',
    };
  }
}

/**
 * Translate Renatus's `ReasoningMessage[]` (system | user | assistant | tool)
 * into MCP sampling's narrower shape:
 *   - 'system' messages collapse into `systemPrompt`.
 *   - 'tool' messages have no MCP-native role; we fold them into a user turn,
 *     prefixed `[tool] ` so the host LLM can still see the tool output.
 *   - 'user' / 'assistant' pass through with text content.
 */
function mapToMcpMessages(req: ReasoningRequest): {
  systemPrompt: string | undefined;
  mcpMessages: Array<{
    role: 'user' | 'assistant';
    content: { type: 'text'; text: string };
  }>;
} {
  const systemParts: string[] = [];
  if (req.system) systemParts.push(req.system);
  const mcpMessages: Array<{
    role: 'user' | 'assistant';
    content: { type: 'text'; text: string };
  }> = [];

  for (const msg of req.messages) {
    if (msg.role === 'system') {
      systemParts.push(msg.content);
      continue;
    }
    if (msg.role === 'tool') {
      mcpMessages.push({
        role: 'user',
        content: { type: 'text', text: `[tool] ${msg.content}` },
      });
      continue;
    }
    mcpMessages.push({
      role: msg.role,
      content: { type: 'text', text: msg.content },
    });
  }

  return {
    systemPrompt: systemParts.length > 0 ? systemParts.join('\n\n') : undefined,
    mcpMessages,
  };
}

// Made with Bob
