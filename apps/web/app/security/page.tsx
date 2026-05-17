import { redirect } from 'next/navigation';

/**
 * Shortcut: `/security` → `/run?agent=security`.
 */
export default function SecurityShortcutPage(): never {
  redirect('/run?agent=security');
}
