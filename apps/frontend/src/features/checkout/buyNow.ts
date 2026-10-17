import type { BuyNowSelection } from './types';

/**
 * Buy Now intent: exactly one product and quantity, held only in sessionStorage.
 * It is never merged into the persistent Cart; the server re-verifies price, stock and totals.
 */
const key = 'electrohub:buynow:v1';
const uuid = /^[0-9a-f-]{36}$/i;
export function readBuyNow(): BuyNowSelection | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(key) ?? 'null') as Partial<BuyNowSelection> | null;
    if (!value || typeof value.productId !== 'string' || !uuid.test(value.productId) ||
      !Number.isInteger(value.quantity) || (value.quantity as number) < 1 || (value.quantity as number) > 999) return null;
    return { productId: value.productId, quantity: value.quantity as number };
  } catch { return null; }
}
export function saveBuyNow(selection: BuyNowSelection): boolean {
  try { sessionStorage.setItem(key, JSON.stringify({ productId: selection.productId, quantity: selection.quantity })); return true; } catch { return false; }
}
export function clearBuyNow() { try { sessionStorage.removeItem(key); } catch { /* Storage may be unavailable. */ } }
