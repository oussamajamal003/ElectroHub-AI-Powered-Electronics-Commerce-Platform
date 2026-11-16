/**
 * Central toast store. One module-level store (not a React context) so mutation handlers, React Query callbacks and plain functions can
 * raise feedback without threading a provider, and so every surface (storefront, Admin Console, shared components) shares one queue,
 * one dedupe rule and one viewport. `ToastCenter` is the only renderer.
 *
 * Rules enforced here, not left to callers:
 *  - bounded queue (MAX_VISIBLE), oldest dismissed first;
 *  - identical toasts raised within DEDUPE_MS collapse into one (a double click or a retry storm never stacks twelve copies);
 *  - success/info/warning auto-dismiss, errors stay long enough to read, `loading` stays until resolved or dismissed.
 */
export type ToastVariant = 'success' | 'error' | 'warning' | 'info' | 'loading';

export interface ToastAction { label: string; onClick: () => void; /** Accessible name when the visible label is terse ("Retry"). */ altText?: string }

export interface ToastOptions {
  description?: string;
  /** Stable key; raising the same key replaces the existing toast instead of stacking. */
  id?: string;
  duration?: number;
  action?: ToastAction;
  /**
   * Set `false` when an inline live region next to the control already announces the same outcome (e.g. "Added to cart" status text):
   * the toast then stays visual only, so screen-reader users hear it once. Defaults to `true`.
   */
  announce?: boolean;
}

export interface ToastItem extends Required<Pick<ToastOptions, 'duration'>> {
  id: string;
  variant: ToastVariant;
  title: string;
  description?: string;
  action?: ToastAction;
  announce: boolean;
  createdAt: number;
}

export const MAX_VISIBLE = 3;
export const DEDUPE_MS = 1500;
export const DEFAULT_DURATION: Readonly<Record<ToastVariant, number>> = { success: 4000, info: 5000, warning: 7000, error: 8000, loading: 0 };

type Listener = () => void;
let items: readonly ToastItem[] = [];
let sequence = 0;
const listeners = new Set<Listener>();
const hosts: symbol[] = [];

const emit = () => listeners.forEach(listener => listener());
const keyOf = (variant: ToastVariant, title: string, description?: string) => `${variant}\u0000${title}\u0000${description ?? ''}`;

function show(variant: ToastVariant, title: string, options: ToastOptions = {}): string {
  const text = title.trim();
  if (!text) return '';
  const now = Date.now();
  const existing = options.id
    ? items.find(item => item.id === options.id)
    : items.find(item => keyOf(item.variant, item.title, item.description) === keyOf(variant, text, options.description) && now - item.createdAt < DEDUPE_MS);
  if (existing && !options.id) return existing.id;
  const id = options.id ?? `toast-${++sequence}`;
  const next: ToastItem = { id, variant, title: text, description: options.description, action: options.action, announce: options.announce ?? true,
    duration: options.duration ?? DEFAULT_DURATION[variant], createdAt: now };
  const kept = items.filter(item => item.id !== id);
  items = [...kept, next].slice(-MAX_VISIBLE);
  emit();
  return id;
}

function dismiss(id?: string): void {
  items = id ? items.filter(item => item.id !== id) : [];
  emit();
}

export const toast = {
  success: (title: string, options?: ToastOptions) => show('success', title, options),
  error: (title: string, options?: ToastOptions) => show('error', title, options),
  warning: (title: string, options?: ToastOptions) => show('warning', title, options),
  info: (title: string, options?: ToastOptions) => show('info', title, options),
  /** Pending feedback for a slow operation. Resolve it with `toast.success/error({ id })` (same id replaces it) or `toast.dismiss(id)`. */
  loading: (title: string, options?: ToastOptions) => show('loading', title, options),
  dismiss,
} as const;

// ─── Store plumbing for ToastCenter ─────────────────────────────────────────
export const subscribeToasts = (listener: Listener) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const getToasts = (): readonly ToastItem[] => items;

/** Only the first mounted ToastCenter renders the queue, so a page-level provider and the app-level one never double-announce. */
export function registerToastHost(host: symbol): () => void {
  hosts.push(host);
  emit();
  return () => { const at = hosts.indexOf(host); if (at >= 0) hosts.splice(at, 1); emit(); };
}
/** Snapshot for `useSyncExternalStore`: which mounted ToastCenter currently owns the viewport. */
export const getActiveToastHost = (): symbol | undefined => hosts[0];

/** Test helper: reset the singleton between tests. */
export function resetToastsForTests(): void { items = []; sequence = 0; emit(); }
