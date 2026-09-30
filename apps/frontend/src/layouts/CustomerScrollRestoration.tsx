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
    const position = navigationType === 'POP'
      ? positions.get(location.key) ?? routePositions.get(routeKey(location.pathname, location.search))
      : undefined;
    if (position !== undefined) {
      frame = window.requestAnimationFrame(() => {
        if (!cancelled) setWindowScroll(position);
      });
    } else if (firstVisit || navigationType === 'PUSH') {
      setWindowScroll(0);
    }

    const remember = () => {
      positions.set(location.key, window.scrollY);
      routePositions.set(routeKey(location.pathname, location.search), window.scrollY);
    };
    window.addEventListener('scroll', remember, { passive: true });
    return () => {
      cancelled = true;
      window.cancelAnimationFrame(frame);
      remember();
      window.removeEventListener('scroll', remember);
    };
  }, [location.key, location.pathname, location.search, navigationType]);

  return null;
}
