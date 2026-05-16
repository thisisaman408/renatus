import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { generateText } from 'ai';
import type {
  LlmAdapter,
  LlmCapabilities,
  ReasoningRequest,
  ReasoningResponse,
  ReasoningChunk,
} from '@renatus/shared';

/**
 * VercelAiGatewayAdapter — uses Vercel AI SDK with OpenAI-compatible endpoint
 * pointing to Vercel AI Gateway for multi-provider routing
 */
export class VercelAiGatewayAdapter implements LlmAdapter {
  private client;
  private model: string;

  constructor(gatewayUrl: string, apiKey: string, model = 'gpt-4o-mini') {
    this.client = createOpenAICompatible({
      name: 'vercel-ai-gateway',
      baseURL: gatewayUrl,
      apiKey,
    });
    this.model = model;
  }

  async reason(req: ReasoningRequest): Promise<ReasoningResponse> {
    const startTime = Date.now();

    const result = await generateText({
      model: this.client(this.model) as any, // Type compatibility workaround for AI SDK v4
      system: req.system,
      messages: req.messages.map((m) => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content,
      })),
      temperature: req.temperature,
      maxTokens: req.maxTokens,
    });

    return {
      content: result.text,
      provider: 'vercel-ai-gateway',
      model: this.model,
      usage: {
        inputTokens: result.usage.promptTokens,
        outputTokens: result.usage.completionTokens,
      },
      latencyMs: Date.now() - startTime,
    };
  }

  async *stream(req: ReasoningRequest): AsyncIterable<ReasoningChunk> {
    // Streaming not implemented in this stub
    const response = await this.reason(req);
    yield {
      delta: response.content,
      finishReason: 'stop',
    };
  }

  capabilities(): LlmCapabilities {
    return {
      contextWindow: 128_000,
      supportsTools: true,
      supportsStreaming: true,
      provider: 'vercel-ai-gateway',
      model: this.model,
    };
  }
}

// Made with Bob
