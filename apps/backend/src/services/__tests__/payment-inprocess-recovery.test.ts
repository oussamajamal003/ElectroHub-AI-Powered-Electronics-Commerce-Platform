import { describe, expect, it } from 'vitest';
import { inProcessRecoveryEnabled } from '../../payment-inprocess-recovery.js';

describe('in-process payment recovery switch', () => {
  // Task 03.6 isolation gate: on by default only where this process may mutate its payment target.
  it('is on by default when payments are configured against a target this process may mutate', () => {
    const disposable = 'postgresql://postgres:p@localhost:55433/electrohub_disposable';
    const shared = 'postgresql://u:p@aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres';
    expect(inProcessRecoveryEnabled({ NODE_ENV: 'development', STRIPE_SECRET_KEY: 'sk_test_x', DATABASE_URL: disposable, DIRECT_URL: disposable })).toBe(true);
    expect(inProcessRecoveryEnabled({ NODE_ENV: 'production', STRIPE_SECRET_KEY: 'sk_test_x', DATABASE_URL: shared, DIRECT_URL: shared,
      PAYMENT_SHARED_MUTATIONS_APPROVED: 'aws-0-ap-northeast-2.pooler.supabase.com:6543/postgres' })).toBe(true);
    expect(inProcessRecoveryEnabled({ NODE_ENV: 'development', STRIPE_SECRET_KEY: 'sk_test_x', DATABASE_URL: shared, DIRECT_URL: shared })).toBe(false);
    expect(inProcessRecoveryEnabled({ NODE_ENV: 'production', STRIPE_SECRET_KEY: 'sk_test_x' })).toBe(false);
  });
  it('is off under tests, without a Stripe key, or when a dedicated supervised worker is the only runner', () => {
    expect(inProcessRecoveryEnabled({ NODE_ENV: 'test', STRIPE_SECRET_KEY: 'sk_test_x' })).toBe(false);
    expect(inProcessRecoveryEnabled({ NODE_ENV: 'development' })).toBe(false);
    expect(inProcessRecoveryEnabled({ NODE_ENV: 'production', STRIPE_SECRET_KEY: 'sk_test_x', PAYMENT_INPROCESS_RECOVERY: 'false' })).toBe(false);
  });
});
