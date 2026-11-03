import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

type Leave = () => void;

/**
 * Guards unsaved edits under BrowserRouter, which has no data-router useBlocker.
 * - In-app links: clicks are intercepted in the capture phase, before React Router's Link handler runs.
 * - Browser Back: while dirty, the current entry is duplicated (a "sentinel"), so Back first lands on this same page and can be
 *   confirmed; pushing the sentinel also clears the forward stack, so Forward cannot discard edits either.
 * - Refresh/close: the native beforeunload prompt (browsers do not allow a custom dialog there).
 * `leave(run)` removes the sentinel before running a navigation, so confirmed exits and saves leave no duplicate history entry.
 */
export function useUnsavedChangesGuard(dirty: boolean) {
  const navigate = useNavigate();
  const [pending, setPending] = useState<{ leave: Leave } | null>(null);
  const armed = useRef(false);
  const afterPop = useRef<Leave | null>(null);
  // Set once the admin confirms leaving, so a Back that crosses into another document is not asked twice (in-app dialog, then beforeunload).
  const released = useRef(false);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  const arm = useCallback(() => {
    if (armed.current) return;
    window.history.pushState(window.history.state, '', window.location.href);
    armed.current = true;
  }, []);

  const leave = useCallback((run: Leave) => {
    if (!armed.current) { run(); return; }
    afterPop.current = run;
    window.history.back();
  }, []);

  useEffect(() => { if (dirty) arm(); }, [dirty, arm]);

  useEffect(() => {
    const onPop = () => {
      if (afterPop.current) { const run = afterPop.current; afterPop.current = null; armed.current = false; run(); return; }
      if (!armed.current) return;
      // Back left the sentinel: the browser is now on this page's original entry.
      armed.current = false;
      if (!dirtyRef.current) { window.history.back(); return; }
      setPending({ leave: () => window.history.back() });
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => { if (!released.current) event.preventDefault(); };
    const guardLinks = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      const link = (event.target as Element | null)?.closest?.('a[href]');
      if (!(link instanceof HTMLAnchorElement) || (link.target && link.target !== '_self') || link.origin !== window.location.origin) return;
      if (link.pathname === window.location.pathname && link.search === window.location.search) return;
      event.preventDefault();
      event.stopPropagation();
      const to = `${link.pathname}${link.search}${link.hash}`;
      setPending({ leave: () => leave(() => navigate(to)) });
    };
    window.addEventListener('beforeunload', warn);
    document.addEventListener('click', guardLinks, true);
    return () => { window.removeEventListener('beforeunload', warn); document.removeEventListener('click', guardLinks, true); };
  }, [dirty, leave, navigate]);

  /** Props for the page's ConfirmDialog. Staying re-arms the Back guard. */
  const dialog = {
    open: Boolean(pending),
    onOpenChange: (open: boolean) => { if (!open) { setPending(null); released.current = false; if (dirtyRef.current) arm(); } },
    onConfirm: () => { const run = pending?.leave; setPending(null); released.current = true; run?.(); },
  };
  return { dialog, leave };
}
