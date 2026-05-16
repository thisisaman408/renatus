import { createGroq } from '@ai-sdk/groq';
import { generateText } from 'ai';
import type {
  LlmAdapter,
  LlmCapabilities,
  ReasoningRequest,
  ReasoningResponse,
  ReasoningChunk,
} from '@renatus/shared';

/**
 * GroqAdapter — direct Groq integration for low-latency inference
 */
export class GroqAdapter implements LlmAdapter {
  private client;
  private model: string;

  constructor(apiKey: string, model = 'llama-3.3-70b-versatile') {
    this.client = createGroq({
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
      provider: 'groq',
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
      contextWindow: 32_768,
      supportsTools: true,
      supportsStreaming: true,
      provider: 'groq',
      model: this.model,
    };
  }
}

// Made with Bob
