import { describe, expect, it, vi } from 'vitest';
import { resolvePaymentIsolation } from '../payment-isolation.js';
import { inProcessRecoveryEnabled } from '../payment-inprocess-recovery.js';
import { PaymentService } from '../services/payment.service.js';

// Task 03.6 Principal Architect gate: starting, restarting or hot-reloading a local backend must not be able to modify a shared
// DEV/PROD payment record. Regression for 2026-10-17, when a watched `npm run dev` against shared DEV cancelled real purchases.
const shared = 'postgresql://user:secret@db.pzxekjybdiulzmssalfo.supabase.co:5432/postgres';
const disposable = 'postgresql://postgres:secret@localhost:55433/electrohub_disposable';
const env = (patch: Record<string, string | undefined>) => ({ NODE_ENV: 'development', ...patch }) as NodeJS.ProcessEnv;

describe('resolvePaymentIsolation', () => {
  it('denies the watched dev server on a shared target even when an approval is present (the exact 2026-10-17 configuration)', () => {
    const decision = resolvePaymentIsolation(env({ DATABASE_URL: shared, DIRECT_URL: shared, npm_lifecycle_event: 'dev',
      PAYMENT_SHARED_MUTATIONS_APPROVED: 'db.pzxekjybdiulzmssalfo.supabase.co:5432/postgres' }));
    expect(decision).toMatchObject({ allowed: false, target: 'shared', reason: 'watched-dev-server-on-shared-target' });
  });
  it('denies any shared target by default (no approval), in development and production', () => {
    for (const NODE_ENV of ['development', 'production']) {
      expect(resolvePaymentIsolation(env({ NODE_ENV, DATABASE_URL: shared, DIRECT_URL: shared }))).toMatchObject({ allowed: false, reason: 'shared-target-not-approved' });
    }
  });
  it('allows a shared target only for the exact approved identity, never a near match', () => {
    const base = { NODE_ENV: 'production', DATABASE_URL: shared, DIRECT_URL: shared };
    expect(resolvePaymentIsolation(env({ ...base, PAYMENT_SHARED_MUTATIONS_APPROVED: 'db.pzxekjybdiulzmssalfo.supabase.co:5432/postgres' })))
      .toMatchObject({ allowed: true, reason: 'shared-target-approved' });
    for (const near of ['true', '1', 'db.pzxekjybdiulzmssalfo.supabase.co/postgres', 'db.yepfgjehdstlxbpespun.supabase.co:5432/postgres']) {
      expect(resolvePaymentIsolation(env({ ...base, PAYMENT_SHARED_MUTATIONS_APPROVED: near })).allowed).toBe(false);
    }
  });
  it('allows a loopback disposable database, including under the watched dev server', () => {
    expect(resolvePaymentIsolation(env({ DATABASE_URL: disposable, DIRECT_URL: disposable, npm_lifecycle_event: 'dev' })))
      .toMatchObject({ allowed: true, target: 'disposable', identity: 'localhost:55433/electrohub_disposable' });
  });
  it('treats a disposable-looking name on a remote host, or one shared URL of two, as shared', () => {
    expect(resolvePaymentIsolation(env({ DATABASE_URL: 'postgresql://u:p@db.example.com:5432/electrohub_disposable' })).allowed).toBe(false);
    expect(resolvePaymentIsolation(env({ DATABASE_URL: disposable, DIRECT_URL: shared })).allowed).toBe(false);
    expect(resolvePaymentIsolation(env({ DATABASE_URL: 'postgresql://u:p@localhost:5432/postgres' })).allowed).toBe(false);
  });
  it('never puts credentials in the loggable identity, and denies an unconfigured database', () => {
    expect(resolvePaymentIsolation(env({ DATABASE_URL: shared, DIRECT_URL: shared })).identity).not.toContain('secret');
    expect(resolvePaymentIsolation(env({}))).toMatchObject({ allowed: false, reason: 'database-unconfigured' });
  });
});

describe('a denied process mutates nothing', () => {
  const denied = () => ({ allowed: false, target: 'shared', identity: 'x', reason: 'watched-dev-server-on-shared-target' }) as const;
  it('does not start in-process recovery on a shared target (start or hot-reload)', () => {
    expect(inProcessRecoveryEnabled(env({ DATABASE_URL: shared, DIRECT_URL: shared, STRIPE_SECRET_KEY: 'sk_test_x', npm_lifecycle_event: 'dev' }))).toBe(false);
    expect(inProcessRecoveryEnabled(env({ DATABASE_URL: disposable, DIRECT_URL: disposable, STRIPE_SECRET_KEY: 'sk_test_x', npm_lifecycle_event: 'dev' }))).toBe(true);
  });
  it('worker batches and process() claim nothing and call no provider; every customer payment write fails closed with 503', async () => {
    const database = new Proxy({}, { get: () => new Proxy({}, { get: () => vi.fn(() => { throw new Error('database touched'); }) }) });
    const provider = new Proxy({}, { get: () => vi.fn(() => { throw new Error('provider touched'); }) });
    const service = new PaymentService(database as never, provider as never, {} as never, denied);
    await expect(service.runBatch()).resolves.toBe(0);
    await expect(service.process('11111111-1111-4111-8111-111111111111')).resolves.toBeNull();
    const id = '11111111-1111-4111-8111-111111111111';
    for (const call of [() => service.submit('u', id), () => service.confirmationStarted('u', id),
      () => service.resume('u', id), () => service.restore('u', id), () => service.dismiss('u', id), () => service.acknowledge('u', id, 'DECLINED'),
      () => service.reconcile('u', id), () => service.cancel('u', id), () => service.wake(id), () => service.setup('u', 'k', {})]) {
      await expect(call()).rejects.toMatchObject({ statusCode: 503, code: 'PAYMENT_MUTATIONS_DISABLED' });
    }
  });
});
