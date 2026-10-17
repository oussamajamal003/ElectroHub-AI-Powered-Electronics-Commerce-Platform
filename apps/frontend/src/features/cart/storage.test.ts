import { beforeEach, describe, expect, it } from 'vitest';
import { CART_STORAGE_KEY, clearAuthenticatedCartCount, readAuthenticatedCartCount, readGuestCart, writeAuthenticatedCartCount, writeGuestCart } from './storage';

const productId = '8f2813b4-a388-44d3-b51e-5d4c40386677';
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); });

describe('guest cart storage', () => {
  it('stores only version, product ID and quantity', () => {
    expect(writeGuestCart([{ productId, quantity: 2 }])).toBe(true);
    expect(JSON.parse(localStorage.getItem(CART_STORAGE_KEY)!)).toEqual({ version: 1, items: [{ productId, quantity: 2 }] });
    expect(readGuestCart()).toEqual([{ productId, quantity: 2 }]);
  });
  it('ignores malformed and invalid untrusted entries', () => {
    localStorage.setItem(CART_STORAGE_KEY, '{');
    expect(readGuestCart()).toEqual([]);
    localStorage.setItem(CART_STORAGE_KEY, JSON.stringify({ version: 1, items: [
      { productId, quantity: 2, price: '0.01' }, { productId, quantity: 3 }, { productId: 'invalid', quantity: 1 }, { productId, quantity: -1 },
    ] }));
    expect(readGuestCart()).toEqual([{ productId, quantity: 3 }]);
  });
});

describe('authenticated cart count storage', () => {
  const userId = 'user-123';
  it('reads, writes, and clears authenticated cart count', () => {
    expect(readAuthenticatedCartCount(userId)).toBeUndefined();
    expect(writeAuthenticatedCartCount(userId, 5)).toBe(true);
    expect(readAuthenticatedCartCount(userId)).toBe(5);
    clearAuthenticatedCartCount(userId);
    expect(readAuthenticatedCartCount(userId)).toBeUndefined();
  });
  it('rejects invalid counts', () => {
    expect(writeAuthenticatedCartCount(userId, -1)).toBe(false);
    expect(writeAuthenticatedCartCount(userId, 1.5)).toBe(false);
  });
});
