import { beforeEach, afterEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  env: { DIRECT_URL: 'postgresql://example:example@localhost:5432/direct?sslmode=require&pgbouncer=true', DATABASE_URL: 'postgresql://example:example@localhost:6543/runtime', NODE_ENV: 'test', DB_SSL_CA_CERT_PATH: undefined as string | undefined },
  on: vi.fn(),
  client: vi.fn(function(configuration: unknown) { void configuration; return { $disconnect: vi.fn(), $on: mocks.on }; }),
  adapter: vi.fn(function(configuration: unknown) { void configuration; return {}; }),
  readFile: vi.fn(() => 'trusted-ca'),
  log: vi.fn(),
}));
vi.mock('../utils/logger.js', () => ({ logSafely: mocks.log }));
vi.mock('@prisma/client', () => ({ PrismaClient: mocks.client }));
vi.mock('@prisma/adapter-pg', () => ({ PrismaPg: mocks.adapter }));
vi.mock('../config/env.js', () => ({ env: mocks.env }));
vi.mock('node:fs', () => ({ readFileSync: mocks.readFile }));
const shared = globalThis as typeof globalThis & { prisma?: unknown };
const priorCi = process.env.CI;
beforeEach(() => {
  delete shared.prisma;
  vi.resetModules(); vi.clearAllMocks();
  delete process.env.CI;
  mocks.env.DIRECT_URL = 'postgresql://example:example@localhost:5432/direct?sslmode=require&pgbouncer=true';
  mocks.env.DB_SSL_CA_CERT_PATH = undefined;
  mocks.env.NODE_ENV = 'test';
});
afterEach(() => { delete shared.prisma; if (priorCi === undefined) delete process.env.CI; else process.env.CI = priorCi; });

it('uses DIRECT_URL at runtime and enforces TLS independently of URL flags', async () => {
  await import('./prisma.js');
  const config = mocks.adapter.mock.calls[0]?.[0] as unknown as { connectionString: string; ssl: { rejectUnauthorized: boolean }; max: number };
  expect(config.connectionString).toBe('postgresql://example:example@localhost:5432/direct');
  expect(config.ssl.rejectUnauthorized).toBe(true); expect(config.max).toBe(5);
});
it('budgets development API and runner below the fifteen-session limit without changing production', async () => {
  mocks.env.NODE_ENV = 'development';
  await import('./prisma.js');
  expect(mocks.adapter).toHaveBeenCalledWith(expect.objectContaining({ max: 5 }));
  delete shared.prisma; vi.resetModules(); vi.clearAllMocks();
  mocks.env.NODE_ENV = 'production';
  await import('./prisma.js');
  expect(mocks.adapter).toHaveBeenCalledWith(expect.objectContaining({ max: 10 }));
});
it('retains source fallback to DATABASE_URL if direct configuration is absent', async () => {
  mocks.env.DIRECT_URL = '';
  await import('./prisma.js');
  const config = mocks.adapter.mock.calls[0]?.[0] as unknown as { connectionString: string };
  expect(config.connectionString).toBe(mocks.env.DATABASE_URL);
});
it('caps each CI test process at five and uses the configured trusted CA', async () => {
  process.env.CI = 'true'; mocks.env.DB_SSL_CA_CERT_PATH = 'approved-ca.pem';
  await import('./prisma.js');
  const config = mocks.adapter.mock.calls[0]?.[0] as unknown as { max: number; ssl: { ca: string; rejectUnauthorized: boolean } };
  expect(config.max).toBe(5); expect(config.ssl).toEqual({ ca: 'trusted-ca', rejectUnauthorized: true });
});
it('module reload reuses one client and one adapter in the same process', async () => {
  const first = await import('./prisma.js');
  vi.resetModules();
  const second = await import('./prisma.js');
  expect(second.prisma).toBe(first.prisma);
  expect(mocks.client).toHaveBeenCalledTimes(1); expect(mocks.adapter).toHaveBeenCalledTimes(1);
});

it('actual client wiring records only event duration/classification and isolates observer failure', async () => {
  const previous = process.env.ELECTROHUB_SQL_DIAGNOSTICS;
  process.env.ELECTROHUB_SQL_DIAGNOSTICS = '1';
  try {
    const { paymentDiagnostics } = await import('./payment-diagnostics.js');
    const record = vi.spyOn(paymentDiagnostics, 'record');
    await import('./prisma.js');
    const query = mocks.on.mock.calls.find(([name]) => name === 'query')?.[1] as (event: object) => void;
    const error = mocks.on.mock.calls.find(([name]) => name === 'error')?.[1] as (event: object) => void;
    query({ duration: 12, query: 'private SQL', params: 'private parameters' });
    error({ message: 'private credentials' });
    expect(record.mock.calls).toEqual([['prisma-query', 12], ['database-operation', null, { code: 'DATABASE_ERROR' }, undefined]]);
    record.mockImplementation(() => { throw Error('observer unavailable'); });
    expect(() => query({ duration: 1 })).not.toThrow(); expect(() => error({})).not.toThrow();
    record.mockRestore();
  } finally {
    if (previous === undefined) delete process.env.ELECTROHUB_SQL_DIAGNOSTICS; else process.env.ELECTROHUB_SQL_DIAGNOSTICS = previous;
  }
});
it.each([
  ['Transaction API error: Transaction already closed (P2028) while running SELECT secret FROM "users" WHERE email = \'private@example.invalid\'', 'P2028', null],
  ['Timed out fetching a new connection from the connection pool. code: P2024 postgresql://user:hunter2@host/db', 'P2024', null],
  ['Driver rejected a connection with code: 53300', null, '53300'],
  ['Transaction failed due to a write conflict or a deadlock. P2034 SQLSTATE 40001', 'P2034', '40001'],
  ['unrecognized engine failure for token eyJhbGciOiJIUzI1NiJ9.e30.signature', null, null],
])('db.error keeps only the sanitized Prisma code and SQLSTATE, never the engine message', async (message, prismaCode, sqlState) => {
  await import('./prisma.js');
  const handler = mocks.on.mock.calls.find(([level]) => level === 'error')?.[1] as (event: { message: string }) => void;
  handler({ message });
  expect(mocks.log).toHaveBeenCalledExactlyOnceWith('error', 'Database operation failed', {
    operation: 'db.error', code: 'DATABASE_ERROR', prismaCode, sqlState, requestId: null, correlationId: null,
  });
  expect(JSON.stringify(mocks.log.mock.calls)).not.toMatch(/SELECT|private@|hunter2|eyJ|postgresql:/);
});

it('attaches an available request correlation ID to the sanitized Prisma error event', async () => {
  const previous = process.env.ELECTROHUB_SQL_DIAGNOSTICS;
  process.env.ELECTROHUB_SQL_DIAGNOSTICS = '1';
  try {
    const { paymentDiagnostics } = await import('./payment-diagnostics.js');
    const { logContext } = await import('../utils/logContext.js');
    const record = vi.spyOn(paymentDiagnostics, 'record');
    await import('./prisma.js');
    const handler = mocks.on.mock.calls.find(([level]) => level === 'error')?.[1] as (event: { message: string }) => void;
    logContext.run({ requestId: 'request-correlated-1' }, () => handler({ message: 'Database failed with P2024 and private SQL' }));
    expect(mocks.log).toHaveBeenCalledWith('error', 'Database operation failed', expect.objectContaining({
      requestId: 'request-correlated-1', correlationId: 'request-correlated-1', prismaCode: 'P2024', sqlState: null,
    }));
    expect(record).toHaveBeenCalledWith('database-operation', null, { code: 'DATABASE_ERROR' }, 'request-correlated-1');
    expect(JSON.stringify(mocks.log.mock.calls)).not.toContain('private SQL');
    record.mockRestore();
  } finally {
    if (previous === undefined) delete process.env.ELECTROHUB_SQL_DIAGNOSTICS; else process.env.ELECTROHUB_SQL_DIAGNOSTICS = previous;
  }
});
