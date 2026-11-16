import { useEffect } from 'react';
import { ANALYTICS_SESSION_KEY, analyticsAllowed, useChoiceStatus } from '@/features/privacy/consent';

const SESSION_KEY = ANALYTICS_SESSION_KEY;
const MIN_REPORT_MS = 1000;
/** While the tab stays visible, the running total is also sent this often, so an open tab counts before it is closed. */
export const HEARTBEAT_MS = 30_000;

/** One random id per browser tab (sessionStorage), never linked to an account or cookie; null when storage is unavailable. */
function tabSessionId(): string | null {
  try {
    const existing = window.sessionStorage.getItem(SESSION_KEY);
    if (existing && /^[0-9a-f-]{36}$/i.test(existing)) return existing;
    if (typeof crypto?.randomUUID !== 'function') return null;
    const id = crypto.randomUUID();
    window.sessionStorage.setItem(SESSION_KEY, id);
    return id;
  } catch {
    return null;
  }
}

/**
 * Task 05.2 storefront session duration: counts only the time this tab is visible and reports the running total every 30 s while
 * visible and whenever it is hidden or closed. The server keeps the largest total per tab, so repeated reports never add up.
 * Sends no URL, account or product.
 * Fire-and-forget with `keepalive` so a closing tab still delivers; failures are ignored and never affect shopping.
 */
export function useStorefrontSession(): void {
  const choice = useChoiceStatus();
  useEffect(() => {
    if (choice !== 'accepted') {
      try { sessionStorage.removeItem(SESSION_KEY); } catch { /* storage unavailable */ }
      return undefined;
    }
    const sessionId = tabSessionId();
    if (!sessionId || typeof fetch !== 'function') return undefined;
    let visibleMs = 0;
    let visibleSince: number | null = document.visibilityState === 'visible' ? performance.now() : null;
    let reportedMs = 0;

    const settle = () => {
      if (visibleSince !== null) visibleMs += performance.now() - visibleSince;
      visibleSince = null;
    };
    const report = () => {
      const total = Math.round(visibleMs);
      if (!analyticsAllowed() || total < MIN_REPORT_MS || total <= reportedMs) return;
      reportedMs = total;
      try {
        void fetch('/api/analytics/events', { method: 'POST', keepalive: true, credentials: 'omit', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'storefront.session', sessionId, visibleMs: total }) }).catch(() => undefined);
      } catch { /* analytics must never affect the storefront */ }
    };
    const onVisibility = () => {
      if (document.visibilityState === 'visible') { visibleSince ??= performance.now(); return; }
      settle();
      report();
    };
    const onPageHide = () => { settle(); report(); };
    const heartbeat = window.setInterval(() => {
      if (visibleSince === null) return;
      settle();
      visibleSince = performance.now();
      report();
    }, HEARTBEAT_MS);

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('pagehide', onPageHide);
    return () => {
      window.clearInterval(heartbeat);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      // Leaving the storefront for the admin console or checkout lock still counts the time spent so far.
      settle();
      report();
    };
  }, [choice]);
}
