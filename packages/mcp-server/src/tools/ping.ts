import { z } from 'zod';

export const PingInputSchema = z.object({
  message: z.string().optional().default('pong'),
});

export type PingInput = z.infer<typeof PingInputSchema>;

export const PingOutputSchema = z.object({
  response: z.string(),
  timestamp: z.string(),
  serverVersion: z.string(),
});

export type PingOutput = z.infer<typeof PingOutputSchema>;

export async function pingTool(input: PingInput): Promise<PingOutput> {
  return {
    response: input.message,
    timestamp: new Date().toISOString(),
    serverVersion: '0.1.0',
  };
}

// Made with Bob
