import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';

type Leave = () => void;

// Marks the guard's own duplicate history entry, so it is never confused with a real one, even by a remounted form.
const MARK = 'ehUnsavedGuard';
const onGuardEntry = () => (window.history.state as Record<string, unknown> | null)?.[MARK] === true;

/**
 * Guards unsaved edits under BrowserRouter, which has no data-router useBlocker.
 * - In-app links: clicks are intercepted in the capture phase, before React Router's Link handler runs.
 * - Browser Back: while dirty, the current entry is duplicated (a marked "guard entry"), so Back first lands on this same page and can be
 *   confirmed; pushing it also clears the forward stack, so Forward cannot discard edits either.
 * - Refresh/close: the native beforeunload prompt (browsers do not allow a custom dialog there).
 * The guard entry exists only while the form is dirty: when the form becomes clean (saved, reverted, or remounted from a newer version)
 * it is removed, and `leave(run)` removes it before running a navigation, so history never keeps an extra step.
 */
export function useUnsavedChangesGuard(dirty: boolean) {
  const navigate = useNavigate();
  const [pending, setPending] = useState<{ leave: Leave } | null>(null);
  const afterPop = useRef<Leave | null>(null);
  const atGuardEntry = useRef(onGuardEntry());
  // Set once the admin confirms leaving, so a Back that crosses into another document is not asked twice (in-app dialog, then beforeunload).
  const released = useRef(false);
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  const arm = useCallback(() => {
    if (onGuardEntry()) return;
    window.history.pushState({ ...(window.history.state as object | null), [MARK]: true }, '', window.location.href);
    atGuardEntry.current = true;
  }, []);

  /** Runs `run` once the guard entry (if this page is on one) has been removed with a single Back. */
  const leave = useCallback((run: Leave) => {
    if (afterPop.current) { const previous = afterPop.current; afterPop.current = () => { previous(); run(); }; return; }
    if (!onGuardEntry()) { run(); return; }
    afterPop.current = run;
    window.history.back();
  }, []);

  useEffect(() => {
    if (dirty) arm();
    else leave(() => undefined);
  }, [dirty, arm, leave]);

  useEffect(() => {
    const onPop = () => {
      const leftGuardEntry = atGuardEntry.current;
      atGuardEntry.current = onGuardEntry();
      if (afterPop.current) { const run = afterPop.current; afterPop.current = null; run(); return; }
      if (atGuardEntry.current) {
        // Forward onto a guard entry: harmless while dirty; once clean it is skipped.
        if (dirtyRef.current) setPending(null); else leave(() => undefined);
        return;
      }
      // Back left the guard entry: the browser is on this page's original entry.
      if (leftGuardEntry && dirtyRef.current) setPending({ leave: () => window.history.back() });
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [leave]);

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
