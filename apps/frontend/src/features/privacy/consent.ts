import { useSyncExternalStore } from 'react';

export const CONSENT_KEY = 'electrohub.privacy.v1';
export const ANALYTICS_SESSION_KEY = 'eh.storefront-session';
export const CONSENT_MAX_AGE_MS = 180 * 24 * 60 * 60 * 1000;
type Choice = { version: 1; analytics: boolean; savedAt: number };
const listeners = new Set<() => void>();
const withdrawalListeners = new Set<() => void>();
let memory: Choice | null = null;
let memoryOnly = false;
/** Incremented on every withdrawal (this tab or another): work started under an older generation must not report analytics. */
let generation = 0;
let lastAllowed: boolean | null = null;

function valid(value: unknown): value is Choice {
  if (!value || typeof value !== 'object') return false;
  const v = value as Record<string, unknown>;
  return v.version === 1 && typeof v.analytics === 'boolean' && typeof v.savedAt === 'number' && Number.isFinite(v.savedAt) &&
    v.savedAt <= Date.now() && Date.now() - v.savedAt <= CONSENT_MAX_AGE_MS;
}
function read(): Choice | null {
  // A choice that could not be persisted applies to this tab only; it still expires like a stored one.
  if (memoryOnly) return valid(memory) ? memory : null;
  try {
    const raw = localStorage.getItem(CONSENT_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    return valid(value) ? value : null;
  } catch { return null; }
}
/** Read at the moment of each optional measurement; never cached, so withdrawal, expiry and other tabs apply immediately. */
export function analyticsAllowed(): boolean { return read()?.analytics === true; }
export function choiceStatus(): 'unset' | 'accepted' | 'rejected' { const choice = read(); return choice ? choice.analytics ? 'accepted' : 'rejected' : 'unset'; }
export function consentGeneration(): number { return generation; }

/** Runs once per transition from allowed to not allowed: bumps the generation, clears the tab identifier, informs subscribers. */
function settle() {
  const allowed = analyticsAllowed();
  if (lastAllowed === true && !allowed) {
    generation += 1;
    withdrawalListeners.forEach(listener => { try { listener(); } catch { /* one cleanup must not block another */ } });
  }
  if (!allowed) { try { sessionStorage.removeItem(ANALYTICS_SESSION_KEY); } catch { /* storage unavailable */ } }
  lastAllowed = allowed;
  listeners.forEach(listener => listener());
}

export function saveChoice(analytics: boolean): boolean {
  if (lastAllowed === null) lastAllowed = analyticsAllowed();
  const choice: Choice = { version: 1, analytics, savedAt: Date.now() };
  memory = choice;
  let persisted = true;
  try { localStorage.setItem(CONSENT_KEY, JSON.stringify(choice)); memoryOnly = false; } catch { persisted = false; memoryOnly = true; }
  settle();
  return persisted;
}

/** Called when analytics stops being allowed in this tab, including a withdrawal made in another tab. Returns an unsubscribe. */
export function onAnalyticsWithdrawn(listener: () => void): () => void {
  withdrawalListeners.add(listener);
  return () => { withdrawalListeners.delete(listener); };
}

// One listener per tab (not per component): another tab's choice is applied here as soon as the browser reports it.
if (typeof window !== 'undefined') {
  lastAllowed = analyticsAllowed();
  window.addEventListener('storage', event => {
    if (event.key !== CONSENT_KEY && event.key !== null) return;
    memory = null;
    memoryOnly = false;
    settle();
  });
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
export function useChoiceStatus() { return useSyncExternalStore(subscribe, choiceStatus, () => 'unset'); }
