import { useCallback, useEffect, useRef } from 'react';
import { isRestoreTokenReady } from '@/features/auth/sessionRestore';

// Overlap protected reads with /auth/me after the server has restored a token.
// Consumers still gate presentation and cache ownership on verified identity.
export function useSessionReadBootstrap<T>(load: (signal?: AbortSignal) => Promise<T>, eligible: boolean) {
  const eligibleRef = useRef(eligible);
  eligibleRef.current = eligible;
  const pending = useRef<{ controller: AbortController; result: Promise<{ value: T } | { error: unknown }> } | null>(null);
  useEffect(() => {
    const clear = () => { pending.current?.controller.abort(); pending.current = null; };
    const start = () => {
      if (!eligibleRef.current || pending.current) return;
      const controller = new AbortController();
      pending.current = { controller, result: load(controller.signal).then(value => ({ value }), error => ({ error })) };
    };
    let mounted = true;
    // Replay readiness when the small entry restored a token before React mounted.
    // The microtask also skips StrictMode's discarded effect instance.
    queueMicrotask(() => { if (mounted && isRestoreTokenReady()) start(); });
    window.addEventListener('electrohub:session-token-ready', start);
    window.addEventListener('electrohub:session-expired', clear);
    return () => {
      mounted = false;
      window.removeEventListener('electrohub:session-token-ready', start);
      window.removeEventListener('electrohub:session-expired', clear);
      clear();
    };
  }, [load]);
  useEffect(() => {
    if (!eligible) { pending.current?.controller.abort(); pending.current = null; }
  }, [eligible]);
  return useCallback(async (signal?: AbortSignal): Promise<T> => {
    const request = pending.current;
    pending.current = null;
    if (!request) return load(signal);
    const abort = () => request.controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    try {
      const result = await request.result;
      if ('error' in result) throw result.error;
      return result.value;
    } finally { signal?.removeEventListener('abort', abort); }
  }, [load]);
}
