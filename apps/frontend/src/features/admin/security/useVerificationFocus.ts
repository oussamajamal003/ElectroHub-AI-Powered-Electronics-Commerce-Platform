import { useEffect, useRef } from 'react';

/** Disabled verification controls lose native focus while pending. Restore it after a failed/cancelled attempt, unless the user moved on. */
export function useVerificationFocus(pending: boolean) {
  const origin = useRef<HTMLElement | null>(null);
  useEffect(() => {
    if (pending) return;
    if (origin.current?.isConnected && document.activeElement === document.body) origin.current.focus();
    origin.current = null;
  }, [pending]);
  return () => { origin.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; };
}
