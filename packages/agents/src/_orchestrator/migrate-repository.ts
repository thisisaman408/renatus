import { z } from 'zod';
import { inngest } from './client.js';

export const MigrateRepositoryEventSchema = z.object({
  jobId: z.string().uuid(),
  repoUrl: z.string().url(),
  fromVersion: z.string(),
  toVersion: z.string(),
  ecosystem: z.enum(['npm', 'pip', 'gem', 'go', 'cargo', 'maven', 'gradle']),
});

export type MigrateRepositoryEvent = z.infer<typeof MigrateRepositoryEventSchema>;

/**
 * migrateRepository — Inngest workflow stub.
 *
 * Wave 2 will fill in the actual FSM: clone → cartograph → surge → examine → audit.
 * Today it just acknowledges the event so the wiring (event → function → DB write)
 * can be verified end-to-end.
 */
export const migrateRepository = inngest.createFunction(
  { id: 'migrate-repository', name: 'Migrate Repository' },
  { event: 'renatus/migrate.requested' },
  async ({ event, step }) => {
    const parsed = MigrateRepositoryEventSchema.parse(event.data);

    await step.run('acknowledge', async () => ({
      acknowledged: true,
      jobId: parsed.jobId,
      receivedAt: new Date().toISOString(),
    }));

    return { jobId: parsed.jobId, status: 'queued' };
  },
);
