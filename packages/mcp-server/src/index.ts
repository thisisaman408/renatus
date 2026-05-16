#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { pingTool, PingInputSchema } from './tools/ping.js';
import { llmTestTool, LlmTestInputSchema } from './tools/llm-test.js';
import { initializeAudit, withAudit } from './audit.js';

// Initialize audit system if DATABASE_URL is available
if (process.env.DATABASE_URL) {
  try {
    initializeAudit(process.env.DATABASE_URL);
    console.error('Audit system initialized');
  } catch (error) {
    console.error('Failed to initialize audit system:', error);
  }
} else {
  console.error('DATABASE_URL not set - audit logging disabled');
}

const server = new Server(
  {
    name: 'renatus-mcp',
    version: '0.1.0',
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// List available tools
server.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: 'ping',
        description: 'Test connectivity to Renatus MCP server',
        inputSchema: {
          type: 'object',
          properties: {
            message: {
              type: 'string',
              description: 'Optional message to echo back',
            },
          },
        },
      },
      {
        name: 'llm_test',
        description: 'Test LLM routing by sending a prompt through the LlmRouter',
        inputSchema: {
          type: 'object',
          properties: {
            prompt: {
              type: 'string',
              description: 'The prompt to send to the LLM',
            },
          },
          required: ['prompt'],
        },
      },
    ],
  };
});

// Wrap tools with audit logging
const auditedPingTool = withAudit('ping', pingTool);
const auditedLlmTestTool = withAudit('llm_test', llmTestTool);

// Handle tool calls
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;

  if (name === 'ping') {
    const validated = PingInputSchema.parse(args ?? {});
    const result = await auditedPingTool(validated);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  if (name === 'llm_test') {
    const validated = LlmTestInputSchema.parse(args ?? {});
    const result = await auditedLlmTestTool(validated);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  throw new Error(`Unknown tool: ${name}`);
});

// Start server
async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error('Renatus MCP server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

// Made with Bob
