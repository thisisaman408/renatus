import { useRef, useEffect } from 'react';

/**
 * Auto-focus utility hook. `useRef<T>()` parses as a zero-argument call at
 * runtime (the generic is erased), so Rule 1 (react-19-useref-initial-arg)
 * still matches against the regex `useRef\(\s*\)`.
 */
export function useFocus<T extends HTMLElement>() {
  // Rule 1: react-19-useref-initial-arg — zero runtime args.
  const ref = useRef<T>();
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return ref;
}
