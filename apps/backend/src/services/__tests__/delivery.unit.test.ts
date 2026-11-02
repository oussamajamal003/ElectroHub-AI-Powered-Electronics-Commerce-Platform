import { afterEach, describe, expect, it, vi } from 'vitest';

// Pure domain checks: no database client is created (the test DB guard refuses non-disposable targets).
vi.mock('../../lib/prisma.js', () => ({ prisma: {} }));
import { customerTimeline, paymentEligible, trackingReference } from '../delivery.service.js';
import { deliveryUpdateSchema } from '../../validators/delivery.validator.js';
import { activateDeliveryQaRuntime, deactivateDeliveryQaRuntime } from '../../delivery-qa-runtime.config.js';

const now = new Date('2026-11-01T12:00:00.000Z');
const schema = deliveryUpdateSchema(() => now);

describe('Task 04.5 delivery domain (unit)', () => {
  afterEach(() => { deactivateDeliveryQaRuntime(); vi.unstubAllEnvs(); });
  it('permits only explicitly scoped, tagged, unpaid zero-value test fixtures on DEV', () => {
    const id = '12345678-1234-4234-8234-123456789abc';
    const runId = 'QA-DELIVERY-20261101-abcd';
    const url = 'postgresql://postgres.pzxekjybdiulzmssalfo:x@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres';
    for (const [name, value] of Object.entries({ NODE_ENV: 'development', DATABASE_URL: url, DIRECT_URL: url,
      DELIVERY_SIMULATION_ENABLED: 'true', DELIVERY_SHARED_DEV_QA: 'true', DELIVERY_SHARED_DEV_SIMULATION: 'true',
      STRIPE_SECRET_KEY: '', BREVO_API_KEY: '', COMMERCE_EMAIL_ENQUEUE_ENABLED: 'false', COMMERCE_EMAIL_DISPATCH_ENABLED: 'false', COMMERCE_EMAIL_SEND_MODE: 'disabled',
      DELIVERY_QA_RUN_ID: runId, DELIVERY_QA_ORDER_IDS: id, DELIVERY_QA_CUSTOMER_USER_ID: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', DELIVERY_QA_PRODUCT_ID: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' })) vi.stubEnv(name, value);
    const fixture = { id, status: 'CONFIRMED', payment: null, paymentAttempt: null, shippingRecipient: runId, shippingLine1: runId,
      total: { isZero: () => true }, userId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', items: [{ product: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', isTestFixture: true } }] };
    const eligible = (value: object) => paymentEligible(value as Parameters<typeof paymentEligible>[0]);
    expect(eligible(fixture)).toBe(false);
    activateDeliveryQaRuntime();
    expect(eligible(fixture)).toBe(true);
    for (const patch of [{ id: '22345678-1234-4234-8234-123456789abc' }, { shippingLine1: 'not a fixture' },
      { userId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }, { payment: { status: 'FAILED' } }, { paymentAttempt: { id } },
      { total: { isZero: () => false } }, { items: [] }, { items: [{ product: { id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', isTestFixture: false } }] }, { items: [{ product: { id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc', isTestFixture: true } }] }, { status: 'AWAITING_CAPTURE' }]) {
      expect(eligible({ ...fixture, ...patch })).toBe(false);
    }
    vi.stubEnv('DELIVERY_SHARED_DEV_SIMULATION', '');
    expect(eligible(fixture)).toBe(false);
    expect(eligible({ ...fixture, payment: { status: 'SUCCEEDED' } })).toBe(true);
  });
  it('generates EH-TRK- references from the Crockford alphabet only', () => {
    const seen = new Set(Array.from({ length: 200 }, trackingReference));
    expect(seen.size).toBe(200);
    for (const value of seen) expect(value).toMatch(/^EH-TRK-[0-9A-HJKMNP-TV-Z]{10}$/);
  });

  it('projects one customer entry per visible aspect, never LOCATION, status before ETA within an event', () => {
    const at = new Date('2026-11-01T10:00:00.000Z');
    const entries = customerTimeline([
      { id: 'e4', type: 'LOCATION_UPDATED', changes: ['LOCATION'], toStatus: null, estimatedAt: null, occurredAt: at },
      { id: 'e3', type: 'STATUS_CHANGED', changes: ['STATUS', 'LOCATION', 'ETA'], toStatus: 'OUT_FOR_DELIVERY', estimatedAt: at, occurredAt: at },
      { id: 'e2', type: 'ETA_CLEARED', changes: ['ETA'], toStatus: null, estimatedAt: null, occurredAt: at },
      { id: 'e1', type: 'TRACKING_STARTED', changes: [], toStatus: 'CONFIRMED', estimatedAt: null, occurredAt: at },
    ]);
    expect(entries.map(entry => [entry.id, entry.type])).toEqual([['e3:status', 'STATUS_CHANGED'], ['e3:eta', 'ETA_UPDATED'], ['e2:eta', 'ETA_CLEARED'],
      ['e1', 'TRACKING_STARTED']]);
    expect(customerTimeline(Array.from({ length: 80 }, (_, index) => ({ id: `x${index}`, type: 'ETA_UPDATED' as const, changes: ['ETA' as const],
      toStatus: null, estimatedAt: at, occurredAt: at })))).toHaveLength(50);
  });

  it('validates PATCH bodies strictly (T5-13, T5-15)', () => {
    const ok = (body: unknown) => schema.safeParse(body).success;
    expect(ok({ expectedRevision: 1, status: 'PREPARING' })).toBe(true);
    expect(ok({ expectedRevision: 3, location: { latitude: -90, longitude: 180, label: '  ' } })).toBe(true);
    expect(schema.parse({ expectedRevision: 3, location: { latitude: 1, longitude: 2, label: '  ' } }).location).toEqual({ latitude: 1, longitude: 2, label: null });
    expect(ok({ expectedRevision: 1, location: null })).toBe(true);
    expect(ok({ expectedRevision: 1, estimatedAt: null })).toBe(true);
    expect(ok({ expectedRevision: 1, estimatedAt: '2026-11-01T11:56:00.000Z' })).toBe(true);
    expect(ok({ expectedRevision: 1, estimatedAt: '2026-11-01T11:00:00.000Z' })).toBe(false);
    expect(ok({ expectedRevision: 1, estimatedAt: '2026-12-02T12:00:00.000Z' })).toBe(false);
    expect(ok({ expectedRevision: 1, location: { latitude: 91, longitude: 0 } })).toBe(false);
    expect(ok({ expectedRevision: 1, location: { latitude: 0, longitude: -180.5 } })).toBe(false);
    expect(ok({ expectedRevision: 1, location: { latitude: Number.NaN, longitude: 0 } })).toBe(false);
    expect(ok({ expectedRevision: 1, location: { latitude: 1, longitude: 1, label: 'x'.repeat(81) } })).toBe(false);
    expect(ok({ expectedRevision: 1, note: 'only a note' })).toBe(false);
    expect(ok({ expectedRevision: 1, status: 'CONFIRMED' })).toBe(false);
    expect(ok({ expectedRevision: 1, status: 'PREPARING', note: 'x'.repeat(281) })).toBe(false);
    for (const smuggled of ['userId', 'actorUserId', 'paymentStatus', 'isPaid', 'isSimulated', 'source', 'revisionOverride']) {
      expect(ok({ expectedRevision: 1, status: 'PREPARING', [smuggled]: 'x' }), smuggled).toBe(false);
    }
  });
});
