import { z } from 'zod';

// Core type schemas
export const SemverRangeSchema = z.string().regex(/^\d+(\.\d+)?(\.\d+)?([.\-+].*)?$/);
export const EcosystemSchema = z.enum(['npm', 'pypi', 'cargo', 'maven']);
export const SeveritySchema = z.enum(['low', 'medium', 'high', 'critical']);
export const ConfidenceSchema = z.number().min(0).max(1);

// Job state machine
export const JobStateSchema = z.enum([
  'draft',
  'planning',
  'planned',
  'cloning',
  'cloned',
  'indexing',
  'indexed',
  'patching',
  'patched',
  'testing',
  'tested',
  'auditing',
  'audited',
  'done',
  'failed',
  'aborted',
  'paused',
]);

export type JobState = z.infer<typeof JobStateSchema>;
export type Ecosystem = z.infer<typeof EcosystemSchema>;
export type Severity = z.infer<typeof SeveritySchema>;

// Made with Bob
