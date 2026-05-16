import { z } from 'zod';

/**
 * LlmAdapter — single interface decoupling agents from "who is reasoning."
 *
 * Implementations live in packages/llm:
 *   - McpElicitationAdapter   → host LLM via MCP sampling (Bob, Claude Code, Cursor)
 *   - VercelAiGatewayAdapter  → multi-provider routing via Vercel AI Gateway
 *   - GroqAdapter             → direct Groq (low-latency tier, bypass Gateway)
 *   - GeminiAdapter           → direct Gemini (large-context tier)
 *   - WatsonxGraniteAdapter   → IBM Granite via watsonx (sponsor signal)
 *
 * Agents take an LlmRouter, not a specific adapter. The router picks per call
 * based on context size, latency budget, and configured providers.
 */

export const ReasoningRoleSchema = z.enum(['system', 'user', 'assistant', 'tool']);

export const ReasoningMessageSchema = z.object({
  role: ReasoningRoleSchema,
  content: z.string(),
});

export const ReasoningResponseFormatSchema = z.enum([
  'text',
  'json',
  'file-replacement', // Surgeon: replace the whole file
  'patch-list', // Surgeon: list of {path, before, after}
  'rule-classification', // Cartographer: severity + category
]);

export const ReasoningRequestSchema = z.object({
  system: z.string().optional(),
  messages: z.array(ReasoningMessageSchema),
  responseFormat: ReasoningResponseFormatSchema.default('text'),
  /** Soft hint to the router; not a hard ceiling. */
  maxTokens: z.number().int().positive().optional(),
  /** Per-call temperature override; routers may ignore. */
  temperature: z.number().min(0).max(2).optional(),
  /** Free-form metadata: jobId, fileSha, ruleId — propagated to telemetry. */
  metadata: z.record(z.string(), z.unknown()).optional(),
});

export type ReasoningRequest = z.infer<typeof ReasoningRequestSchema>;
export type ReasoningMessage = z.infer<typeof ReasoningMessageSchema>;
export type ReasoningResponseFormat = z.infer<typeof ReasoningResponseFormatSchema>;

export const ReasoningResponseSchema = z.object({
  content: z.string(),
  provider: z.string(),
  model: z.string(),
  usage: z
    .object({
      inputTokens: z.number().int().nonnegative(),
      outputTokens: z.number().int().nonnegative(),
    })
    .optional(),
  /** Wall-clock latency in ms; for routing-policy feedback. */
  latencyMs: z.number().nonnegative(),
});

export type ReasoningResponse = z.infer<typeof ReasoningResponseSchema>;

export const ReasoningChunkSchema = z.object({
  delta: z.string(),
  finishReason: z.enum(['stop', 'length', 'tool_use', 'content_filter']).optional(),
});

export type ReasoningChunk = z.infer<typeof ReasoningChunkSchema>;

export interface LlmCapabilities {
  /** Maximum input tokens supported by the underlying model. */
  contextWindow: number;
  /** Does the underlying API support function/tool calling? */
  supportsTools: boolean;
  /** Does this adapter stream chunks? */
  supportsStreaming: boolean;
  /** Provider identifier — "mcp" | "groq" | "gemini" | "watsonx" | ... */
  provider: string;
  /** Model identifier inside the provider. */
  model: string;
}

export interface LlmAdapter {
  reason(req: ReasoningRequest): Promise<ReasoningResponse>;
  stream(req: ReasoningRequest): AsyncIterable<ReasoningChunk>;
  capabilities(): LlmCapabilities;
}
