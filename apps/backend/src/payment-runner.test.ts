import { afterEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  runBatch: vi.fn(),
  attention: vi.fn(),
  runRecoveryLoop: vi.fn(),
  supervisorScope: null as readonly string[] | null,
  env: { NODE_ENV: 'test' as 'test' | 'development' | 'production' },
  prisma: { $queryRaw: vi.fn(), $disconnect: vi.fn() },
}));

vi.mock('./utils/logContext.js', () => ({ logContext: { run: (_context: unknown, callback: () => unknown) => callback() } }));
vi.mock('./services/payment.service.js', () => ({ paymentService: { runBatch: harness.runBatch } }));
vi.mock('./lib/prisma.js', () => ({ prisma: harness.prisma }));
vi.mock('./utils/logger.js', () => ({ logger: { info: vi.fn() }, logSafely: vi.fn(), flushLogsWithDeadline: vi.fn(async () => true),
  installFatalLogging: vi.fn() }));
vi.mock('./config/env.js', () => ({ env: harness.env }));
vi.mock('./services/checkout.domain.js', () => ({ attemptSchema: { parse: (id: string) => {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) throw new Error('invalid attempt ID');
  return id;
} } }));
vi.mock('./payment-recovery-loop.js', () => ({ RECOVERY_ALERT_AGE_MS: 1, runRecoveryLoop: harness.runRecoveryLoop }));
vi.mock('./payment-recovery-attention.js', () => ({ paymentRecoveryAttention: harness.attention }));
vi.mock('./payment-isolation.js', () => ({ paymentIsolation: () => ({ allowed: true, target: 'test', identity: 'supabase:task04/postgres', reason: 'test' }) }));
vi.mock('./services/commerce-email.runtime.js', () => ({ logCommerceEmailRuntime: vi.fn() }));
vi.mock('./lib/dev-supervisor.js', async importOriginal => {
  const actual = await importOriginal<typeof import('./lib/dev-supervisor.js')>();
  return { ...actual, devSupervisorAttemptIds: () => harness.supervisorScope, devSupervisorScope: () => harness.supervisorScope };
});

const REVIEWED_ID = '11111111-1111-4111-8111-111111111111';
const TASK04_ID = '22222222-2222-4222-8222-222222222222';
const OUT_OF_SCOPE_ID = '33333333-3333-4333-8333-333333333333';
const originalArgv = process.argv;
const originalSupervised = process.env.PAYMENT_DEV_SUPERVISED;

async function importRunner(options: { mode: 'test' | 'development' | 'production'; supervised?: boolean; scope?: readonly string[] | null; args?: string[] }) {
  vi.resetModules();
  harness.env.NODE_ENV = options.mode;
  harness.supervisorScope = options.scope ?? null;
  harness.runBatch.mockReset().mockResolvedValue(0);
  harness.attention.mockReset().mockResolvedValue([]);
  harness.runRecoveryLoop.mockReset().mockImplementation(async deps => {
    await deps.batch();
    await deps.batch();
    await deps.attention();
    await deps.attention();
  });
  harness.prisma.$queryRaw.mockReset().mockResolvedValue([]);
  harness.prisma.$disconnect.mockReset().mockResolvedValue(undefined);
  process.env.PAYMENT_DEV_SUPERVISED = options.supervised ? '1' : '';
  process.argv = ['node', 'payment-runner.js', '--payment-worker', ...(options.args ?? [])];
  await import('./payment-runner.js');
  await vi.waitFor(() => expect(harness.attention).toHaveBeenCalledTimes(2));
}

afterEach(() => {
  process.argv = originalArgv;
  if (originalSupervised === undefined) delete process.env.PAYMENT_DEV_SUPERVISED;
  else process.env.PAYMENT_DEV_SUPERVISED = originalSupervised;
});

describe('payment runner attempt scope', () => {
  it('passes the exact frozen supervisor scope to every batch and attention poll', async () => {
    await importRunner({ mode: 'development', supervised: true, scope: [REVIEWED_ID, TASK04_ID] });
    expect(harness.runBatch).toHaveBeenCalledTimes(2);
    expect(harness.attention).toHaveBeenCalledTimes(2);
    const scope = harness.runBatch.mock.calls[0][0] as string[];
    expect(scope).toEqual([REVIEWED_ID, TASK04_ID]);
    expect(scope).not.toContain(OUT_OF_SCOPE_ID);
    expect(Object.isFrozen(scope)).toBe(true);
    for (const [ids] of harness.runBatch.mock.calls) expect(ids).toBe(scope);
    for (const [, ids] of harness.attention.mock.calls) expect(ids).toBe(scope);
  });

  it('passes a governed creation boundary unchanged and frozen to every batch and attention poll', async () => {
    const createdSince = new Date(Date.now() - 3600_000);
    await importRunner({ mode: 'development', supervised: true, scope: { createdSince } as never });
    expect(harness.runBatch).toHaveBeenCalledTimes(2);
    const scope = harness.runBatch.mock.calls[0][0] as { createdSince: Date };
    expect(scope).toEqual({ createdSince });
    expect(Object.isFrozen(scope)).toBe(true);
    for (const [value] of harness.runBatch.mock.calls) expect(value).toBe(scope);
    for (const [, value] of harness.attention.mock.calls) expect(value).toBe(scope);
  });

  it('fails closed on missing, empty, malformed, duplicate, oversized, or CLI-supplied supervised scope', async () => {
    const invalidScopes: Array<readonly string[] | null> = [null, [], ['not-a-uuid', TASK04_ID], [REVIEWED_ID, REVIEWED_ID],
      [REVIEWED_ID, TASK04_ID, OUT_OF_SCOPE_ID]];
    for (const scope of invalidScopes) {
      vi.resetModules();
      harness.env.NODE_ENV = 'development';
      harness.supervisorScope = scope;
      harness.runBatch.mockReset(); harness.attention.mockReset(); harness.runRecoveryLoop.mockReset();
      harness.prisma.$queryRaw.mockReset();
      process.env.PAYMENT_DEV_SUPERVISED = '1';
      process.argv = ['node', 'payment-runner.js', '--payment-worker'];
      await expect(import('./payment-runner.js')).rejects.toThrow();
      expect(harness.runBatch).not.toHaveBeenCalled();
      expect(harness.attention).not.toHaveBeenCalled();
      expect(harness.runRecoveryLoop).not.toHaveBeenCalled();
      expect(harness.prisma.$queryRaw).not.toHaveBeenCalled();
    }

    vi.resetModules();
    harness.env.NODE_ENV = 'development'; harness.supervisorScope = [REVIEWED_ID, TASK04_ID];
    process.env.PAYMENT_DEV_SUPERVISED = '1';
    process.argv = ['node', 'payment-runner.js', '--payment-worker', `--attempt=${REVIEWED_ID}`];
    await expect(import('./payment-runner.js')).rejects.toThrow(/scope must come from supervisor IPC/);
    expect(harness.runBatch).not.toHaveBeenCalled();
  });

  it('keeps disposable test attempt flags scoped and production behavior unscoped', async () => {
    await importRunner({ mode: 'test', args: [`--attempt=${TASK04_ID}`] });
    expect(harness.runBatch.mock.calls[0][0]).toEqual([TASK04_ID]);
    expect(harness.attention.mock.calls.every(([, ids]) => ids === harness.runBatch.mock.calls[0][0])).toBe(true);

    await importRunner({ mode: 'production' });
    expect(harness.runBatch.mock.calls[0][0]).toBeUndefined();
    expect(harness.attention.mock.calls.every(([, ids]) => ids === undefined)).toBe(true);
  });
});
