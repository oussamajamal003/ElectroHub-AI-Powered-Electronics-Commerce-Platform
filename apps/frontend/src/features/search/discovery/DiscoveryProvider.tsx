import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { DiscoveryContext, type DiscoveryOpenOptions } from './context';
import { DiscoveryConsole } from './DiscoveryConsole';

// An editable target that owns Ctrl/⌘+K itself (rich editors) keeps the chord; plain inputs and the page let it open search.
const ownsShortcut = (target: EventTarget | null) => target instanceof HTMLElement &&
  (target.isContentEditable || target.closest('[data-own-shortcuts]') !== null);

/** `disabled` (e.g. while a payment is locking the shell) blocks opening and closes an open console. */
export function DiscoveryProvider({ children, disabled = false }: { children: ReactNode; disabled?: boolean }) {
  const [session, setSession] = useState<(DiscoveryOpenOptions & { key: number }) | null>(null);
  const open = useCallback((options: DiscoveryOpenOptions = {}) => {
    if (!disabled) setSession(current => current ?? { ...options, key: Date.now() });
  }, [disabled]);
  const close = useCallback(() => setSession(null), []);
  useEffect(() => { if (disabled) setSession(null); }, [disabled]);
  useEffect(() => {
    if (disabled) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'k' || !(event.metaKey || event.ctrlKey) || event.altKey || event.shiftKey) return;
      if (event.defaultPrevented || ownsShortcut(event.target)) return;
      event.preventDefault();
      setSession(current => current ? null : { key: Date.now() });
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [disabled]);
  const value = useMemo(() => ({ open, isOpen: session !== null }), [open, session]);
  return <DiscoveryContext.Provider value={value}>
    {children}
    {session && <DiscoveryConsole key={session.key} initialMode={session.mode ?? 'text'} initialQuery={session.query ?? ''}
      startCamera={session.camera ?? false} onClose={close} />}
  </DiscoveryContext.Provider>;
}
