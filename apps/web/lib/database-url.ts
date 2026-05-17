/**
 * Resolve the Neon connection string for server-side code in apps/web. We
 * fail loudly at the top of any request handler that needs it — silently
 * proceeding with an empty string yields a confusing `relation does not
 * exist` deep inside drizzle.
 *
 * Why a helper: the route handlers all want the same thing, and a single
 * place for the error message makes troubleshooting trivial.
 */
export function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url || url.trim() === '') {
    throw new Error(
      'DATABASE_URL is not set. The web app needs a Neon postgres URL to create job rows. Set it in apps/web/.env.local or your deployment environment.',
    );
  }
  return url;
}
