import { describe, expect, it } from 'vitest';
import { assertDeliveryQaRuntime, deliveryQaPoolOptions } from './delivery-qa-runtime.config.js';

const url = (ref: string) => `postgresql://postgres.${ref}:x@aws-0-ap-northeast-2.pooler.supabase.com:5432/postgres`;
const dev = url('pzxekjybdiulzmssalfo');
const valid = { NODE_ENV: 'development', DELIVERY_SHARED_DEV_QA: 'true', DATABASE_URL: dev, DIRECT_URL: dev,
  STRIPE_SECRET_KEY: '', BREVO_API_KEY: '', COMMERCE_EMAIL_ENQUEUE_ENABLED: 'false', COMMERCE_EMAIL_DISPATCH_ENABLED: 'false',
  COMMERCE_EMAIL_SEND_MODE: 'disabled' };
describe('delivery QA runtime safety', () => {
  it('accepts only the explicit worker-free DEV configuration', () => {
    expect(() => assertDeliveryQaRuntime(valid)).not.toThrow();
    for (const patch of [{ NODE_ENV: 'production' }, { DELIVERY_SHARED_DEV_QA: '' }, { DIRECT_URL: url('yepfgjehdstlxbpespun') },
      { DATABASE_URL: url('yepfgjehdstlxbpespun'), DIRECT_URL: url('yepfgjehdstlxbpespun') }, { BREVO_API_KEY: 'key' },
      { STRIPE_SECRET_KEY: 'key' }, { COMMERCE_EMAIL_ENQUEUE_ENABLED: 'true' }, { COMMERCE_EMAIL_DISPATCH_ENABLED: 'true' },
      { COMMERCE_EMAIL_SEND_MODE: 'live' }]) expect(() => assertDeliveryQaRuntime({ ...valid, ...patch })).toThrow();
  });
  it('limits only a fully validated QA pool and rejects unsafe opt-ins', () => {
    expect(deliveryQaPoolOptions(valid)).toEqual({ max: 2, min: 0, idleTimeoutMillis: 10_000 });
    expect(deliveryQaPoolOptions({})).toBeNull();
    expect(() => deliveryQaPoolOptions({ ...valid, NODE_ENV: 'production' })).toThrow();
    expect(() => deliveryQaPoolOptions({ ...valid, BREVO_API_KEY: 'configured' })).toThrow();
    expect(() => deliveryQaPoolOptions({ ...valid, DIRECT_URL: url('yepfgjehdstlxbpespun') })).toThrow();
  });
});
