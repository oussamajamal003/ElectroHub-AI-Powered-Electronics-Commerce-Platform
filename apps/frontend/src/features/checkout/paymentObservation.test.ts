import { afterEach, expect, it } from 'vitest';
import { beginPaymentObservation, endPaymentObservation, isPreviousPaymentResult, observedPaymentIds, observePaymentSnapshot } from './paymentObservation';
import { pendingPollInterval, retainPaidPurchases, synchronizePaymentOutcome, acknowledgePaymentOutcome, type SavedPurchase } from './PaymentPurchases';
import { QueryClient } from '@tanstack/react-query';
import { cart, confirmation } from './fixtures';
import type { PaymentOutcome } from './types';
import { vi } from 'vitest';

vi.mock('@/lib/api', () => ({ apiClient: vi.fn() }));
const owner = 'observation-test-owner'; const other = 'other-observation-owner';
const before = { attemptId: 'retry-a', state: 'DECLINED', updatedAt: '2026-10-15T10:00:00.000Z', classification: 'DECLINED' };
const failed: SavedPurchase = { ...before, scope: 'CART_CHECKOUT', total: cart.total, currency: 'USD', pending: false, unread: true,
  orderReference: null, items: [{ name: 'A', quantity: 1 }] };
const paid: PaymentOutcome = { ...before, state: 'PAID', classification: 'SUCCEEDED', committed: true,
  orderReference: confirmation.orderReference, confirmation: { ...confirmation, paymentState: 'PAID' },
  total: cart.total, currency: 'USD', cart, providerStatus: 'succeeded', failureCode: null, recoveryActive: false, recoveryRemainder: null };
afterEach(() => { endPaymentObservation(owner, before.attemptId); endPaymentObservation(other, before.attemptId); });

it('persists only retry observation metadata and scopes it to the customer', () => {
  beginPaymentObservation(owner, before);
  expect(observedPaymentIds(owner).has(before.attemptId)).toBe(true);
  expect(observedPaymentIds(other).size).toBe(0);
  expect(sessionStorage.getItem(`electrohub:payment-observation:v1:${owner}`)).toBe(JSON.stringify([
    { attemptId: before.attemptId, beforeState: 'DECLINED', beforeUpdatedAt: before.updatedAt },
  ]));
});
it('does not mistake the previous decline or an unversioned read for the new confirmation result', () => {
  beginPaymentObservation(owner, before);
  expect(isPreviousPaymentResult(owner, before)).toBe(true);
  expect(isPreviousPaymentResult(owner, { ...before, updatedAt: null })).toBe(true);
  observePaymentSnapshot(owner, before);
  expect(observedPaymentIds(owner).size).toBe(1);
  expect(pendingPollInterval([failed], 0, new Map(), observedPaymentIds(owner))).toBe(15000);
});
it('recognizes a newly confirmed decline using server version evidence, without pretending it succeeded', () => {
  beginPaymentObservation(owner, before);
  const current = { ...before, updatedAt: '2026-10-15T10:01:00.000Z' };
  expect(isPreviousPaymentResult(owner, current)).toBe(false);
  observePaymentSnapshot(owner, current);
  expect(observedPaymentIds(owner).size).toBe(0);
  expect(pendingPollInterval([failed])).toBe(false);
});
it('UNKNOWN and processing snapshots never end observation, even when their raw state is DECLINED', () => {
  beginPaymentObservation(owner, before);
  observePaymentSnapshot(owner, { ...before, classification: 'UNKNOWN', updatedAt: '2026-10-15T10:02:00Z' });
  expect(observedPaymentIds(owner).size).toBe(1);
});
it('verified capture updates the shared purchase and Orders caches without touching Cart B or a checkout draft', () => {
  const client = new QueryClient();
  const cartKey = ['cart', 'current', owner]; const draftKey = ['checkout', owner, 'B'];
  const untouched = { revision: 'B', items: ['B'] }; client.setQueryData(cartKey, untouched); client.setQueryData(draftKey, untouched);
  client.setQueryData(['payment-purchases', owner], { data: [failed] });
  client.setQueryData(['orders', owner, 'list', 1, 10], { data: [] });
  beginPaymentObservation(owner, before);
  synchronizePaymentOutcome(owner, paid, client);
  expect(client.getQueryData<{ data: SavedPurchase[] }>(['payment-purchases', owner])?.data[0]).toMatchObject({ state: 'PAID', pending: false, unread: false, retryAllowed: false });
  expect(client.getQueryState(['orders', owner, 'list', 1, 10])?.isInvalidated).toBe(true);
  expect(client.getQueryData(cartKey)).toBe(untouched); expect(client.getQueryData(draftKey)).toBe(untouched);
  expect(observedPaymentIds(owner).size).toBe(0); client.clear();
});
it.each([
  { ...paid, state: 'CAPTURE_PENDING' as const },
  { ...paid, committed: false },
  { ...paid, confirmation: { ...confirmation, paymentState: 'PENDING' as const } },
  { ...paid, orderReference: 'ORD-OTHER' },
])('does not publish paid state without complete backend capture proof', outcome => {
  const client = new QueryClient(); client.setQueryData(['payment-purchases', owner], { data: [failed] });
  synchronizePaymentOutcome(owner, outcome, client);
  expect(client.getQueryData<{ data: SavedPurchase[] }>(['payment-purchases', owner])?.data[0]?.state).toBe('DECLINED');
  expect(client.getQueryData(['orders', 'confirmation', owner, confirmation.orderReference])).toBeUndefined(); client.clear();
});
it('prevents stale failure/pending projections from undoing PAID while still allowing authoritative refunds', () => {
  const captured = { ...failed, state: 'PAID', classification: 'SUCCEEDED', pending: false };
  expect(retainPaidPurchases([captured], [failed])[0]).toBe(captured);
  const refund = { ...failed, state: 'REFUNDED', classification: 'FAILED' };
  expect(retainPaidPurchases([captured], [refund])[0]).toBe(refund);
});
it('publishes a backend-confirmed decline immediately and rejects an older Processing list response', () => {
  const client = new QueryClient();
  const pending: SavedPurchase = { ...failed, state: 'PROCESSING', classification: 'PROCESSING', pending: true,
    updatedAt: '2026-10-15T10:00:00Z', unread: false };
  client.setQueryData(['payment-purchases', owner], { data: [pending] });
  synchronizePaymentOutcome(owner, { ...paid, state: 'DECLINED', classification: 'DECLINED', committed: false,
    confirmation: null, recoveryActive: false, retryAllowed: true, updatedAt: '2026-10-15T10:01:00Z' }, client);
  const rows = client.getQueryData<{ data: SavedPurchase[] }>(['payment-purchases', owner])!.data;
  expect(rows[0]).toMatchObject({ state: 'DECLINED', pending: false, retryAllowed: true, unread: false });
  expect(retainPaidPurchases(rows, [pending])[0]).toEqual(rows[0]);
  const retry = { ...pending, updatedAt: '2026-10-15T10:02:00Z' };
  expect(retainPaidPurchases(rows, [retry])[0]).toBe(retry);
  client.clear();
});
it('never publishes AWAITING_INPUT as a failed purchase', () => {
  const client = new QueryClient();
  client.setQueryData(['payment-purchases', owner], { data: [failed] });
  synchronizePaymentOutcome(owner, { ...paid, state: 'AWAITING_INPUT', classification: 'AWAITING_CUSTOMER_ACTION',
    committed: false, confirmation: null }, client);
  expect(client.getQueryData<{ data: SavedPurchase[] }>(['payment-purchases', owner])!.data[0]).toEqual(failed);
  client.clear();
});
it('does not consume or acknowledge an outcome while its tab is hidden', () => {
  const client = new QueryClient();
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
  try {
    acknowledgePaymentOutcome(owner, paid, client);
    expect(client.getQueryData(['payment-notice-presented', owner])).toBeUndefined();
    expect(localStorage.getItem(`electrohub.payment-notice.${owner}.${before.attemptId}.PAID`)).toBeNull();
  } finally { Reflect.deleteProperty(document, 'visibilityState'); client.clear(); }
});
