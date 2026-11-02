import { afterEach, describe, expect, it, vi } from 'vitest';
import { sharedDevSimulationScope, simulationAvailability } from './simulation.config.js';
import { activateDeliveryQaRuntime, deactivateDeliveryQaRuntime } from '../../delivery-qa-runtime.config.js';

const dev = 'postgresql://postgres.pzxekjybdiulzmssalfo:x@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres';
const prod = dev.replace('pzxekjybdiulzmssalfo', 'yepfgjehdstlxbpespun');
const base = { NODE_ENV: 'development', DATABASE_URL: dev, DIRECT_URL: dev, DELIVERY_SIMULATION_ENABLED: 'true',
  DELIVERY_SHARED_DEV_QA: 'true', DELIVERY_SHARED_DEV_SIMULATION: 'true', DELIVERY_QA_RUN_ID: 'QA-DELIVERY-20261101-abcd',
  STRIPE_SECRET_KEY: '', BREVO_API_KEY: '', COMMERCE_EMAIL_ENQUEUE_ENABLED: 'false', COMMERCE_EMAIL_DISPATCH_ENABLED: 'false', COMMERCE_EMAIL_SEND_MODE: 'disabled',
  DELIVERY_QA_CUSTOMER_USER_ID: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', DELIVERY_QA_PRODUCT_ID: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
  DELIVERY_QA_ORDER_IDS: '12345678-1234-4234-8234-123456789abc' };

describe('shared DEV simulation scope', () => {
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
