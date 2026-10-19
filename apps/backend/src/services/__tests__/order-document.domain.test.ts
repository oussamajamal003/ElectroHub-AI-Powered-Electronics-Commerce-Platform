import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import {
  canonicalJson, displayText, documentFilename, evaluateDocuments, receiptReference, type DocumentSourceOrder,
} from '../order-document.domain.js';
import { PAYMENT_ID, USER_ID, line, paidOrder, withPayment } from './order-document.fixtures.js';

const ASSET = 'assets-test';
const d = (value: string) => new Prisma.Decimal(value);
type Line = ReturnType<typeof line>;
type Attempt = NonNullable<DocumentSourceOrder['paymentAttempt']>;

const decide = (order: DocumentSourceOrder) => evaluateDocuments(order, ASSET);

/** Order whose subtotal, shipping, total, payment amount and attempt amount all reconcile to the given items. */
function pricedOrder(items: Line[], shipping = '9.99'): DocumentSourceOrder {
  const subtotal = items.reduce((sum, item) => sum.plus(item.lineTotal), d('0'));
  const total = subtotal.plus(d(shipping));
  return withPayment(paidOrder({ subtotal, shippingCost: d(shipping), total }, items), { amount: total },
    { total, amountCents: Number(total.mul(100).toFixed(0)) });
}

const refundedOrder = (attempt: Partial<Attempt> = {}) => withPayment(paidOrder(),
  { status: 'REFUNDED', refundedAt: new Date('2026-10-03T12:00:00.000Z') },
  { state: 'REFUNDED', refundId: 're_synthetic_0001', refundAmountCents: 135798, ...attempt });

/** Every document is blocked with the same reason and no snapshot or version is produced. */
function expectAllBlocked(order: DocumentSourceOrder, reason: string) {
  for (const decision of decide(order)) {
    expect(decision).toMatchObject({ available: false, reason, snapshot: null, contentVersion: null });
  }
}

/** Invoice and receipt blocked by payment proof; the summary stays available and reports the payment situation. */
function expectPaymentBlocked(order: DocumentSourceOrder, reason: string, evidence: string) {
  const [invoice, receipt, summary] = decide(order);
  expect(invoice).toMatchObject({ kind: 'invoice', available: false, reason, snapshot: null, contentVersion: null });
  expect(receipt).toMatchObject({ kind: 'receipt', available: false, reason, snapshot: null, contentVersion: null });
  expect(summary).toMatchObject({ kind: 'summary', available: true, reason: null });
  expect(summary.snapshot?.payment).toEqual({ evidence, paidAt: null, amount: null, receiptReference: null, cardBrand: null, cardLast4: null });
  expect(summary.contentVersion).toMatch(/^v1\.[0-9a-f]{32}$/);
}

const PAID_ITEMS = [
  { name: 'ElectroBook Pro 14 laptop', sku: 'EH-SYN-0001', quantity: 1, unitPrice: '1299.00', lineTotal: '1299.00' },
  { name: 'USB-C braided cable 2 m', sku: 'EH-SYN-0002', quantity: 2, unitPrice: '24.50', lineTotal: '49.00' },
];

/** Literal expectation for the default paid order (paidOrder fixture). */
const PAID_BASE = {
  version: 1, policy: 'COMMERCIAL_V1', templateVersion: 'commercial-template-1.0.0', assetVersion: ASSET,
  sellerProfileVersion: 'electrohub-brand-1', testTransaction: true,
  orderReference: 'ORD-7C9E6679-7425-40DE-944B-E07FC1F90AE7', purchaseDate: '2026-10-01T10:00:00.000Z',
  fulfillmentStatus: 'CONFIRMED', currency: 'USD',
  subtotal: '1348.00', shipping: '9.99', total: '1357.99',
  delivery: { method: 'EXPRESS', estimateStart: '2026-10-05', estimateEnd: '2026-10-07' },
  shipTo: { recipient: 'Alex Example', lines: ['100 Synthetic Street', 'Suite 4', 'Testville, CA 90001', 'United States'] },
  payment: { evidence: 'VERIFIED', paidAt: '2026-10-01T10:00:05.000Z', amount: '1357.99', receiptReference: 'RCT-253CDC1B7B62', cardBrand: 'visa', cardLast4: '4242' },
  annotation: { cancelled: false, refundedAt: null, refundAmount: null },
};
const PAID_INVOICE = { ...PAID_BASE, kind: 'invoice', items: PAID_ITEMS };
const PAID_RECEIPT = { ...PAID_BASE, kind: 'receipt', items: [], delivery: null, shipTo: null };
const PAID_SUMMARY = { ...PAID_BASE, kind: 'summary', items: PAID_ITEMS };

describe('Eligibility matrix (section 4.2)', () => {
  describe('V + P, fulfilled (CONFIRMED / PREPARING / OUT_FOR_DELIVERY / DELIVERED)', () => {
    it('returns invoice, receipt and summary in that fixed order', () => {
      expect(decide(paidOrder()).map(decision => decision.kind)).toEqual(['invoice', 'receipt', 'summary']);
    });

    it.each(['CONFIRMED', 'PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED'])('makes all three documents available for %s', status => {
      const decisions = decide(paidOrder({ status }));
      expect(decisions.map(({ kind, available, reason }) => ({ kind, available, reason }))).toEqual([
        { kind: 'invoice', available: true, reason: null },
        { kind: 'receipt', available: true, reason: null },
        { kind: 'summary', available: true, reason: null },
      ]);
    });

    it('produces the exact invoice snapshot for the paid order', () => {
      const [invoice] = decide(paidOrder());
      expect(invoice.snapshot).toEqual(PAID_INVOICE);
      expect(invoice.contentVersion).toMatch(/^v1\.[0-9a-f]{32}$/);
    });

    it('produces the exact receipt snapshot: original payment facts, no items, no shipping identity', () => {
      const [, receipt] = decide(paidOrder());
      expect(receipt.snapshot).toEqual(PAID_RECEIPT);
    });

    it('summary carries the same verified facts with the actual fulfillment status', () => {
      const [, , summary] = decide(paidOrder({ status: 'OUT_FOR_DELIVERY' }));
      expect(summary.snapshot).toEqual({ ...PAID_SUMMARY, fulfillmentStatus: 'OUT_FOR_DELIVERY' });
    });
  });

  describe('AWAITING_CAPTURE with Payment PENDING / PROCESSING (authorization only)', () => {
    it.each(['PENDING', 'PROCESSING'])('blocks invoice and receipt, keeps the pending summary for %s', status => {
      const order = withPayment(paidOrder({ status: 'AWAITING_CAPTURE' }), { status, paidAt: null, refundedAt: null }, { state: 'PENDING' });
      expectPaymentBlocked(order, 'PAYMENT_NOT_CONFIRMED', 'PENDING');
      expect(decide(order)[2].snapshot).toMatchObject({ fulfillmentStatus: 'AWAITING_CAPTURE', annotation: { cancelled: false, refundedAt: null, refundAmount: null } });
    });
  });

  describe('Legacy order with no Payment row', () => {
    it('blocks invoice and receipt and records NOT_RECORDED on the summary', () => {
      expectPaymentBlocked(withPayment(paidOrder({ status: 'CONFIRMED' }), null, null), 'PAYMENT_NOT_CONFIRMED', 'NOT_RECORDED');
    });

    it('treats an UNPROCESSED order without a Payment as not paid, with the summary still available', () => {
      expectPaymentBlocked(withPayment(paidOrder({ status: 'UNPROCESSED' }), null, null), 'PAYMENT_NOT_CONFIRMED', 'NOT_RECORDED');
    });
  });

  describe('Payment FAILED / cancelled before successful payment', () => {
    it('blocks invoice and receipt and records FAILED on a cancelled summary with no paid stamp', () => {
      const order = withPayment(paidOrder({ status: 'CANCELLED' }), { status: 'FAILED', paidAt: null, refundedAt: null }, { state: 'FAILED' });
      expectPaymentBlocked(order, 'PAYMENT_NOT_CONFIRMED', 'FAILED');
      expect(decide(order)[2].snapshot).toMatchObject({ fulfillmentStatus: 'CANCELLED', annotation: { cancelled: true, refundedAt: null } });
    });
  });

  describe('CANCELLED with retained original payment and no refund', () => {
    it('keeps the historical invoice and receipt with a cancellation note, and no refund annotation', () => {
      const order = paidOrder({ status: 'CANCELLED' });
      const [invoice, receipt, summary] = decide(order);
      expect(invoice.available).toBe(true);
      expect(invoice.snapshot?.annotation).toEqual({ cancelled: true, refundedAt: null, refundAmount: null });
      expect(receipt.available).toBe(true);
      expect(receipt.snapshot?.annotation).toEqual({ cancelled: true, refundedAt: null, refundAmount: null });
      expect(summary.available).toBe(true);
      expect(summary.snapshot?.payment.evidence).toBe('VERIFIED');
      expect(summary.snapshot?.fulfillmentStatus).toBe('CANCELLED');
    });
  });

  describe('REFUNDED with retained original payment and valid refundedAt', () => {
    it('keeps all three documents available with the original amount and date preserved', () => {
      const [invoice, receipt, summary] = decide(refundedOrder());
      expect(invoice.available && receipt.available && summary.available).toBe(true);
      expect(invoice.snapshot?.payment).toMatchObject({ evidence: 'VERIFIED', paidAt: '2026-10-01T10:00:05.000Z', amount: '1357.99' });
      expect(invoice.snapshot?.total).toBe('1357.99');
      expect(receipt.snapshot?.payment.amount).toBe('1357.99');
      expect(summary.snapshot?.payment.amount).toBe('1357.99');
    });

    it('records the refund date separately from the original totals', () => {
      const [invoice, receipt, summary] = decide(refundedOrder());
      for (const decision of [invoice, receipt, summary]) {
        expect(decision.snapshot?.annotation).toEqual({ cancelled: false, refundedAt: '2026-10-03T12:00:00.000Z', refundAmount: '1357.98' });
      }
    });

    it.each([
      [135798, '1357.98'],
      [5, '0.05'],
      [135799, '1357.99'],
    ])('formats a verified refundAmountCents of %i as %s', (refundAmountCents, refundAmount) => {
      expect(decide(refundedOrder({ refundAmountCents }))[0].snapshot?.annotation.refundAmount).toBe(refundAmount);
    });

    it('omits the refund amount (null) when no refundId is bound to the attempt', () => {
      const [invoice] = decide(refundedOrder({ refundId: null }));
      expect(invoice.available).toBe(true);
      expect(invoice.snapshot?.annotation).toEqual({ cancelled: false, refundedAt: '2026-10-03T12:00:00.000Z', refundAmount: null });
    });

    it.each([
      ['exceeds the original amount', 135800],
      ['is zero', 0],
    ])('omits the refund amount when refundAmountCents %s', (_label, refundAmountCents) => {
      const [invoice] = decide(refundedOrder({ refundAmountCents }));
      expect(invoice.available).toBe(true);
      expect(invoice.snapshot?.annotation.refundAmount).toBeNull();
    });
  });

  describe('REFUNDED with paidAt absent (unexpected-capture compensation, no original success evidence)', () => {
    const order = withPayment(paidOrder(),
      { status: 'REFUNDED', paidAt: null, refundedAt: new Date('2026-10-03T12:00:00.000Z') },
      { state: 'REFUNDED', refundId: 're_synthetic_0001', refundAmountCents: 135798 });

    it('blocks invoice and receipt with HISTORICAL_PAYMENT_UNVERIFIED', () => {
      const [invoice, receipt] = decide(order);
      expect(invoice).toMatchObject({ kind: 'invoice', available: false, reason: 'HISTORICAL_PAYMENT_UNVERIFIED', snapshot: null });
      expect(receipt).toMatchObject({ kind: 'receipt', available: false, reason: 'HISTORICAL_PAYMENT_UNVERIFIED', snapshot: null });
    });

    it('keeps the summary available with REFUND_UNVERIFIED and the recorded refund date but no amount', () => {
      const [, , summary] = decide(order);
      expect(summary.available).toBe(true);
      expect(summary.snapshot?.payment).toEqual({ evidence: 'REFUND_UNVERIFIED', paidAt: null, amount: null, receiptReference: null, cardBrand: null, cardLast4: null });
      expect(summary.snapshot?.annotation).toEqual({ cancelled: false, refundedAt: '2026-10-03T12:00:00.000Z', refundAmount: null });
    });
  });

  describe('Contradictory or incomplete payment facts', () => {
    it('SUCCEEDED with paidAt absent is DATA_INCOMPLETE and the summary never asserts paid proof', () => {
      expectPaymentBlocked(withPayment(paidOrder(), { paidAt: null }), 'DATA_INCOMPLETE', 'UNAVAILABLE');
    });

    it('SUCCEEDED with no providerPaymentId is DATA_INCOMPLETE', () => {
      expectPaymentBlocked(withPayment(paidOrder(), { providerPaymentId: null }, { providerIntentId: null }), 'DATA_INCOMPLETE', 'UNAVAILABLE');
    });

    it.each([
      ['payment amount differs from order total', withPayment(paidOrder(), { amount: d('1357.98') })],
      ['payment currency differs from order currency', withPayment(paidOrder(), { currency: 'EUR' })],
      ['attempt providerIntentId differs from payment', withPayment(paidOrder(), {}, { providerIntentId: 'pi_synthetic_9999' })],
      ['attempt state is INCIDENT', withPayment(paidOrder(), {}, { state: 'INCIDENT' })],
      ['attempt amountCents differs from order total', withPayment(paidOrder(), {}, { amountCents: 135800 })],
      ['attempt total differs from order total', withPayment(paidOrder(), {}, { total: d('1357.98') })],
      ['attempt belongs to another user', withPayment(paidOrder(), {}, { userId: '99999999-9999-4999-8999-999999999999' })],
      ['SUCCEEDED but refundedAt is set', withPayment(paidOrder(), { refundedAt: new Date('2026-10-03T12:00:00.000Z') })],
      ['paidAt is 61 seconds before createdAt', withPayment(paidOrder(), { paidAt: new Date('2026-10-01T09:58:59.000Z') })],
      ['REFUNDED with refundedAt before paidAt', withPayment(paidOrder(), { status: 'REFUNDED', refundedAt: new Date('2026-10-01T09:00:00.000Z') }, { state: 'REFUNDED', refundId: 're_synthetic_0001', refundAmountCents: 135798 })],
      ['SUCCEEDED but order is AWAITING_CAPTURE', paidOrder({ status: 'AWAITING_CAPTURE' })],
    ])('DATA_INCONSISTENT when %s', (_label, order) => {
      expectPaymentBlocked(order, 'DATA_INCONSISTENT', 'UNAVAILABLE');
    });

    it('DATA_INCONSISTENT for an unknown payment status string, with UNAVAILABLE evidence on the summary', () => {
      expectPaymentBlocked(withPayment(paidOrder(), { status: 'VOIDED' }), 'DATA_INCONSISTENT', 'UNAVAILABLE');
    });

    it('accepts paidAt exactly 60 seconds before createdAt (tolerance boundary)', () => {
      const [invoice] = decide(withPayment(paidOrder(), { paidAt: new Date('2026-10-01T09:59:00.000Z') }));
      expect(invoice.available).toBe(true);
      expect(invoice.snapshot?.payment.paidAt).toBe('2026-10-01T09:59:00.000Z');
    });

    it('accepts a verified payment when the historical PaymentAttempt is missing (legacy path)', () => {
      const [invoice, receipt, summary] = decide(withPayment(paidOrder(), {}, null));
      expect(invoice.available).toBe(true);
      expect(receipt.available).toBe(true);
      expect(summary.snapshot?.payment.evidence).toBe('VERIFIED');
    });
  });
});

describe('Snapshot validity (V)', () => {
  it('non-USD currency blocks all three documents with UNSUPPORTED_CURRENCY', () => {
    expectAllBlocked(paidOrder({ currency: 'EUR' }), 'UNSUPPORTED_CURRENCY');
  });

  it('zero items blocks all three documents with DATA_INCOMPLETE', () => {
    expectAllBlocked(paidOrder({}, []), 'DATA_INCOMPLETE');
  });

  it('101 items blocks all three documents with DOCUMENT_TOO_LARGE', () => {
    expectAllBlocked(pricedOrder(Array.from({ length: 101 }, (_, i) => line(i, '1.00', 1))), 'DOCUMENT_TOO_LARGE');
  });

  it('100 items are accepted and reconcile exactly', () => {
    const [invoice] = decide(pricedOrder(Array.from({ length: 100 }, (_, i) => line(i, '1.00', 1))));
    expect(invoice.available).toBe(true);
    expect(invoice.snapshot?.items).toHaveLength(100);
    expect(invoice.snapshot).toMatchObject({ subtotal: '100.00', shipping: '9.99', total: '109.99' });
  });

  it('a canonical snapshot over the 256 KiB ceiling blocks invoice and summary but not the receipt', () => {
    const hugeNames = Array.from({ length: 100 }, (_, i) => line(i, '1.00', 1, 'X'.repeat(3000)));
    const [invoice, receipt, summary] = decide(pricedOrder(hugeNames));
    expect(invoice).toMatchObject({ available: false, reason: 'DOCUMENT_TOO_LARGE', snapshot: null });
    expect(receipt.available).toBe(true);
    expect(summary).toMatchObject({ available: false, reason: 'DOCUMENT_TOO_LARGE', snapshot: null });
  });

  it('a line whose lineTotal differs from unitPrice * quantity blocks all three with DATA_INCONSISTENT', () => {
    expectAllBlocked(paidOrder({}, [{ ...line(0, '10.00', 2), lineTotal: d('25.00') }]), 'DATA_INCONSISTENT');
  });

  it('a subtotal that differs from the sum of line totals blocks all three with DATA_INCONSISTENT', () => {
    expectAllBlocked(paidOrder({ subtotal: d('1300.00'), total: d('1309.99') }), 'DATA_INCONSISTENT');
  });

  it('a total that differs from subtotal + shipping blocks all three with DATA_INCONSISTENT', () => {
    expectAllBlocked(paidOrder({ total: d('1358.00') }), 'DATA_INCONSISTENT');
  });

  it.each([0, 1000, 1.5])('quantity %s is DATA_INCONSISTENT', quantity => {
    expectAllBlocked(pricedOrder([line(0, '19.99', quantity)]), 'DATA_INCONSISTENT');
  });

  it.each([
    ['negative unit price', [line(0, '-1.00', 1)]],
    ['three-decimal unit price', [line(0, '19.999', 1)]],
    ['unit price above Decimal(12,2)', [line(0, '10000000000.00', 1)]],
  ] as const)('%s is DATA_INCONSISTENT', (_label, items) => {
    expectAllBlocked(pricedOrder([...items]), 'DATA_INCONSISTENT');
  });

  it('negative shipping is DATA_INCONSISTENT', () => {
    expectAllBlocked(pricedOrder([line(0, '20.00', 1)], '-1.00'), 'DATA_INCONSISTENT');
  });

  it.each([
    ['empty recipient', { shippingRecipient: '' }],
    ['whitespace-only recipient', { shippingRecipient: '   ' }],
    ['bidi-control-only recipient', { shippingRecipient: '‮' }],
  ])('%s is DATA_INCOMPLETE', (_label, overrides) => {
    expectAllBlocked(paidOrder(overrides), 'DATA_INCOMPLETE');
  });

  it('an empty product name is DATA_INCOMPLETE', () => {
    expectAllBlocked(pricedOrder([line(0, '19.99', 1, '')]), 'DATA_INCOMPLETE');
  });

  it('accepts Decimal(12,2) maxima and formats them without an exponent', () => {
    const [invoice] = decide(pricedOrder([line(0, '9999999999.99', 1, 'Maximum value product')], '0.00'));
    expect(invoice.available).toBe(true);
    expect(invoice.snapshot).toMatchObject({ subtotal: '9999999999.99', shipping: '0.00', total: '9999999999.99' });
    expect(invoice.snapshot?.items[0].unitPrice).toBe('9999999999.99');
    expect(invoice.snapshot?.payment.amount).toBe('9999999999.99');
  });

  it('keeps a zero shipping cost as the exact string 0.00', () => {
    const [invoice] = decide(pricedOrder([line(0, '20.00', 1, 'Cable')], '0.00'));
    expect(invoice.snapshot).toMatchObject({ shipping: '0.00', total: '20.00' });
  });
});

describe('Historical facts', () => {
  it('sorts items by createdAt even when the input is unsorted', () => {
    const [invoice] = decide(paidOrder({}, [line(1, '24.50', 2, 'USB-C braided cable 2 m'), line(0, '1299.00', 1, 'ElectroBook Pro 14 laptop')]));
    expect(invoice.snapshot?.items.map(item => item.name)).toEqual(['ElectroBook Pro 14 laptop', 'USB-C braided cable 2 m']);
  });

  it('breaks createdAt ties by ascending item id', () => {
    const sameTime = new Date('2026-10-01T10:00:00.000Z');
    const later = { ...line(0, '1.00', 1, 'Second id'), id: '00000000-0000-4000-8000-000000000002', createdAt: sameTime };
    const earlier = { ...line(1, '1.00', 1, 'First id'), id: '00000000-0000-4000-8000-000000000001', createdAt: sameTime };
    const [invoice] = decide(pricedOrder([later, earlier]));
    expect(invoice.snapshot?.items.map(item => item.name)).toEqual(['First id', 'Second id']);
  });

  it('item lines expose only name, sku, quantity and the two money strings (no internal ids)', () => {
    const [invoice] = decide(paidOrder());
    for (const item of invoice.snapshot?.items ?? []) {
      expect(Object.keys(item).sort()).toEqual(['lineTotal', 'name', 'quantity', 'sku', 'unitPrice']);
    }
  });

  it('receipt snapshot has no items and no shipping identity', () => {
    const [, receipt] = decide(paidOrder());
    expect(receipt.snapshot?.items).toEqual([]);
    expect(receipt.snapshot?.shipTo).toBeNull();
    expect(receipt.snapshot?.delivery).toBeNull();
  });

  it('no phone number, provider id, payment id or user id appears in any serialized snapshot', () => {
    const order = Object.assign(paidOrder(), { shippingPhone: '+1 555 0100' });
    const serialized = JSON.stringify(decide(order).map(decision => decision.snapshot));
    expect(serialized).not.toContain('555');
    expect(serialized).not.toContain('0100');
    expect(serialized).not.toContain('phone');
    expect(serialized).not.toContain('pi_synthetic_0001');
    expect(serialized).not.toContain(PAYMENT_ID);
    expect(serialized).not.toContain(USER_ID);
  });

  it.each([
    ['visa', '4242', 'visa', '4242'],
    ['VISA', '4242', 'visa', '4242'],
    [null, '4242', null, null],
    ['visa', null, null, null],
    ['visa', '42', null, null],
    ['visa', '42424', null, null],
    ['visa', '42a2', null, null],
    ['vi5a!', '4242', null, null],
    ['', '4242', null, null],
  ])('card brand %s with last4 %s renders as %s / %s', (cardBrand, cardLast4, expectedBrand, expectedLast4) => {
    const [invoice] = decide(withPayment(paidOrder(), { cardBrand, cardLast4 }));
    expect(invoice.snapshot?.payment).toMatchObject({ cardBrand: expectedBrand, cardLast4: expectedLast4 });
  });
});

describe('Determinism and content version', () => {
  it('evaluating the same order twice yields identical versions in the v1 format', () => {
    const first = decide(paidOrder()).map(decision => decision.contentVersion);
    const second = decide(paidOrder()).map(decision => decision.contentVersion);
    expect(second).toEqual(first);
    for (const version of first) expect(version).toMatch(/^v1\.[0-9a-f]{32}$/);
  });

  it('each kind has its own content version', () => {
    const [invoice, receipt, summary] = decide(paidOrder()).map(decision => decision.contentVersion);
    expect(new Set([invoice, receipt, summary]).size).toBe(3);
  });

  it('changing the assetVersion argument changes every version and is echoed in the snapshot', () => {
    const base = decide(paidOrder());
    const other = evaluateDocuments(paidOrder(), 'assets-other');
    for (let index = 0; index < 3; index += 1) {
      expect(other[index].contentVersion).not.toBe(base[index].contentVersion);
    }
    expect(other[0].snapshot?.assetVersion).toBe('assets-other');
  });

  it('adding a refund annotation changes the invoice version', () => {
    const paid = decide(paidOrder())[0].contentVersion;
    const refunded = decide(refundedOrder())[0].contentVersion;
    expect(refunded).not.toBe(paid);
  });

  it('a refund amount alone (refundId bound vs absent) changes the version', () => {
    const withAmount = decide(refundedOrder())[0].contentVersion;
    const withoutAmount = decide(refundedOrder({ refundId: null }))[0].contentVersion;
    expect(withoutAmount).not.toBe(withAmount);
  });

  it('canonicalJson sorts object keys recursively and keeps array order', () => {
    expect(canonicalJson({ b: 1, a: { d: [{ z: 1, y: null }], c: 'x' } })).toBe('{"a":{"c":"x","d":[{"y":null,"z":1}]},"b":1}');
    expect(canonicalJson([2, 1])).toBe('[2,1]');
  });

  it('canonicalJson ignores object key insertion order', () => {
    expect(canonicalJson({ a: 1, b: { c: 2, d: 3 } })).toBe(canonicalJson({ b: { d: 3, c: 2 }, a: 1 }));
  });
});

describe('Display normalization and identifiers', () => {
  it('displayText strips U+202E and U+2066..U+2069 bidi controls', () => {
    expect(displayText('Laptop‮gnp.exe')).toBe('Laptopgnp.exe');
    expect(displayText('A⁦B⁩C')).toBe('ABC');
  });

  it('displayText turns C0 controls into spaces and collapses whitespace', () => {
    expect(displayText('a\u0001b\tc')).toBe('a b c');
  });

  it('displayText applies NFC normalization', () => {
    expect(displayText('é')).toBe('é');
  });

  it('displayText returns an empty string for null or undefined', () => {
    expect(displayText(null)).toBe('');
    expect(displayText(undefined)).toBe('');
  });

  it('documentFilename is brand + reference + kind with a .pdf extension', () => {
    expect(documentFilename('ORD-X', 'invoice')).toBe('ElectroHub-ORD-X-invoice.pdf');
    expect(documentFilename('ORD-X', 'receipt')).toBe('ElectroHub-ORD-X-receipt.pdf');
    expect(documentFilename('ORD-X', 'summary')).toBe('ElectroHub-ORD-X-summary.pdf');
  });

  it('receiptReference is stable, well-formed, exact for the fixture payment, and hides the payment id', () => {
    const reference = receiptReference(PAYMENT_ID);
    expect(reference).toBe('RCT-253CDC1B7B62');
    expect(receiptReference(PAYMENT_ID)).toBe(reference);
    expect(reference).toMatch(/^RCT-[0-9A-F]{12}$/);
    expect(reference).not.toContain(PAYMENT_ID);
    expect(reference.toLowerCase()).not.toContain(PAYMENT_ID.replace(/-/g, ''));
    expect(receiptReference('33333333-3333-4333-8333-333333333333')).not.toBe(reference);
  });
});

describe('Exact decimal arithmetic', () => {
  it('validates the 0.10 x 3 + 0.20 case without binary floating-point drift', () => {
    const order = pricedOrder([line(0, '0.10', 3, 'Tiny A'), line(1, '0.20', 1, 'Tiny B')]);
    const [invoice] = decide(order);
    expect(invoice.available).toBe(true);
    expect(invoice.snapshot).toMatchObject({ subtotal: '0.50', shipping: '9.99', total: '10.49' });
    expect(invoice.snapshot?.items.map(item => item.lineTotal)).toEqual(['0.30', '0.20']);
  });
});
