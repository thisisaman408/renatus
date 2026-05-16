import { z } from 'zod';
import { LlmRouter } from '@renatus/llm';

export const LlmTestInputSchema = z.object({
  prompt: z.string().describe('The prompt to send to the LLM'),
});

export type LlmTestInput = z.infer<typeof LlmTestInputSchema>;

export const LlmTestOutputSchema = z.object({
  response: z.string(),
  provider: z.string(),
  model: z.string(),
  latencyMs: z.number(),
  availableProviders: z.array(z.string()),
});

export type LlmTestOutput = z.infer<typeof LlmTestOutputSchema>;

/**
 * Test tool to verify LLM routing is working
 * This is a throwaway tool that will be removed in Wave 2
 */
export async function llmTestTool(input: LlmTestInput): Promise<LlmTestOutput> {
  const router = new LlmRouter();
  
  const result = await router.reason({
    messages: [
      {
        role: 'user',
        content: input.prompt,
      },
    ],
    responseFormat: 'text',
  });

  return {
    response: result.content,
    provider: result.provider,
    model: result.model,
    latencyMs: result.latencyMs,
    availableProviders: router.getAvailableProviders(),
  };
}

// Made with Bob
