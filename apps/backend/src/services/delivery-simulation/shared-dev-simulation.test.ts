import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../../lib/prisma.js', () => ({ prisma: {} }));
import { activeSharedDevSimulationScope, devDemoSimulationScope, devWideSimulationEnabled, simulationMode, sharedDevSimulationScope, simulationAvailability } from './simulation.config.js';
import { paymentEligible } from '../delivery.service.js';
import { activateDeliveryQaRuntime, deactivateDeliveryQaRuntime } from '../../delivery-qa-runtime.config.js';

const dev = 'postgresql://postgres.pzxekjybdiulzmssalfo:x@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres';
const prod = dev.replace('pzxekjybdiulzmssalfo', 'yepfgjehdstlxbpespun');
const base = { NODE_ENV: 'development', DATABASE_URL: dev, DIRECT_URL: dev, DELIVERY_SIMULATION_ENABLED: 'true',
  DELIVERY_SHARED_DEV_QA: 'true', DELIVERY_SHARED_DEV_SIMULATION: 'true', DELIVERY_QA_RUN_ID: 'QA-DELIVERY-20261101-abcd',
  STRIPE_SECRET_KEY: '', BREVO_API_KEY: '', COMMERCE_EMAIL_ENQUEUE_ENABLED: 'false', COMMERCE_EMAIL_DISPATCH_ENABLED: 'false', COMMERCE_EMAIL_SEND_MODE: 'disabled',
  DELIVERY_QA_CUSTOMER_USER_ID: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', DELIVERY_QA_PRODUCT_ID: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  DELIVERY_QA_ORDER_IDS: '12345678-1234-4234-8234-123456789abc' };

describe('shared DEV simulation scope', () => {
  // Hermetic: a developer's local .env may carry the permanent DEV demo scope.
  beforeEach(() => { for (const name of ['DELIVERY_DEV_DEMO', 'DELIVERY_SIMULATION_ENABLED']) vi.stubEnv(name, ''); });
  afterEach(() => { deactivateDeliveryQaRuntime(); vi.unstubAllEnvs(); });
  it('does not enable the ordinary server merely because its environment has QA flags', () => {
    for (const [name, value] of Object.entries(base)) vi.stubEnv(name, value);
    expect(simulationAvailability().enabled).toBe(false);
    activateDeliveryQaRuntime();
    expect(simulationAvailability().enabled).toBe(true);
  });
  it('requires a separate opt-in, exact matching DEV targets and bounded run-specific IDs', () => {
    expect(sharedDevSimulationScope(base)?.orderIds).toEqual([base.DELIVERY_QA_ORDER_IDS]);
    expect(simulationAvailability(base)).toEqual({ enabled: true });
    for (const patch of [{ NODE_ENV: 'production' }, { DELIVERY_SHARED_DEV_SIMULATION: '' }, { DELIVERY_SHARED_DEV_QA: '' },
      { DELIVERY_SIMULATION_ENABLED: '' }, { DATABASE_URL: prod }, { DIRECT_URL: prod }, { DELIVERY_QA_RUN_ID: 'ordinary' },
      { DELIVERY_QA_CUSTOMER_USER_ID: '' }, { DELIVERY_QA_PRODUCT_ID: '' }, { DELIVERY_QA_ORDER_IDS: '' }, { DELIVERY_QA_ORDER_IDS: `${base.DELIVERY_QA_ORDER_IDS},${base.DELIVERY_QA_ORDER_IDS}` }]) {
      expect(sharedDevSimulationScope({ ...base, ...patch })).toBeNull();
      expect(simulationAvailability({ ...base, ...patch }).enabled).toBe(false);
    }
  });
});

describe('DEV demo simulation scope (ordinary shared-DEV backend)', () => {
  const demo = { NODE_ENV: 'development', DATABASE_URL: dev, DIRECT_URL: dev, DELIVERY_SIMULATION_ENABLED: 'true', DELIVERY_DEV_DEMO: 'true',
    DELIVERY_DEV_DEMO_RUN_ID: 'QA-DELIVERY-20261102-demo', DELIVERY_DEV_DEMO_CUSTOMER_USER_ID: base.DELIVERY_QA_CUSTOMER_USER_ID,
    DELIVERY_DEV_DEMO_PRODUCT_ID: base.DELIVERY_QA_PRODUCT_ID, DELIVERY_DEV_DEMO_ORDER_IDS: base.DELIVERY_QA_ORDER_IDS,
    // The ordinary backend keeps its integrations; eligibility never depends on them or on any port.
    STRIPE_SECRET_KEY: 'sk_test_x', PORT: '5000', FRONTEND_URL: 'http://localhost:3000' };
  it('enables the allowlisted orders on the verified DEV project regardless of ports or integrations', () => {
    expect(devDemoSimulationScope(demo)?.orderIds).toEqual([base.DELIVERY_QA_ORDER_IDS]);
    expect(simulationAvailability(demo)).toEqual({ enabled: true });
    for (const port of ['3000', '3100', '3330', '5000', '5330']) {
      expect(devDemoSimulationScope({ ...demo, PORT: port, FRONTEND_URL: `http://localhost:${port}` })).not.toBeNull();
    }
  });
  it('DEV-wide: enabled with only the opt-in and verified DEV identity (no allowlist, customer, product or marker), on any port', () => {
    const wide = { NODE_ENV: 'development', DATABASE_URL: dev, DIRECT_URL: dev, DELIVERY_SIMULATION_ENABLED: 'true', DELIVERY_DEV_DEMO: 'true' };
    expect(devWideSimulationEnabled(wide)).toBe(true);
    expect(simulationMode(wide)).toBe('DEV_WIDE');
    expect(simulationAvailability(wide)).toEqual({ enabled: true });
    for (const port of ['3000', '3100', '3330', '5000', '5330']) expect(simulationAvailability({ ...wide, PORT: port, FRONTEND_URL: `http://localhost:${port}` }).enabled).toBe(true);
    // It carries no payment privilege: without a fixture allowlist there is no unpaid exception scope at all.
    expect(devDemoSimulationScope(wide)).toBeNull();
  });
  it('DEV-wide is refused for production, other databases, missing opt-in or flag', () => {
    const wide = { NODE_ENV: 'development', DATABASE_URL: dev, DIRECT_URL: dev, DELIVERY_SIMULATION_ENABLED: 'true', DELIVERY_DEV_DEMO: 'true' };
    for (const patch of [{ NODE_ENV: 'production' }, { NODE_ENV: 'test' }, { DELIVERY_DEV_DEMO: '' }, { DELIVERY_SIMULATION_ENABLED: '' }, { DATABASE_URL: prod }, { DIRECT_URL: prod },
      { DATABASE_URL: '' }]) {
      expect(devWideSimulationEnabled({ ...wide, ...patch })).toBe(false);
      expect(simulationAvailability({ ...wide, ...patch }).enabled).toBe(false);
    }
  });
  it('the fixture scope (unpaid QA exception) still rejects malformed allowlists and is separate from DEV-wide', () => {
    for (const patch of [{ DELIVERY_DEV_DEMO_RUN_ID: 'ordinary' }, { DELIVERY_DEV_DEMO_ORDER_IDS: '' }, { DELIVERY_DEV_DEMO_ORDER_IDS: 'not-a-uuid' },
      { DELIVERY_DEV_DEMO_CUSTOMER_USER_ID: '' }, { DELIVERY_DEV_DEMO_PRODUCT_ID: '' }, { DELIVERY_DEV_DEMO_ORDER_IDS: `${base.DELIVERY_QA_ORDER_IDS},${base.DELIVERY_QA_ORDER_IDS}` }, { NODE_ENV: 'production' }, { DATABASE_URL: prod }]) {
      expect(devDemoSimulationScope({ ...demo, ...patch })).toBeNull();
    }
    expect(devWideSimulationEnabled({ ...demo, DELIVERY_DEV_DEMO_ORDER_IDS: '' })).toBe(true);
  });
  it('is never inferred from the dedicated QA flags and does not enable ordinary processes by itself', () => {
    expect(devDemoSimulationScope(base)).toBeNull();
    expect(devWideSimulationEnabled(base)).toBe(false);
    for (const name of Object.keys(demo)) vi.stubEnv(name, '');
    expect(simulationAvailability().enabled).toBe(false);
  });
  it('the fixture allowlist is still picked up by the process-wide payment-exception scope', () => {
    for (const [name, value] of Object.entries(demo)) vi.stubEnv(name, value);
    expect(activeSharedDevSimulationScope()?.orderIds).toEqual([base.DELIVERY_QA_ORDER_IDS]);
    expect(simulationAvailability()).toEqual({ enabled: true });
  });
});

describe('payment eligibility under DEV-wide simulation', () => {
  const order = (patch: Record<string, unknown>) => ({ id: '12345678-1234-4234-8234-123456789abc', status: 'OUT_FOR_DELIVERY', payment: null, paymentAttempt: null, userId: 'u',
    shippingRecipient: 'Ada', shippingLine1: '1 Main St', total: { isZero: () => false }, items: [{ product: { id: 'p', isTestFixture: false } }], ...patch }) as never;
  beforeEach(() => { for (const [k, v] of Object.entries({ NODE_ENV: 'development', DATABASE_URL: dev, DIRECT_URL: dev, DELIVERY_SIMULATION_ENABLED: 'true', DELIVERY_DEV_DEMO: 'true' })) vi.stubEnv(k, v); });
  afterEach(() => vi.unstubAllEnvs());
  it('any successfully paid order is eligible regardless of customer or product', () => {
    expect(paymentEligible(order({ payment: { status: 'SUCCEEDED' }, userId: 'other' }))).toBe(true);
    expect(paymentEligible(order({ payment: { status: 'SUCCEEDED' }, items: [{ product: { id: 'x', isTestFixture: false } }] }))).toBe(true);
  });
  it('ordinary unpaid, pending, failed or awaiting-capture orders stay ineligible: DEV-wide is not a payment bypass', () => {
    expect(paymentEligible(order({}))).toBe(false);
    expect(paymentEligible(order({ payment: { status: 'PENDING' } }))).toBe(false);
    expect(paymentEligible(order({ payment: { status: 'FAILED' } }))).toBe(false);
    expect(paymentEligible(order({ status: 'AWAITING_CAPTURE', payment: { status: 'SUCCEEDED' } }))).toBe(false);
    expect(paymentEligible(order({ total: { isZero: () => true }, shippingRecipient: 'QA-DELIVERY-20261101-abcd', shippingLine1: 'QA-DELIVERY-20261101-abcd' }))).toBe(false);
  });
});
