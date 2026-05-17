'use client';

import { useState } from 'react';

/**
 * Tiny client island: a button that copies `value` to the system clipboard
 * and shows a transient "Copied!" affordance for 1.5s.
 *
 * Pure client. Used in RSC pages to add interactivity without converting the
 * whole tree to a client component. Safe to instantiate many times — each
 * instance owns its own state.
 *
 * Falls back gracefully if `navigator.clipboard` is unavailable (older
 * browsers, insecure contexts) — the button still renders, but the click is
 * a no-op and we surface a brief "Copy failed" badge so the user knows.
 */
interface CopyButtonProps {
  value: string;
  label?: string;
  /** Short variant — renders just an icon-sized button. */
  compact?: boolean;
}

export default function CopyButton({
  value,
  label = 'Copy',
  compact = false,
}: CopyButtonProps) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  const onClick = async (): Promise<void> => {
    try {
      if (typeof navigator === 'undefined' || !navigator.clipboard) {
        setState('failed');
      } else {
        await navigator.clipboard.writeText(value);
        setState('copied');
      }
    } catch {
      setState('failed');
    }
    // Reset back to idle so the button is reusable.
    window.setTimeout(() => setState('idle'), 1500);
  };

  const text =
    state === 'copied'
      ? 'Copied!'
      : state === 'failed'
        ? 'Copy failed'
        : label;

  return (
    <button
      type="button"
      onClick={() => void onClick()}
      aria-label={`Copy ${value}`}
      style={{
        background: 'transparent',
        border: '1px solid var(--border)',
        borderRadius: '6px',
        padding: compact ? '0.125rem 0.375rem' : '0.25rem 0.625rem',
        fontSize: compact ? '0.6875rem' : '0.8125rem',
        color:
          state === 'copied'
            ? 'var(--success)'
            : state === 'failed'
              ? 'var(--error)'
              : 'var(--text-dim)',
        cursor: 'pointer',
        fontFamily: 'inherit',
        whiteSpace: 'nowrap',
      }}
    >
      {text}
    </button>
  );
}

// Made with Bob
