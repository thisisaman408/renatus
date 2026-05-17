import { redirect } from 'next/navigation';

/**
 * Shortcut: `/migrate` → `/run?agent=migrate`. Single-purpose deep-link so
 * judges (and the MCP server's tool descriptions) can point at a stable URL
 * without leaking the tabbed-form implementation detail.
 */
export default function MigrateShortcutPage(): never {
  redirect('/run?agent=migrate');
}
