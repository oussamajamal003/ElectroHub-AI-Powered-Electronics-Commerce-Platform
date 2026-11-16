import { describe, expect, it, vi } from 'vitest';
import { notificationDoctorError, runNotificationDoctor, runNotificationDoctorWithCleanup } from './notification-doctor.diagnostics.js';

function dependencies(overrides: Partial<Parameters<typeof runNotificationDoctor>[0]> = {}) {
  return {
    loadConfiguration: vi.fn(() => ({ configured: true })),
    querySchema: vi.fn(async () => ({ notifications: true })),
    checkCommerceEmailHealth: vi.fn(async () => ({ ready: true })),
    checkNotifications: vi.fn(() => ({ enabled: true })),
    ...overrides,
  };
}

describe('notification doctor diagnostics', () => {
  it('returns the successful doctor report after every stage', async () => {
    const deps = dependencies();
    await expect(runNotificationDoctor(deps)).resolves.toEqual({ ok: true, value: { enabled: true } });
    expect(deps.loadConfiguration).toHaveBeenCalledOnce();
    expect(deps.querySchema).toHaveBeenCalledOnce();
    expect(deps.checkCommerceEmailHealth).toHaveBeenCalledOnce();
  });

  it('attributes configuration-loading failure and skips database operations', async () => {
    const deps = dependencies({ loadConfiguration: vi.fn().mockRejectedValue(new Error('configuration secret')) });
    await expect(runNotificationDoctor(deps)).resolves.toMatchObject({ ok: false, diagnostic: {
      stage: 'configuration_loading', errorClass: 'Error',
    } });
    expect(deps.querySchema).not.toHaveBeenCalled();
    expect(deps.checkCommerceEmailHealth).not.toHaveBeenCalled();
    expect(deps.checkNotifications).not.toHaveBeenCalled();
  });

  it('attributes an initial Prisma/schema query failure to its stage', async () => {
    const deps = dependencies({ querySchema: vi.fn().mockRejectedValue(Object.assign(new Error('not available'), { code: 'P1001' })) });
    await expect(runNotificationDoctor(deps)).resolves.toMatchObject({ ok: false, diagnostic: {
      stage: 'initial_database_schema_query', prismaErrorCode: 'P1001', errorClass: 'Error',
    } });
    expect(deps.checkCommerceEmailHealth).not.toHaveBeenCalled();
  });

  it('attributes commerceEmailHealth failures separately', async () => {
    const deps = dependencies({ checkCommerceEmailHealth: vi.fn().mockRejectedValue(new Error('health query failed')) });
    await expect(runNotificationDoctor(deps)).resolves.toMatchObject({ ok: false, diagnostic: { stage: 'commerce_email_health' } });
    expect(deps.querySchema).toHaveBeenCalledOnce();
  });

  it('attributes subsequent notification-check failure after earlier stages succeed', async () => {
    const deps = dependencies({ checkNotifications: vi.fn().mockRejectedValue(new Error('notification check secret')) });
    await expect(runNotificationDoctor(deps)).resolves.toMatchObject({ ok: false, diagnostic: {
      stage: 'notification_checks', errorClass: 'Error',
    } });
    expect(deps.loadConfiguration).toHaveBeenCalledOnce();
    expect(deps.querySchema).toHaveBeenCalledOnce();
    expect(deps.checkCommerceEmailHealth).toHaveBeenCalledOnce();
  });

  it('preserves the primary diagnostic and reports sanitized cleanup failure separately', async () => {
    const deps = dependencies({ querySchema: vi.fn().mockRejectedValue(new Error('primary password=hidden')) });
    const cleanup = vi.fn().mockRejectedValue(Object.assign(new Error('postgres://secret'), { code: 'ETIMEDOUT' }));
    const lifecycle = await runNotificationDoctorWithCleanup(deps, cleanup);
    expect(lifecycle).toMatchObject({
      ok: false,
      result: { ok: false, diagnostic: { stage: 'initial_database_schema_query' } },
      cleanupDiagnostic: { stage: 'prisma_cleanup', errorCode: 'ETIMEDOUT', failureKind: 'connection_timeout' },
    });
    expect(cleanup).toHaveBeenCalledOnce();
    expect(JSON.stringify(lifecycle)).not.toContain('password=hidden');
    expect(JSON.stringify(lifecycle)).not.toContain('postgres://');
  });

  it('keeps the overall result unsuccessful when cleanup fails after a successful check', async () => {
    const deps = dependencies();
    const lifecycle = await runNotificationDoctorWithCleanup(deps, vi.fn().mockRejectedValue(new Error('cleanup detail')));
    expect(lifecycle.ok).toBe(false);
    expect(lifecycle.result).toEqual({ ok: true, value: { enabled: true } });
    expect(lifecycle.cleanupDiagnostic).toMatchObject({ stage: 'prisma_cleanup', failureKind: 'unknown', retryable: null });
  });

  it('retains safe nested cause classes and codes without messages', () => {
    const root = Object.assign(new Error('socket failed'), { code: 'ETIMEDOUT' });
    const wrapped = Object.assign(new Error('outer wrapper'), { cause: root });
    expect(notificationDoctorError('initial_database_schema_query', wrapped)).toMatchObject({
      errorClass: 'Error', errorCode: 'ETIMEDOUT', failureKind: 'connection_timeout', retryable: true,
      causeChain: [{ errorClass: 'Error' }, { errorClass: 'Error', errorCode: 'ETIMEDOUT' }],
    });
  });

  it('does not leak credential-like content from errors', () => {
    const secretMessage = 'postgres://user:password@db.example/token?access_token=secret';
    const error = Object.assign(new Error(secretMessage), { code: '28P01' });
    const output = JSON.stringify(notificationDoctorError('commerce_email_health', error));
    expect(output).not.toContain('password');
    expect(output).not.toContain('db.example');
    expect(output).not.toContain('access_token');
    expect(output).toContain('28P01');
  });

  it('safely classifies unknown errors without inventing retryability', () => {
    expect(notificationDoctorError('notification_checks', { message: 'secret detail' })).toMatchObject({
      stage: 'notification_checks', errorClass: 'Error', errorCode: null, prismaErrorCode: null,
      failureKind: 'unknown', retryable: null, causeChain: [{ errorClass: 'Error', errorCode: null, prismaErrorCode: null }],
    });
  });
});
