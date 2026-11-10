import { useSyncExternalStore } from 'react';

export const CONSENT_KEY = 'electrohub.privacy.v1';
export const ANALYTICS_SESSION_KEY = 'eh.storefront-session';
const MAX_AGE = 180 * 24 * 60 * 60 * 1000;
type Choice = { version: 1; analytics: boolean; savedAt: number };
const listeners = new Set<() => void>();
let memory: Choice | null = null;
let memoryOnly = false;
function read(): Choice | null {
  if (memoryOnly) return memory;
  try {
    const raw = localStorage.getItem(CONSENT_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object') return null;
    const v = value as Record<string, unknown>;
    if (v.version !== 1 || typeof v.analytics !== 'boolean' || typeof v.savedAt !== 'number' || !Number.isFinite(v.savedAt) || v.savedAt > Date.now() || Date.now() - v.savedAt > MAX_AGE) return null;
    return v as Choice;
  } catch { return null; }
}
export function analyticsAllowed(): boolean { return read()?.analytics === true; }
export function choiceStatus(): 'unset' | 'accepted' | 'rejected' { const choice = read(); return choice ? choice.analytics ? 'accepted' : 'rejected' : 'unset'; }
function notify() { listeners.forEach(listener => listener()); }
export function saveChoice(analytics: boolean): boolean {
  const choice: Choice = { version: 1, analytics, savedAt: Date.now() };
  memory = choice;
  let persisted = true;
  try { localStorage.setItem(CONSENT_KEY, JSON.stringify(choice)); memoryOnly = false; } catch { persisted = false; memoryOnly = true; }
  if (!analytics) { try { sessionStorage.removeItem(ANALYTICS_SESSION_KEY); } catch { /* storage unavailable */ } }
  notify();
  return persisted;
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (event.key === CONSENT_KEY || event.key === null) {
      memory = null;
      memoryOnly = false;
      if (!analyticsAllowed()) { try { sessionStorage.removeItem(ANALYTICS_SESSION_KEY); } catch { /* unavailable */ } }
      notify();
    }
  };
  window.addEventListener('storage', onStorage);
  return () => { listeners.delete(listener); window.removeEventListener('storage', onStorage); };
}
export function useChoiceStatus() { return useSyncExternalStore(subscribe, choiceStatus, () => 'unset'); }
