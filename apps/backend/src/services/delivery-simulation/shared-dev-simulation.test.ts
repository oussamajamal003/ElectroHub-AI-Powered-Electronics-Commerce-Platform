import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { activeSharedDevSimulationScope, devDemoSimulationScope, sharedDevSimulationScope, simulationAvailability } from './simulation.config.js';
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
  it('is refused for production, other databases, missing opt-in or malformed allowlists', () => {
    for (const patch of [{ NODE_ENV: 'production' }, { DELIVERY_DEV_DEMO: '' }, { DELIVERY_SIMULATION_ENABLED: '' }, { DATABASE_URL: prod }, { DIRECT_URL: prod },
      { DELIVERY_DEV_DEMO_RUN_ID: 'ordinary' }, { DELIVERY_DEV_DEMO_ORDER_IDS: '' },
      { DELIVERY_DEV_DEMO_ORDER_IDS: 'not-a-uuid' }, { DELIVERY_DEV_DEMO_CUSTOMER_USER_ID: '' }, { DELIVERY_DEV_DEMO_PRODUCT_ID: '' },
      { DELIVERY_DEV_DEMO_ORDER_IDS: `${base.DELIVERY_QA_ORDER_IDS},${base.DELIVERY_QA_ORDER_IDS}` }]) {
      expect(devDemoSimulationScope({ ...demo, ...patch })).toBeNull();
      expect(simulationAvailability({ ...demo, ...patch }).enabled).toBe(false);
    }
  });
  it('is never inferred from the dedicated QA flags and does not enable ordinary processes by itself', () => {
    expect(devDemoSimulationScope(base)).toBeNull();
    for (const name of Object.keys(demo)) vi.stubEnv(name, '');
    expect(simulationAvailability().enabled).toBe(false);
  });
  it('is picked up by the process-wide scope used by the runner and the payment exception', () => {
    for (const [name, value] of Object.entries(demo)) vi.stubEnv(name, value);
    expect(activeSharedDevSimulationScope()?.orderIds).toEqual([base.DELIVERY_QA_ORDER_IDS]);
    expect(simulationAvailability()).toEqual({ enabled: true });
  });
});
