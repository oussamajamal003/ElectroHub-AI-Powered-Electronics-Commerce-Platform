import { describe, expect, it } from 'vitest';
import { publicProductWhere } from '../product.service.js';

// Storefront discovery (Products, search, categories, wishlist, reviews) is governed by storefrontVisible.
// Purchase paths (cart lookup in cart.service.ts, checkout, payment, orders) must NOT read storefrontVisible;
// cart.service.test.ts pins their exact where clause (`{ id: { in }, isTestFixture: false }`).
describe('storefront visibility contract', () => {
  it('public discovery requires an active, non-fixture, storefront-visible product in an active category', () => {
    expect(publicProductWhere).toEqual({ status: 'ACTIVE', isTestFixture: false, storefrontVisible: true, category: { isActive: true } });
  });

  it('hidden acceptance-style products are excluded from discovery without changing the purchase eligibility fields', () => {
    const acceptanceProduct = { status: 'ACTIVE', isTestFixture: false, storefrontVisible: false };
    expect(publicProductWhere.storefrontVisible).toBe(true);
    expect(acceptanceProduct.storefrontVisible).toBe(false);
    expect(acceptanceProduct.isTestFixture).toBe(publicProductWhere.isTestFixture);
    expect(acceptanceProduct.status).toBe(publicProductWhere.status);
  });
});
