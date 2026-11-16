import type { CartInputItem } from './types';

export const CART_STORAGE_KEY = 'electrohub.cart.v1';
export const MAX_CART_LINES = 50;
export const MAX_CART_QUANTITY = 999;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function readGuestCart(): CartInputItem[] {
  try {
    const raw = localStorage.getItem(CART_STORAGE_KEY);
    if (!raw) return [];
    const value: unknown = JSON.parse(raw);
    if (!value || typeof value !== 'object' || !('version' in value) || value.version !== 1 || !('items' in value) || !Array.isArray(value.items)) return [];
    const unique = new Map<string, number>();
    for (const entry of value.items) {
      if (!entry || typeof entry !== 'object') continue;
      const candidate = entry as Record<string, unknown>;
      if (typeof candidate.productId !== 'string' || !uuid.test(candidate.productId) ||
        !Number.isInteger(candidate.quantity) || (candidate.quantity as number) < 1 || (candidate.quantity as number) > MAX_CART_QUANTITY) continue;
      unique.set(candidate.productId, Math.max(unique.get(candidate.productId) ?? 0, candidate.quantity as number));
      if (unique.size >= MAX_CART_LINES) break;
    }
    return Array.from(unique, ([productId, quantity]) => ({ productId, quantity }));
  } catch { return []; }
}

export function writeGuestCart(items: CartInputItem[]): boolean {
  try { localStorage.setItem(CART_STORAGE_KEY, JSON.stringify({ version: 1, items })); return true; }
  catch { return false; }
}

export function clearGuestCart(): boolean {
  try { localStorage.removeItem(CART_STORAGE_KEY); return true; }
  catch { return false; }
}

const AUTHENTICATED_CART_COUNT_PREFIX = 'electrohub.cart.auth-count.v1:';

function authenticatedCartCountKey(userId: string): string | null {
  return userId.trim() ? `${AUTHENTICATED_CART_COUNT_PREFIX}${encodeURIComponent(userId)}` : null;
}

export function readAuthenticatedCartCount(userId: string): number | undefined {
  const key = authenticatedCartCountKey(userId);
  if (!key) return undefined;
  try {
    const value = sessionStorage.getItem(key);
    if (value === null) return undefined;
    const count = Number(value);
    if (Number.isSafeInteger(count) && count >= 0 && count <= MAX_CART_LINES * MAX_CART_QUANTITY) {
      return count;
    }
    return undefined;
  } catch {
    return undefined;
  }
}

export function writeAuthenticatedCartCount(userId: string, count: number): boolean {
  const key = authenticatedCartCountKey(userId);
  if (!key || !Number.isSafeInteger(count) || count < 0) return false;
  try {
    sessionStorage.setItem(key, String(count));
    return true;
  } catch {
    return false;
  }
}

export function clearAuthenticatedCartCount(userId: string): void {
  const key = authenticatedCartCountKey(userId);
  if (!key) return;
  try {
    sessionStorage.removeItem(key);
  } catch { /* Storage can be unavailable. */ }
}
