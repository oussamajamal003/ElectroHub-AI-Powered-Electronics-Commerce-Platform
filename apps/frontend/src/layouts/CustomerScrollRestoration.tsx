import { useLayoutEffect, useRef } from 'react';
import { useLocation, useNavigationType } from 'react-router-dom';

const positions = new Map<string, number>();
const routePositions = new Map<string, number>();
const routeKey = (pathname: string, search: string) => `${pathname}${search}`;

const setWindowScroll = (y: number) => {
  try {
    window.scrollTo({ top: y, left: 0, behavior: 'instant' });
  } catch (_error) {
    void _error;
  }
  if (typeof window !== 'undefined' && window.scrollY !== y) {
    window.scrollTo(0, y);
  }
};

/** BrowserRouter stores the entry key in history.state; without one (memory routers, the initial entry) every entry counts as current. */
const isCurrentHistoryEntry = (key: string) => {
  const state: unknown = window.history.state;
  const entryKey = state !== null && typeof state === 'object' ? (state as { key?: unknown }).key : undefined;
  return typeof entryKey !== 'string' || entryKey === key;
};

const scrollToTopSmoothly = () => {
  const reduceMotion = typeof window.matchMedia === 'function' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  try {
    window.scrollTo({ top: 0, left: 0, behavior: reduceMotion ? 'auto' : 'smooth' });
  } catch (_error) {
    void _error;
  }
};

export function CustomerScrollRestoration() {
  const location = useLocation();
  const navigationType = useNavigationType();
  const initialized = useRef(false);

  useLayoutEffect(() => {
    const previousMode = window.history.scrollRestoration;
    window.history.scrollRestoration = 'manual';
    return () => { window.history.scrollRestoration = previousMode; };
  }, []);

  useLayoutEffect(() => {
    const firstVisit = !initialized.current;
    initialized.current = true;
    let frame = 0;
    let cancelled = false;
    // Payment entry/recovery must never replay a footer position from history.
    const paymentRoute = location.pathname === '/checkout' || location.pathname.startsWith('/checkout/') ||
      location.pathname.startsWith('/account/payment-status/') || location.pathname.startsWith('/account/payment-retry/');
    const smoothTop = (location.state as { smoothTop?: unknown } | null)?.smoothTop === true;
    const position = navigationType === 'POP'
      ? positions.get(location.key) ?? routePositions.get(routeKey(location.pathname, location.search))
      : undefined;
    // A navigation that is still pending (e.g. a lazy route downloading) has already moved the browser to the next history
    // entry while this page is on screen; scrolling in that window must not overwrite the position saved for this page.
    const remember = () => {
      if (!isCurrentHistoryEntry(location.key)) return;
      positions.set(location.key, window.scrollY);
      routePositions.set(routeKey(location.pathname, location.search), window.scrollY);
    };
    if (paymentRoute) {
      setWindowScroll(0);
      frame = window.requestAnimationFrame(() => {
        if (!cancelled) { setWindowScroll(0); remember(); }
      });
    } else if (position !== undefined) {
      frame = window.requestAnimationFrame(() => {
        if (!cancelled) { setWindowScroll(position); remember(); }
      });
    } else if (smoothTop && navigationType !== 'POP') {
      scrollToTopSmoothly();
    } else if (firstVisit || navigationType === 'PUSH') {
      setWindowScroll(0);
    }
    // Record the settled position now, so a page that is never scrolled keeps it after the cleanup below stops recording.
    if (position === undefined) remember();

    window.addEventListener('scroll', remember, { passive: true });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      remember();
      window.removeEventListener('scroll', remember);
    };
  }, [location.key, location.pathname, location.search, location.state, navigationType]);

  return null;
}
