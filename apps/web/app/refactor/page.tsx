import { redirect } from 'next/navigation';

/**
 * Shortcut: `/refactor` → `/run?agent=refactor`.
 */
export default function RefactorShortcutPage(): never {
  redirect('/run?agent=refactor');
}
