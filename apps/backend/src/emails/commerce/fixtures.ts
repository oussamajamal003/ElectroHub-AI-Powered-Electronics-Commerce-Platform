/**
 * Deterministic commerce email snapshots for tests and local preview rendering. Every fixture must pass its zod schema.
 * Images use only https://images.example.com URLs; malicious values exercise HTML escaping.
 */
import {
  type CommerceEmailSnapshot,
  type SnapshotOf,
} from '../../services/commerce-email.domain.js';

const REFERENCE = 'ORD-3F2504E0-4F89-41D3-9A0C-0305E82C3301';
const OCCURRED_AT = '2026-10-18T09:30:00Z';
const SHIPPED_AT = '2026-10-19T14:05:00Z';
const DELIVERED_AT = '2026-10-27T11:20:00Z';
const PAID_AT = '2026-10-18T09:31:12Z';
const REFUNDED_AT = '2026-10-21T16:45:00Z';
const IMAGE_BASE = 'https://images.example.com/products';

type ConfirmedItem = SnapshotOf<'ORDER_CONFIRMED'>['items'][number];

const DELIVERY = {
  method: 'STANDARD',
  label: 'Standard delivery',
  estimatedStart: '2026-10-23',
  estimatedEnd: '2026-10-27',
} as const;

const ADDRESS = {
  recipient: 'Amina Benali',
  line1: '12 Rue de la Paix',
  line2: 'Apt 4B',
  city: 'Lyon',
  state: null,
  postalCode: '69002',
  country: 'France',
} as const;

const BASE_ITEMS: readonly ConfirmedItem[] = [
  {
    name: 'Oscilloscope 100 MHz Dual Channel',
    sku: 'SKU-OSC-100',
    quantity: 1,
    unitPrice: '249.00',
    lineTotal: '249.00',
    imageUrl: `${IMAGE_BASE}/oscilloscope-100.jpg`,
  },
  {
    name: 'Breadboard Kit 830 Points',
    sku: 'SKU-BB-830',
    quantity: 2,
    unitPrice: '12.50',
    lineTotal: '25.00',
    imageUrl: null,
  },
];

/** Builds `count` deterministic items with unique SKUs, every one carrying an HTTPS image. */
function generatedItems(count: number): ConfirmedItem[] {
  return Array.from({ length: count }, (_, index) => {
    const quantity = (index % 3) + 1;
    const unit = 100 + index * 7;
    const total = unit * quantity;
    return {
      name: `Module ${String(index + 1).padStart(3, '0')} sensor board`,
      sku: `SKU-GEN-${String(index + 1).padStart(3, '0')}`,
      quantity,
      unitPrice: `${unit}.00`,
      lineTotal: `${total}.00`,
      imageUrl: `${IMAGE_BASE}/module-${index + 1}.jpg`,
    };
  });
}

function sumItems(items: readonly ConfirmedItem[]): number {
  return items.reduce((sum, item) => sum + Number(item.lineTotal.replace('.', '')), 0);
}

/** Subtotal, shipping and total as exact cent strings (integer cents, no floating point). */
function totalsFor(items: readonly ConfirmedItem[], shippingCents: number) {
  const subtotalCents = sumItems(items);
  const format = (cents: number) => `${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`;
  return { subtotal: format(subtotalCents), shipping: format(shippingCents), total: format(subtotalCents + shippingCents) };
}

function orderConfirmed(overrides: {
  items?: readonly ConfirmedItem[];
  shippingCents?: number;
  recipientName?: string | null;
  shippingAddress?: SnapshotOf<'ORDER_CONFIRMED'>['shippingAddress'];
  delivery?: SnapshotOf<'ORDER_CONFIRMED'>['delivery'];
} = {}): SnapshotOf<'ORDER_CONFIRMED'> {
  const items = overrides.items ?? BASE_ITEMS;
  const totals = totalsFor(items, overrides.shippingCents ?? 0);
  return {
    v: 1,
    type: 'ORDER_CONFIRMED',
    orderReference: REFERENCE,
    occurredAt: OCCURRED_AT,
    recipientName: overrides.recipientName === undefined ? 'Amina' : overrides.recipientName,
    items: [...items],
    currency: 'USD',
    delivery: overrides.delivery ?? DELIVERY,
    shippingAddress: overrides.shippingAddress ?? ADDRESS,
    ...totals,
  };
}

const orderConfirmedMaliciousItems: readonly ConfirmedItem[] = [
  {
    name: '<script>alert(1)</script>',
    sku: '"><img src=x onerror=alert(1)>',
    quantity: 1,
    unitPrice: '10.00',
    lineTotal: '10.00',
    imageUrl: null,
  },
  {
    name: "Tom & Jerry's <b>Cable</b>",
    sku: 'SKU-`TJ`-1',
    quantity: 3,
    unitPrice: '4.00',
    lineTotal: '12.00',
    imageUrl: null,
  },
];

const LONG_NAME = 'Ultra-precision programmable laboratory power supply with dual outputs and remote monitoring '
  + 'interface for bench automation workflows and calibration '.repeat(3);

export const commerceEmailFixtures = {
  orderConfirmed: orderConfirmed({ shippingCents: 0 }),
  orderConfirmedPaidShipping: orderConfirmed({ shippingCents: 1200 }),
  paymentConfirmed: {
    v: 1,
    type: 'PAYMENT_CONFIRMED',
    orderReference: REFERENCE,
    occurredAt: OCCURRED_AT,
    recipientName: 'Amina',
    amount: '274.00',
    currency: 'USD',
    paidAt: PAID_AT,
    card: { brand: 'visa', last4: '4242' },
  } satisfies SnapshotOf<'PAYMENT_CONFIRMED'>,
  orderPreparing: {
    v: 1,
    type: 'ORDER_PREPARING',
    orderReference: REFERENCE,
    occurredAt: SHIPPED_AT,
    recipientName: 'Amina',
    fromStatus: 'CONFIRMED',
    toStatus: 'PREPARING',
    delivery: DELIVERY,
  } satisfies SnapshotOf<'ORDER_PREPARING'>,
  orderOutForDelivery: {
    v: 1,
    type: 'ORDER_OUT_FOR_DELIVERY',
    orderReference: REFERENCE,
    occurredAt: '2026-10-23T08:10:00Z',
    recipientName: 'Amina',
    fromStatus: 'PREPARING',
    toStatus: 'OUT_FOR_DELIVERY',
    delivery: DELIVERY,
  } satisfies SnapshotOf<'ORDER_OUT_FOR_DELIVERY'>,
  orderDelivered: {
    v: 1,
    type: 'ORDER_DELIVERED',
    orderReference: REFERENCE,
    occurredAt: DELIVERED_AT,
    recipientName: 'Amina',
    fromStatus: 'OUT_FOR_DELIVERY',
    toStatus: 'DELIVERED',
  } satisfies SnapshotOf<'ORDER_DELIVERED'>,
  orderCancelledUnpaid: {
    v: 1,
    type: 'ORDER_CANCELLED',
    orderReference: REFERENCE,
    occurredAt: '2026-10-18T10:02:00Z',
    recipientName: 'Amina',
    fromStatus: 'AWAITING_CAPTURE',
    toStatus: 'CANCELLED',
    paymentConfirmed: false,
    refund: null,
  } satisfies SnapshotOf<'ORDER_CANCELLED'>,
  orderCancelledPaidNoRefund: {
    v: 1,
    type: 'ORDER_CANCELLED',
    orderReference: REFERENCE,
    occurredAt: '2026-10-18T10:02:00Z',
    recipientName: 'Amina',
    fromStatus: 'CONFIRMED',
    toStatus: 'CANCELLED',
    paymentConfirmed: true,
    refund: null,
  } satisfies SnapshotOf<'ORDER_CANCELLED'>,
  orderCancelledRefunded: {
    v: 1,
    type: 'ORDER_CANCELLED',
    orderReference: REFERENCE,
    occurredAt: '2026-10-18T10:02:00Z',
    recipientName: 'Amina',
    fromStatus: 'CONFIRMED',
    toStatus: 'CANCELLED',
    paymentConfirmed: true,
    refund: { amount: '274.00', currency: 'USD' },
  } satisfies SnapshotOf<'ORDER_CANCELLED'>,
  paymentRefunded: {
    v: 1,
    type: 'PAYMENT_REFUNDED',
    orderReference: REFERENCE,
    occurredAt: '2026-10-21T16:44:00Z',
    recipientName: 'Amina',
    refundId: 're_3QXYZ123abc',
    amount: '274.00',
    currency: 'USD',
    refundedAt: REFUNDED_AT,
  } satisfies SnapshotOf<'PAYMENT_REFUNDED'>,

  // Stress and missing-optional fixtures.
  orderConfirmedMaliciousNames: orderConfirmed({
    items: orderConfirmedMaliciousItems,
    shippingCents: 500,
    recipientName: '"><img src=x onerror=alert(1)>',
    shippingAddress: {
      recipient: "Tom & Jerry's <b>",
      line1: '<script>alert(1)</script> Street',
      line2: '"><img src=x onerror=alert(1)>',
      city: '<script>alert(2)</script>',
      state: 'Tom & Jerry',
      postalCode: '<b>1</b>',
      country: 'France & <i>Monaco</i>',
    },
  }),
  orderConfirmedLongNames: orderConfirmed({
    items: [
      { name: LONG_NAME.slice(0, 200), sku: 'SKU-LONG-200', quantity: 1, unitPrice: '1500.00', lineTotal: '1500.00', imageUrl: null },
      { name: 'W'.repeat(120), sku: 'S'.repeat(100), quantity: 2, unitPrice: '2.00', lineTotal: '4.00', imageUrl: null },
    ],
  }),
  orderConfirmed25Items: orderConfirmed({ items: generatedItems(25), shippingCents: 1200 }),
  orderConfirmed100Items: orderConfirmed({ items: generatedItems(100), shippingCents: 1200 }),
  orderConfirmedLargeAmount: orderConfirmed({
    items: [{ name: 'Industrial spectrum analyser', sku: 'SKU-SA-9000', quantity: 1, unitPrice: '1234567.80',
      lineTotal: '1234567.80', imageUrl: null }],
  }),
  orderConfirmedMinimalOptional: orderConfirmed({
    items: [{ name: 'Resistor pack', sku: 'SKU-RES-1', quantity: 1, unitPrice: '3.00', lineTotal: '3.00', imageUrl: null }],
    recipientName: null,
    delivery: { method: 'EXPRESS', label: 'Express delivery', estimatedStart: '2026-10-19', estimatedEnd: '2026-10-19' },
    shippingAddress: {
      recipient: 'Amina Benali',
      line1: '12 Rue de la Paix',
      line2: null,
      city: 'Lyon',
      state: null,
      postalCode: null,
      country: 'France',
    },
  }),
  paymentConfirmedNoCard: {
    v: 1,
    type: 'PAYMENT_CONFIRMED',
    orderReference: REFERENCE,
    occurredAt: OCCURRED_AT,
    recipientName: null,
    amount: '9999999.99',
    currency: 'USD',
    paidAt: PAID_AT,
    card: null,
  } satisfies SnapshotOf<'PAYMENT_CONFIRMED'>,
  paymentConfirmedMaxAmount: {
    v: 1,
    type: 'PAYMENT_CONFIRMED',
    orderReference: REFERENCE,
    occurredAt: OCCURRED_AT,
    recipientName: 'Amina',
    amount: '9999999.99',
    currency: 'USD',
    paidAt: PAID_AT,
    card: { brand: 'american_express', last4: '0005' },
  } satisfies SnapshotOf<'PAYMENT_CONFIRMED'>,
  paymentConfirmedEuro: {
    v: 1,
    type: 'PAYMENT_CONFIRMED',
    orderReference: REFERENCE,
    occurredAt: OCCURRED_AT,
    recipientName: 'Amina',
    amount: '1234567.80',
    currency: 'EUR',
    paidAt: PAID_AT,
    card: { brand: 'mastercard', last4: '5555' },
  } satisfies SnapshotOf<'PAYMENT_CONFIRMED'>,
} satisfies Record<string, CommerceEmailSnapshot>;

export type CommerceEmailFixtureName = keyof typeof commerceEmailFixtures;
