import type {
  LlmAdapter,
  ReasoningRequest,
  ReasoningResponse,
  ReasoningChunk,
  LlmCapabilities,
} from '@renatus/shared';
import { McpElicitationAdapter } from './adapters/mcp-elicitation-adapter.js';
import { VercelAiGatewayAdapter } from './adapters/vercel-ai-gateway-adapter.js';
import { GroqAdapter } from './adapters/groq-adapter.js';
import { GeminiAdapter } from './adapters/gemini-adapter.js';
import { WatsonxGraniteAdapter } from './adapters/watsonx-granite-adapter.js';

/**
 * LlmRouter — intelligent routing across available LLM providers
 * 
 * Routing policy (from SYSTEM-DESIGN.md §7):
 * 1. If MCP elicitation available → use MCP (delegate to host LLM)
 * 2. Else if WATSONX_API_KEY → use watsonx (sponsor signal)
 * 3. Else if GEMINI_API_KEY and context > 100k tokens → use Gemini (large context)
 * 4. Else → use Groq (default, low latency)
 */
export class LlmRouter implements LlmAdapter {
  private adapters: Map<string, LlmAdapter> = new Map();
  private mcpAvailable = false;

  constructor() {
    this.initializeAdapters();
  }

  private initializeAdapters() {
    // MCP elicitation is only meaningful when invoked from an MCP host that
    // supports sampling. We can't detect that from the adapter constructor —
    // the constructor never fails — so we gate it behind an explicit env var.
    // Default off: stand-alone callers (the llm_test smoke tool, the web app,
    // direct unit tests) skip the stub and hit a real provider.
    if (process.env.MCP_ENABLE_ELICITATION === 'true') {
      this.adapters.set('mcp', new McpElicitationAdapter());
      this.mcpAvailable = true;
    }

    // Watsonx (if configured)
    const watsonxApiKey = process.env.WATSONX_API_KEY;
    const watsonxProjectId = process.env.WATSONX_PROJECT_ID;
    if (watsonxApiKey && watsonxProjectId) {
      try {
        const watsonxAdapter = new WatsonxGraniteAdapter(watsonxApiKey, watsonxProjectId);
        this.adapters.set('watsonx', watsonxAdapter);
      } catch (error) {
        console.error('Failed to initialize Watsonx adapter:', error);
      }
    }

    // Gemini (if configured)
    const geminiApiKey = process.env.GEMINI_API_KEY;
    if (geminiApiKey) {
      const geminiAdapter = new GeminiAdapter(geminiApiKey);
      this.adapters.set('gemini', geminiAdapter);
    }

    // Groq (if configured)
    const groqApiKey = process.env.GROQ_API_KEY;
    if (groqApiKey) {
      const groqAdapter = new GroqAdapter(groqApiKey);
      this.adapters.set('groq', groqAdapter);
    }

    // Vercel AI Gateway (if configured)
    const gatewayUrl = process.env.VERCEL_AI_GATEWAY_URL;
    const gatewayApiKey = process.env.VERCEL_AI_GATEWAY_API_KEY;
    if (gatewayUrl && gatewayApiKey) {
      const gatewayAdapter = new VercelAiGatewayAdapter(gatewayUrl, gatewayApiKey);
      this.adapters.set('gateway', gatewayAdapter);
    }
  }

  /**
   * Select the best adapter based on the routing policy
   */
  private selectAdapter(req: ReasoningRequest): LlmAdapter {
    // Estimate context size (rough approximation: 1 token ≈ 4 chars)
    const contextSize = req.messages.reduce((sum, m) => sum + m.content.length, 0) / 4;

    // 1. MCP elicitation if available
    if (this.mcpAvailable && this.adapters.has('mcp')) {
      return this.adapters.get('mcp')!;
    }

    // 2. Watsonx if configured (sponsor signal)
    if (this.adapters.has('watsonx')) {
      return this.adapters.get('watsonx')!;
    }

    // 3. Gemini if context > 100k tokens
    if (contextSize > 100_000 && this.adapters.has('gemini')) {
      return this.adapters.get('gemini')!;
    }

    // 4. Groq as default (low latency)
    if (this.adapters.has('groq')) {
      return this.adapters.get('groq')!;
    }

    // Fallback to gateway if nothing else is available
    if (this.adapters.has('gateway')) {
      return this.adapters.get('gateway')!;
    }

    throw new Error('No LLM adapters configured. Please set at least one of: GROQ_API_KEY, GEMINI_API_KEY, WATSONX_API_KEY, or VERCEL_AI_GATEWAY_URL');
  }

  async reason(req: ReasoningRequest): Promise<ReasoningResponse> {
    const adapter = this.selectAdapter(req);
    return adapter.reason(req);
  }

  async *stream(req: ReasoningRequest): AsyncIterable<ReasoningChunk> {
    const adapter = this.selectAdapter(req);
    yield* adapter.stream(req);
  }

  capabilities(): LlmCapabilities {
    // Return capabilities of the first available adapter
    const firstAdapter = Array.from(this.adapters.values())[0];
    if (!firstAdapter) {
      throw new Error('No LLM adapters configured');
    }
    return firstAdapter.capabilities();
  }

  /**
   * Get list of available providers
   */
  getAvailableProviders(): string[] {
    return Array.from(this.adapters.keys());
  }
}

// Made with Bob
