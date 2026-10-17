import type { Page } from '@playwright/test';
import { cart } from '../../src/features/checkout/fixtures';
import type { SavedPurchase } from '../../src/features/checkout/PaymentPurchases';
import { attemptId } from './stripe.harness';

/** Scenario 1: saved purchases are observed through the owned list endpoint the Cart and notifications share. */
export function savedPurchase(overrides: Partial<SavedPurchase>): SavedPurchase {
  return { attemptId, scope: 'CART_CHECKOUT', state: 'CAPTURE_PENDING', classification: 'ORDER_PROCESSING', total: cart.total, currency: 'USD',
    pending: true, unread: false, orderReference: null, submittedAt: new Date().toISOString(), retryAllowed: false,
    items: [{ name: 'Pending Product A', quantity: 2 }], ...overrides };
}
/** Routes GET /api/checkout/payment-attempts (registered after the harness, so it takes priority). Returns the read counter. */
export async function routeSavedPurchases(page: Page, current: () => SavedPurchase[] | { status: number }) {
  const reads = { count: 0 };
  await page.route('**/api/checkout/payment-attempts', async route => {
    if (route.request().method() !== 'GET') return route.fallback();
    reads.count++;
    const value = current();
    return Array.isArray(value) ? route.fulfill({ json: { data: value } })
      : route.fulfill({ status: value.status, json: { error: { code: 'PAYMENT_UNAVAILABLE', message: 'Unavailable' } } });
  });
  return reads;
}
