import { redirect } from 'next/navigation';

/**
 * Shortcut: `/qa` → `/run?agent=qa`.
 */
export default function QaShortcutPage(): never {
  redirect('/run?agent=qa');
}
