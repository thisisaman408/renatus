#!/usr/bin/env node
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import { pingTool, PingInputSchema } from './tools/ping.js';
import { llmTestTool, LlmTestInputSchema } from './tools/llm-test.js';
import { cartographTool, CartographInputSchema } from './tools/cartograph.js';
import {
  cloneRepositoryTool,
  CloneRepositoryInputSchema,
} from './tools/clone-repository.js';
import {
  indexRepositoryTool,
  IndexRepositoryInputSchema,
} from './tools/index-repository.js';
import { planChangeTool, PlanChangeInputSchema } from './tools/plan-change.js';
import {
  findAffectedFilesTool,
  FindAffectedFilesInputSchema,
} from './tools/find-affected-files.js';
import {
  proposePatchTool,
  ProposePatchInputSchema,
} from './tools/propose-patch.js';
import {
  applyPatchTool,
  ApplyPatchInputSchema,
} from './tools/apply-patch.js';
import {
  migrateRepositoryTool,
  MigrateRepositoryInputSchema,
} from './tools/migrate-repository.js';
import {
  refactorRepositoryTool,
  RefactorRepositoryInputSchema,
} from './tools/refactor-repository.js';
import {
  securityAuditRepositoryTool,
  SecurityAuditRepositoryInputSchema,
} from './tools/security-audit-repository.js';
import {
  auditRepositoryTool,
  AuditRepositoryInputSchema,
} from './tools/audit-repository.js';
import {
  examineTool,
  ExamineInputSchema,
} from './tools/examine.js';
import {
  queryCodebaseTool,
  QueryCodebaseInputSchema,
} from './tools/query-codebase.js';
import { initializeAudit, withAudit } from './audit.js';
import { setMcpServer } from '@renatus/llm';

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
      {
        name: 'cartograph_repository',
        description: 'Generate a migration plan for a repository by analyzing breaking changes between versions',
        inputSchema: {
          type: 'object',
          properties: {
            jobId: {
              type: 'string',
              description: 'UUID of the job to associate with this plan',
            },
            ecosystem: {
              type: 'string',
              enum: ['npm', 'pypi', 'cargo', 'maven', 'gradle'],
              description: 'Package ecosystem',
            },
            fromVersion: {
              type: 'string',
              description: 'Source version to migrate from (e.g., "18.0.0")',
            },
            toVersion: {
              type: 'string',
              description: 'Target version to migrate to (e.g., "19.0.0")',
            },
          },
          required: ['jobId', 'ecosystem', 'fromVersion', 'toVersion'],
        },
      },
      {
        name: 'clone_repository',
        description:
          'Clone a remote GitHub repository (or copy a local file:// fixture) into a per-job workspace and persist a repo_snapshots row.',
        inputSchema: {
          type: 'object',
          properties: {
            jobId: {
              type: 'string',
              description: 'UUID of the job owning this snapshot',
            },
            repoUrl: {
              type: 'string',
              description:
                'https://, git@, or file:// URL of the source repository',
            },
            ref: {
              type: 'string',
              description: "Branch, tag, or commit SHA. Defaults to 'main'",
            },
          },
          required: ['jobId', 'repoUrl'],
        },
      },
      {
        name: 'plan_change',
        description:
          'Cartographer — synthesize a Rule[] from EITHER a bundled rule pack (mode=pack) OR a free-form upstream source like a changelog, diff, guide URL, refactor intent, or CVE advisory (mode=source, LLM-driven). Results are cached by sha256 of inputs.',
        inputSchema: {
          type: 'object',
          oneOf: [
            {
              type: 'object',
              properties: {
                mode: { type: 'string', const: 'pack' },
                agentKind: {
                  type: 'string',
                  enum: ['migrate', 'refactor', 'security_audit', 'qa'],
                  default: 'migrate',
                },
                ecosystem: {
                  type: 'string',
                  enum: ['npm', 'pypi', 'pip', 'cargo', 'maven', 'gradle'],
                },
                fromVersion: { type: 'string' },
                toVersion: { type: 'string' },
                jobId: { type: 'string', format: 'uuid' },
              },
              required: ['mode', 'ecosystem', 'fromVersion', 'toVersion'],
            },
            {
              type: 'object',
              properties: {
                mode: { type: 'string', const: 'source' },
                agentKind: {
                  type: 'string',
                  enum: ['migrate', 'refactor', 'security_audit', 'qa'],
                },
                sourceKind: {
                  type: 'string',
                  enum: [
                    'changelog',
                    'diff',
                    'guide-url',
                    'refactor-intent',
                    'cve-advisory',
                  ],
                },
                sourceText: { type: 'string', minLength: 1 },
                ecosystem: {
                  type: 'string',
                  enum: ['npm', 'pypi', 'pip', 'cargo', 'maven', 'gradle'],
                },
                fromVersion: { type: 'string' },
                toVersion: { type: 'string' },
                jobId: { type: 'string', format: 'uuid' },
              },
              required: ['mode', 'agentKind', 'sourceKind', 'sourceText'],
            },
          ],
        },
      },
      {
        name: 'index_repository',
        description:
          "Walk a cloned snapshot's working tree, parse TS/JS modules with ts-morph, and persist files, import edges, and top-level symbols.",
        inputSchema: {
          type: 'object',
          properties: {
            snapshotId: {
              type: 'string',
              description: 'UUID of the persisted repo_snapshots row to index',
            },
            localPath: {
              type: 'string',
              description: 'Absolute path to the cloned working tree',
            },
          },
          required: ['snapshotId', 'localPath'],
        },
      },
      {
        name: 'find_affected_files',
        description:
          'RetrievalService — given Cartographer-emitted rules and an indexed snapshot, return import-coherent file batches for the Surgeon. Detector regexes seed batches; the import-graph CTE expands them via ancestors; union-find groups coherent clusters.',
        inputSchema: {
          type: 'object',
          properties: {
            snapshotId: {
              type: 'string',
              description: 'UUID of the indexed snapshot',
            },
            localPath: {
              type: 'string',
              description: 'Absolute path to the cloned working tree',
            },
            rules: {
              type: 'array',
              items: { type: 'object' },
              description:
                'Rule[] emitted by the Cartographer (validated server-side by Zod against the discriminated union)',
            },
            maxBatchSize: {
              type: 'number',
              description:
                'Max files per batch. Defaults to 6 (fits a Groq 32k context with rules + system prompt).',
            },
          },
          required: ['snapshotId', 'localPath', 'rules'],
        },
      },
      {
        name: 'propose_patch',
        description:
          'SurgeonService — given a FileBatch (from find_affected_files), the rule subset attributed to that batch, and an agentKind, drive the LLM → ts-morph-validate → retry-with-feedback loop and emit proposed Patch rows. persist=false runs the full pipeline without writing to the DB (dry-run).',
        inputSchema: {
          type: 'object',
          properties: {
            jobId: { type: 'string', format: 'uuid' },
            batch: {
              type: 'object',
              description:
                'FileBatch shape from find_affected_files (id, snapshotId, files[], ruleIds[]).',
            },
            rules: {
              type: 'array',
              items: { type: 'object' },
              description:
                'Rule[] emitted by the Cartographer (validated server-side by Zod against the discriminated union).',
            },
            agentKind: {
              type: 'string',
              enum: ['migrate', 'refactor', 'security_audit'],
              description: 'qa is rejected — it uses the QA pipeline.',
            },
            persist: {
              type: 'boolean',
              description:
                'When true (default), bulk-insert proposed patches. When false, run a dry-run and return the patches only.',
            },
          },
          required: ['jobId', 'batch', 'rules', 'agentKind'],
        },
      },
      {
        name: 'examine',
        description:
          'ExaminerService — for each patched file (status proposed|applied), generate a regression test (snapshot for migrate/refactor, cve-replay for security_audit) using the LLM with ts-morph syntactic validation and retry-with-feedback (max 2 retries). Framework is auto-detected from the snapshot\'s package.json. persist=false runs the full pipeline without writing to the DB (dry-run).',
        inputSchema: {
          type: 'object',
          properties: {
            jobId: { type: 'string', format: 'uuid' },
            snapshotId: { type: 'string', format: 'uuid' },
            localPath: {
              type: 'string',
              description: 'Absolute path to the snapshot working tree (used for framework detection).',
            },
            agentKind: {
              type: 'string',
              enum: ['migrate', 'refactor', 'security_audit'],
              description: 'qa is rejected — it uses the QA pipeline.',
            },
            patches: {
              type: 'array',
              items: { type: 'object' },
              description:
                'Optional. When omitted, the tool loads patches via PatchRepository.getByJob(jobId). Pass explicitly only for dry-runs / preview flows.',
            },
            persist: {
              type: 'boolean',
              description:
                'When true (default), bulk-insert generated tests. When false, run a dry-run and return the tests only.',
            },
          },
          required: ['jobId', 'snapshotId', 'localPath', 'agentKind'],
        },
      },
      {
        name: 'audit_repository',
        description:
          'Auditor — load the per-job audit_events log, resolve (or create) the job\'s ed25519 keypair, and emit a canonical-JSON, SHA-256-hashed, ed25519-signed AuditReport. Sandbox replay of the migrated repo is a Wave 4 deliverable; this tool signs the event log only.',
        inputSchema: {
          type: 'object',
          properties: {
            jobId: {
              type: 'string',
              format: 'uuid',
              description: 'UUID of the job to audit',
            },
            snapshotId: {
              type: 'string',
              format: 'uuid',
              description: 'UUID of the snapshot the job operated on',
            },
          },
          required: ['jobId', 'snapshotId'],
        },
      },
      {
        name: 'migrate_repository',
        description:
          'Tier-1 orchestrator entrypoint. Creates a jobs row and fires the renatus/migrate.requested Inngest event that runs the full clone → index → cartograph → retrieve → patch pipeline asynchronously. Returns { jobId, eventId, sseUrl, status:"queued" } immediately — progress is observed via the SSE URL (Wave 4) and the jobs.state column.',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: {
              type: 'string',
              format: 'uuid',
              description: 'MCP session id; auto-created if not provided.',
            },
            bobTaskId: {
              type: 'string',
              description: 'Bob task id to stamp on the MCP session row.',
            },
            repoUrl: {
              type: 'string',
              description:
                'https://, git@, or file:// URL of the source repository.',
            },
            ref: {
              type: 'string',
              description: "Branch, tag, or commit SHA. Defaults to 'main'.",
            },
            ecosystem: {
              type: 'string',
              enum: ['npm', 'pypi', 'pip', 'cargo', 'maven', 'gradle'],
            },
            fromVersion: { type: 'string' },
            toVersion: { type: 'string' },
            agentKind: {
              type: 'string',
              enum: ['migrate', 'refactor', 'security_audit', 'qa'],
              default: 'migrate',
            },
            ruleSource: {
              description:
                "Rule synthesis source. 'pack' uses the bundled (ecosystem, from, to) rule pack; the source-kinds drive Path B (LLM-synthesized Rule[]).",
              default: { kind: 'pack' },
              oneOf: [
                {
                  type: 'object',
                  properties: { kind: { type: 'string', const: 'pack' } },
                  required: ['kind'],
                },
                {
                  type: 'object',
                  properties: {
                    kind: { type: 'string', const: 'changelog' },
                    sourceText: { type: 'string', minLength: 1 },
                  },
                  required: ['kind', 'sourceText'],
                },
                {
                  type: 'object',
                  properties: {
                    kind: { type: 'string', const: 'diff' },
                    sourceText: { type: 'string', minLength: 1 },
                  },
                  required: ['kind', 'sourceText'],
                },
                {
                  type: 'object',
                  properties: {
                    kind: { type: 'string', const: 'guide-url' },
                    sourceText: { type: 'string', minLength: 1 },
                  },
                  required: ['kind', 'sourceText'],
                },
                {
                  type: 'object',
                  properties: {
                    kind: { type: 'string', const: 'refactor-intent' },
                    sourceText: { type: 'string', minLength: 1 },
                  },
                  required: ['kind', 'sourceText'],
                },
                {
                  type: 'object',
                  properties: {
                    kind: { type: 'string', const: 'cve-advisory' },
                    sourceText: { type: 'string', minLength: 1 },
                  },
                  required: ['kind', 'sourceText'],
                },
              ],
            },
          },
          required: ['repoUrl', 'ecosystem', 'fromVersion', 'toVersion'],
        },
      },
      {
        name: 'refactor_repository',
        description:
          'Tier-1 orchestrator entrypoint for refactor agents. Creates a jobs row and fires the renatus/refactor.requested Inngest event that runs the full clone → index → cartograph (planFromSource, sourceKind=refactor-intent) → retrieve → patch pipeline asynchronously. Returns { jobId, eventId, sseUrl, status:"queued" } immediately — progress is observed via the SSE URL (Wave 4) and the jobs.state column.',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: {
              type: 'string',
              format: 'uuid',
              description: 'MCP session id; auto-created if not provided.',
            },
            bobTaskId: {
              type: 'string',
              description: 'Bob task id to stamp on the MCP session row.',
            },
            repoUrl: {
              type: 'string',
              description:
                'https://, git@, or file:// URL of the source repository.',
            },
            ref: {
              type: 'string',
              description: "Branch, tag, or commit SHA. Defaults to 'main'.",
            },
            intent: {
              type: 'string',
              minLength: 1,
              description:
                "Natural-language refactor intent. Example: 'Rename getUser to loadUser across the entire codebase'.",
            },
            ecosystem: {
              type: 'string',
              enum: ['npm', 'pypi', 'pip', 'cargo', 'maven', 'gradle'],
              default: 'npm',
            },
          },
          required: ['repoUrl', 'intent'],
        },
      },
      {
        name: 'security_audit_repository',
        description:
          'Tier-1 orchestrator entrypoint for security audit agents. Creates a jobs row and fires the renatus/security-audit.requested Inngest event that runs the full clone → index → cartograph (planFromSource, sourceKind=cve-advisory) → retrieve → patch pipeline asynchronously. Accepts either a CVE id (fetched from NVD) or raw advisory text. Returns { jobId, eventId, sseUrl, status:"queued" } immediately — progress is observed via the SSE URL (Wave 4) and the jobs.state column.',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: {
              type: 'string',
              format: 'uuid',
              description: 'MCP session id; auto-created if not provided.',
            },
            bobTaskId: {
              type: 'string',
              description: 'Bob task id to stamp on the MCP session row.',
            },
            repoUrl: {
              type: 'string',
              description:
                'https://, git@, or file:// URL of the source repository.',
            },
            ref: {
              type: 'string',
              description: "Branch, tag, or commit SHA. Defaults to 'main'.",
            },
            cveSource: {
              description:
                'Either a CVE id (fetched from NVD) or raw advisory text. NOT both.',
              oneOf: [
                {
                  type: 'object',
                  properties: {
                    kind: { type: 'string', const: 'cve-id' },
                    cveId: {
                      type: 'string',
                      pattern: '^CVE-\\d{4}-\\d+$',
                      description: 'CVE identifier (e.g., CVE-2024-12345)',
                    },
                  },
                  required: ['kind', 'cveId'],
                },
                {
                  type: 'object',
                  properties: {
                    kind: { type: 'string', const: 'advisory-text' },
                    advisoryText: {
                      type: 'string',
                      minLength: 1,
                      description:
                        'Raw advisory text (CVE description, security bulletin, etc.)',
                    },
                  },
                  required: ['kind', 'advisoryText'],
                },
              ],
            },
            ecosystem: {
              type: 'string',
              enum: ['npm', 'pypi', 'pip', 'cargo', 'maven', 'gradle'],
              default: 'npm',
            },
          },
          required: ['repoUrl', 'cveSource'],
        },
      },
      {
        name: 'query_codebase',
        description:
          'Tier-1 orchestrator entrypoint for the Codebase Q&A agent. Creates a jobs row and fires the renatus/qa.requested Inngest event that runs the read-only clone → index → ask pipeline asynchronously. The Q&A agent retrieves candidate files by keyword scoring (path / basename / content), calls the LLM with cited context, and signs the transcript with ed25519. Returns { jobId, eventId, sseUrl, status:"queued" } immediately — progress is observed via the SSE URL (Wave 4) and the jobs.state column.',
        inputSchema: {
          type: 'object',
          properties: {
            sessionId: {
              type: 'string',
              format: 'uuid',
              description: 'MCP session id; auto-created if not provided.',
            },
            bobTaskId: {
              type: 'string',
              description: 'Bob task id to stamp on the MCP session row.',
            },
            repoUrl: {
              type: 'string',
              description:
                'https://, git@, or file:// URL of the source repository.',
            },
            ref: {
              type: 'string',
              description: "Branch, tag, or commit SHA. Defaults to 'main'.",
            },
            question: {
              type: 'string',
              minLength: 1,
              description:
                "Natural-language question about the codebase. Example: 'Where is the auth middleware composed?'",
            },
          },
          required: ['repoUrl', 'question'],
        },
      },
      {
        name: 'apply_patch',
        description:
          'Write a proposed Patch.after to disk under its snapshot working tree and flip its status to "applied". Deliberate orchestrator/human-in-the-loop commit step — the Surgeon never auto-applies.',
        inputSchema: {
          type: 'object',
          properties: {
            patchId: { type: 'string', format: 'uuid' },
          },
          required: ['patchId'],
        },
      },
    ],
  };
});

// Wrap tools with audit logging
const auditedPingTool = withAudit('ping', pingTool);
const auditedLlmTestTool = withAudit('llm_test', llmTestTool);
const auditedCartographTool = withAudit('cartograph_repository', (input: any) => { // rationale: input type validated by Zod schema before calling
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for cartograph_repository tool');
  }
  return cartographTool(input, process.env.DATABASE_URL);
});
const auditedCloneRepositoryTool = withAudit('clone_repository', (input: any) => { // rationale: input type validated by Zod schema before calling
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for clone_repository tool');
  }
  return cloneRepositoryTool(input, process.env.DATABASE_URL);
});
const auditedIndexRepositoryTool = withAudit('index_repository', (input: any) => { // rationale: input type validated by Zod schema before calling
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for index_repository tool');
  }
  return indexRepositoryTool(input, process.env.DATABASE_URL);
});
const auditedPlanChangeTool = withAudit('plan_change', (input: any) => { // rationale: input type validated by Zod schema before calling
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for plan_change tool');
  }
  return planChangeTool(input, process.env.DATABASE_URL);
});
const auditedFindAffectedFilesTool = withAudit('find_affected_files', (input: any) => { // rationale: input type validated by Zod schema before calling
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for find_affected_files tool');
  }
  return findAffectedFilesTool(input, process.env.DATABASE_URL);
});
const auditedProposePatchTool = withAudit('propose_patch', (input: any) => { // rationale: input type validated by Zod schema before calling
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for propose_patch tool');
  }
  return proposePatchTool(input, process.env.DATABASE_URL);
});
const auditedApplyPatchTool = withAudit('apply_patch', (input: any) => { // rationale: input type validated by Zod schema before calling
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for apply_patch tool');
  }
  return applyPatchTool(input, process.env.DATABASE_URL);
});
const auditedMigrateRepositoryTool = withAudit('migrate_repository', (input: any) => { // rationale: input type validated by Zod schema before calling
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for migrate_repository tool');
  }
  return migrateRepositoryTool(input, process.env.DATABASE_URL);
});
const auditedRefactorRepositoryTool = withAudit('refactor_repository', (input: any) => { // rationale: input type validated by Zod schema before calling
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for refactor_repository tool');
  }
  return refactorRepositoryTool(input, process.env.DATABASE_URL);
});
const auditedSecurityAuditRepositoryTool = withAudit('security_audit_repository', (input: any) => { // rationale: input type validated by Zod schema before calling
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for security_audit_repository tool');
  }
  return securityAuditRepositoryTool(input, process.env.DATABASE_URL);
});
const auditedAuditRepositoryTool = withAudit('audit_repository', (input: any) => { // rationale: input type validated by Zod schema before calling
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for audit_repository tool');
  }
  return auditRepositoryTool(input, process.env.DATABASE_URL);
});
const auditedExamineTool = withAudit('examine', (input: any) => { // rationale: input type validated by Zod schema before calling
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for examine tool');
  }
  return examineTool(input, process.env.DATABASE_URL);
});
const auditedQueryCodebaseTool = withAudit('query_codebase', (input: any) => { // rationale: input type validated by Zod schema before calling
  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL is required for query_codebase tool');
  }
  return queryCodebaseTool(input, process.env.DATABASE_URL);
});

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

  if (name === 'cartograph_repository') {
    const validated = CartographInputSchema.parse(args ?? {});
    const result = await auditedCartographTool(validated);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  if (name === 'clone_repository') {
    const validated = CloneRepositoryInputSchema.parse(args ?? {});
    const result = await auditedCloneRepositoryTool(validated);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  if (name === 'plan_change') {
    const validated = PlanChangeInputSchema.parse(args ?? {});
    const result = await auditedPlanChangeTool(validated);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  if (name === 'index_repository') {
    const validated = IndexRepositoryInputSchema.parse(args ?? {});
    const result = await auditedIndexRepositoryTool(validated);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  if (name === 'find_affected_files') {
    const validated = FindAffectedFilesInputSchema.parse(args ?? {});
    const result = await auditedFindAffectedFilesTool(validated);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  if (name === 'propose_patch') {
    const validated = ProposePatchInputSchema.parse(args ?? {});
    const result = await auditedProposePatchTool(validated);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  if (name === 'apply_patch') {
    const validated = ApplyPatchInputSchema.parse(args ?? {});
    const result = await auditedApplyPatchTool(validated);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  if (name === 'audit_repository') {
    const validated = AuditRepositoryInputSchema.parse(args ?? {});
    const result = await auditedAuditRepositoryTool(validated);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  if (name === 'migrate_repository') {
    const validated = MigrateRepositoryInputSchema.parse(args ?? {});
    const result = await auditedMigrateRepositoryTool(validated);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  if (name === 'refactor_repository') {
    const validated = RefactorRepositoryInputSchema.parse(args ?? {});
    const result = await auditedRefactorRepositoryTool(validated);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  if (name === 'security_audit_repository') {
    const validated = SecurityAuditRepositoryInputSchema.parse(args ?? {});
    const result = await auditedSecurityAuditRepositoryTool(validated);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  if (name === 'examine') {
    const validated = ExamineInputSchema.parse(args ?? {});
    const result = await auditedExamineTool(validated);
    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify(result, null, 2),
        },
      ],
    };
  }

  if (name === 'query_codebase') {
    const validated = QueryCodebaseInputSchema.parse(args ?? {});
    const result = await auditedQueryCodebaseTool(validated);
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
  // Register the live Server with the McpElicitationAdapter singleton so the
  // LlmRouter can reach the host LLM via sampling/createMessage when
  // MCP_ENABLE_ELICITATION=true. Stand-alone callers skip this path entirely
  // because the router never registers the adapter without the env flag.
  setMcpServer(server);
  console.error('Renatus MCP server running on stdio');
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

// Made with Bob
