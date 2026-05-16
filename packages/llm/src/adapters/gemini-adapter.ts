import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { generateText } from 'ai';
import type {
  LlmAdapter,
  LlmCapabilities,
  ReasoningRequest,
  ReasoningResponse,
  ReasoningChunk,
} from '@renatus/shared';

/**
 * GeminiAdapter — direct Google Gemini integration for large-context tasks
 */
export class GeminiAdapter implements LlmAdapter {
  private client;
  private model: string;

  constructor(apiKey: string, model = 'gemini-2.0-flash-exp') {
    this.client = createGoogleGenerativeAI({
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
      provider: 'gemini',
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
      contextWindow: 1_000_000, // Gemini 2.0 Flash supports 1M tokens
      supportsTools: true,
      supportsStreaming: true,
      provider: 'gemini',
      model: this.model,
    };
  }
}

// Made with Bob
