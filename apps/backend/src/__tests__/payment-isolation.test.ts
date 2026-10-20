import { describe, expect, it, vi } from 'vitest';
import { resolvePaymentIsolation } from '../payment-isolation.js';
import { inProcessRecoveryEnabled } from '../payment-inprocess-recovery.js';
import { PaymentService } from '../services/payment.service.js';

// Task 03.6 Principal Architect gate: starting, restarting or hot-reloading a local backend must not be able to modify a shared
// DEV/PROD payment record. Regression for 2026-10-17, when a watched `npm run dev` against shared DEV cancelled real purchases.
const shared = 'postgresql://postgres:secret@db.pzxekjybdiulzmssalfo.supabase.co:5432/postgres';
const production = shared.replace('pzxekjybdiulzmssalfo', 'yepfgjehdstlxbpespun');
const disposable = 'postgresql://postgres:secret@localhost:55433/electrohub_disposable';
const env = (patch: Record<string, string | undefined>) => ({ NODE_ENV: 'development', STRIPE_SECRET_KEY: 'sk_test_placeholder', ...patch }) as NodeJS.ProcessEnv;

describe('resolvePaymentIsolation', () => {
  it('denies the watched dev server on a shared target even when an approval is present (the exact 2026-10-17 configuration)', () => {
    const decision = resolvePaymentIsolation(env({ DATABASE_URL: shared, DIRECT_URL: shared, npm_lifecycle_event: 'dev',
      PAYMENT_SHARED_MUTATIONS_APPROVED: 'db.pzxekjybdiulzmssalfo.supabase.co:5432/postgres' }));
    expect(decision).toMatchObject({ allowed: false, target: 'shared', reason: 'watched-dev-server-on-shared-target' });
  });
  it('denies any shared target by default (no approval), in development and production', () => {
    expect(resolvePaymentIsolation(env({ DATABASE_URL: shared, DIRECT_URL: shared }))).toMatchObject({ allowed: false, reason: 'shared-supervisor-required' });
    expect(resolvePaymentIsolation(env({ NODE_ENV: 'production', DATABASE_URL: production, DIRECT_URL: production })))
      .toMatchObject({ allowed: false, reason: 'shared-target-not-approved' });
  });
  it('allows a shared target only for the exact approved identity, never a near match', () => {
    const base = { NODE_ENV: 'production', DATABASE_URL: production, DIRECT_URL: production };
    expect(resolvePaymentIsolation(env({ ...base, PAYMENT_SHARED_MUTATIONS_APPROVED: 'db.yepfgjehdstlxbpespun.supabase.co:5432/postgres' })))
      .toMatchObject({ allowed: true, reason: 'shared-target-approved' });
    for (const near of ['true', '1', 'db.yepfgjehdstlxbpespun.supabase.co/postgres', 'db.pzxekjybdiulzmssalfo.supabase.co:5432/postgres']) {
      expect(resolvePaymentIsolation(env({ ...base, PAYMENT_SHARED_MUTATIONS_APPROVED: near })).allowed).toBe(false);
    }
  });
  it('preserves the reviewed production deployment approval without imposing DEV Test Mode', () => {
    const base = { NODE_ENV: 'production', DATABASE_URL: production, DIRECT_URL: production,
      STRIPE_SECRET_KEY: 'sk_live_placeholder' };
    expect(resolvePaymentIsolation(env(base)).allowed).toBe(false);
    expect(resolvePaymentIsolation(env({ ...base,
      PAYMENT_SHARED_MUTATIONS_APPROVED: 'db.yepfgjehdstlxbpespun.supabase.co:5432/postgres' })))
      .toMatchObject({ allowed: true, reason: 'shared-target-approved' });
  });
  it('allows a loopback disposable database, including under the watched dev server', () => {
    expect(resolvePaymentIsolation(env({ DATABASE_URL: disposable, DIRECT_URL: disposable, npm_lifecycle_event: 'dev' })))
      .toMatchObject({ allowed: true, target: 'disposable', identity: 'loopback:55433/electrohub_disposable' });
  });
  it('recognizes CI sslmode=disable URLs as disposable test targets without weakening runtime TLS', () => {
    const ci = 'postgresql://postgres:secret@localhost:55432/electrohub_ci?sslmode=disable';
    expect(resolvePaymentIsolation(env({ NODE_ENV: 'test', DATABASE_URL: ci, DIRECT_URL: ci })))
      .toMatchObject({ allowed: true, target: 'disposable', identity: 'loopback:55432/electrohub_ci' });
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
  it('denies NODE_ENV=test, copied approvals and forged supervisor flags on shared DEV before any authority exists', () => {
    for (const patch of [{ NODE_ENV: 'test' }, { PAYMENT_SHARED_MUTATIONS_APPROVED: 'db.pzxekjybdiulzmssalfo.supabase.co:5432/postgres' },
      { PAYMENT_DEV_SUPERVISED: '1' }, { NODE_ENV: 'test', PAYMENT_SHARED_MUTATIONS_APPROVED: 'true' }]) {
      expect(resolvePaymentIsolation(env({ DATABASE_URL: shared, DIRECT_URL: shared, ...patch })).allowed).toBe(false);
    }
  });
  it('rejects live keys, mixed projects/datasets and insecure TLS', () => {
    for (const patch of [{ DIRECT_URL: production }, { DIRECT_URL: disposable }, { NODE_TLS_REJECT_UNAUTHORIZED: '0' },
      { STRIPE_SECRET_KEY: 'sk_live_placeholder' }]) {
      expect(resolvePaymentIsolation(env({ DATABASE_URL: shared, DIRECT_URL: shared, ...patch })).allowed).toBe(false);
    }
    expect(resolvePaymentIsolation(env({ DATABASE_URL: disposable, DIRECT_URL: disposable, STRIPE_SECRET_KEY: 'sk_live_placeholder' })).allowed).toBe(false);
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
