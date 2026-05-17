import { z } from 'zod';

// Core type schemas
export const SemverRangeSchema = z.string().regex(/^\d+(\.\d+)?(\.\d+)?([.\-+].*)?$/);
/**
 * Package ecosystem identifier. Standardized superset across the system.
 * - `pypi` and `pip` are both accepted (PyPI = registry, pip = client); downstream
 *   normalization happens in Task 2 when jobs/Drizzle schemas are reconciled.
 */
export const EcosystemSchema = z.enum(['npm', 'pypi', 'pip', 'cargo', 'maven', 'gradle']);
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
