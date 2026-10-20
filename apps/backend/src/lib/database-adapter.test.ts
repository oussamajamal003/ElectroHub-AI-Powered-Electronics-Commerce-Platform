import { afterEach, describe, expect, it, vi } from 'vitest';
import pg from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { databaseFailure, ObservablePrismaPg } from './database-adapter.js';
import { logContext } from '../utils/logContext.js';

const mocks = vi.hoisted(() => ({ log: vi.fn() }));
vi.mock('../utils/logger.js', () => ({ logSafely: mocks.log }));
type Adapter = Awaited<ReturnType<PrismaPg['connect']>>;
const pools: pg.Pool[] = [];
afterEach(async () => {
  vi.restoreAllMocks(); mocks.log.mockReset();
  await Promise.all(pools.splice(0).filter(pool => !pool.ended).map(pool => pool.end()));
});

async function fixture() {
  const pool = new pg.Pool({ max: 5 }); pools.push(pool);
  const transaction = {
    provider: 'postgres' as const, adapterName: '@prisma/adapter-pg',
    options: { usePhantomQuery: false }, queryRaw: vi.fn(), executeRaw: vi.fn(),
    commit: vi.fn(), rollback: vi.fn(),
  };
  const original = {
    client: pool, provider: 'postgres' as const, adapterName: '@prisma/adapter-pg',
    queryRaw: vi.fn(), executeRaw: vi.fn(), executeScript: vi.fn(),
    startTransaction: vi.fn().mockResolvedValue(transaction), dispose: vi.fn(() => pool.end()),
  };
  const calls = { ...original };
  const transactionCalls = { ...transaction };
  vi.spyOn(PrismaPg.prototype, 'connect').mockResolvedValue(original);
  const adapter = await new ObservablePrismaPg({}).connect();
  return { pool, original: calls, adapter, transaction, transactionCalls };
}
const query = { sql: 'SELECT private_value', args: ['private-parameter'], argTypes: [] };

describe('safe driver classifications', () => {
  it.each([
    [{ code: 'ECONNRESET' }, 'network', 'ECONNRESET', null],
    [{ cause: { code: 'ECONNREFUSED' } }, 'network', 'ECONNREFUSED', null],
    [new AggregateError([{ code: 'EAI_AGAIN' }]), 'dns', 'EAI_AGAIN', null],
    [{ code: 'ERR_TLS_CERT_ALTNAME_INVALID' }, 'tls', 'ERR_TLS_CERT_ALTNAME_INVALID', null],
    [{ code: '53300' }, 'connection_capacity', null, '53300'],
    [{ code: '57P01' }, 'connection_terminated', null, '57P01'],
    [{ code: '57014' }, 'query_cancelled', null, '57014'],
    [{ code: '25P03' }, 'idle_transaction_timeout', null, '25P03'],
    [Error('Connection terminated unexpectedly'), 'connection_terminated', null, null],
    [Error('timeout exceeded when trying to connect'), 'pool_acquisition_timeout', null, null],
    [Error('Connection terminated due to connection timeout'), 'connection_timeout', null, null],
    [{ code: 'password=secret', message: 'postgresql://private:secret@private/db' }, 'unknown', null, null],
  ])('classifies without retaining driver contents', (error, failureKind, driverCode, sqlState) => {
    expect(databaseFailure(error)).toEqual({ failureKind, driverCode, sqlState });
  });
  it('bounds cyclic causes and never serializes arbitrary metadata', () => {
    const error = { cause: {} }; error.cause = error;
    expect(databaseFailure(error).failureKind).toBe('unknown');
  });
});

it('reproduces the unobserved pg error hazard and handles it after instrumentation', async () => {
  const plain = new pg.Pool(); pools.push(plain);
  expect(() => plain.emit('error', Error('idle connection terminated'))).toThrow();
  const { pool } = await fixture();
  expect(pool.listenerCount('error')).toBe(1);
  expect(() => pool.emit('error', Error('Connection terminated unexpectedly'))).not.toThrow();
  expect(mocks.log).toHaveBeenCalledWith('error', expect.any(String), expect.objectContaining({
    operation: 'db.pool.idle_error', failureKind: 'connection_terminated', connectionLimit: 5,
  }));
});

it('does not misattribute a background socket failure to a retained request context', async () => {
  const { pool } = await fixture();
  logContext.run({ requestId: 'old-connection-owner' }, () => pool.emit('error', Error('Connection terminated')));
  expect(mocks.log).toHaveBeenCalledWith('error', expect.any(String), expect.objectContaining({
    operation: 'db.pool.idle_error', requestId: null, correlationId: null,
  }));
});

it('preserves the exact rejection, does not retry writes and observes later recovery once', async () => {
  const { original, adapter } = await fixture();
  const failure = Object.assign(Error('private SQL password=private-secret'), { code: 'ECONNRESET' });
  original.executeRaw.mockRejectedValueOnce(failure).mockResolvedValue(1);
  await logContext.run({ requestId: 'db-failure-1' }, () => expect(adapter.executeRaw(query)).rejects.toBe(failure));
  expect(original.executeRaw).toHaveBeenCalledTimes(1);
  expect(mocks.log).toHaveBeenCalledWith('error', expect.any(String), expect.objectContaining({
    requestId: 'db-failure-1', driverCode: 'ECONNRESET', operation: 'db.driver.write', durationMs: expect.any(Number),
  }));
  expect(JSON.stringify(mocks.log.mock.calls)).not.toMatch(/private SQL|private-secret|private-parameter/);
  await adapter.executeRaw(query); await adapter.executeRaw(query);
  expect(mocks.log.mock.calls.filter(call => call[2].operation === 'db.connection.recovered')).toHaveLength(1);
});

it('preserves transaction isolation, original commit/rollback and errors', async () => {
  const { original, adapter, transaction, transactionCalls } = await fixture();
  const tx = await adapter.startTransaction('SERIALIZABLE');
  expect(original.startTransaction).toHaveBeenCalledExactlyOnceWith('SERIALIZABLE');
  expect(tx).toBe(transaction);
  const failure = Object.assign(Error('Connection terminated'), { code: '57P01' });
  transactionCalls.queryRaw.mockRejectedValueOnce(failure);
  await expect(tx.queryRaw(query)).rejects.toBe(failure);
  expect(transactionCalls.queryRaw).toHaveBeenCalledTimes(1);
  expect(transactionCalls.commit).not.toHaveBeenCalled(); expect(transactionCalls.rollback).not.toHaveBeenCalled();
});

it('handles a checked-out connection error between transaction queries without duplicate idle events', async () => {
  const { pool } = await fixture();
  const client = new pg.Client() as pg.PoolClient;
  pool.emit('connect', client); pool.emit('acquire', client);
  const error = Object.assign(Error('Connection terminated'), { code: 'ECONNRESET' });
  expect(() => client.emit('error', error)).not.toThrow();
  pool.emit('release', error, client); pool.emit('error', error, client);
  expect(mocks.log).toHaveBeenCalledTimes(1);
});

it('does not duplicate SQL constraint errors already covered by Prisma', async () => {
  const { original, adapter } = await fixture();
  const error = Object.assign(Error('sensitive SQL'), { code: '23505' });
  original.executeRaw.mockRejectedValue(error);
  await expect(adapter.executeRaw(query)).rejects.toBe(error);
  expect(mocks.log).not.toHaveBeenCalled();
});

it('keeps the original error and idle-event handling when the observer itself throws', async () => {
  const { original, adapter, pool } = await fixture();
  const error = Error('Connection terminated unexpectedly');
  mocks.log.mockImplementation(() => { throw Error('observer unavailable'); });
  original.queryRaw.mockRejectedValue(error);
  await expect(adapter.queryRaw(query)).rejects.toBe(error);
  expect(() => pool.emit('error', Error('Connection terminated'))).not.toThrow();
});

it('disposes the actual pool through Prisma without adding a second shutdown owner', async () => {
  const { adapter, original, pool } = await fixture();
  await adapter.dispose();
  expect(original.dispose).toHaveBeenCalledTimes(1); expect(pool.ended).toBe(true);
});

it('rejects an incompatible adapter boundary before queries and disposes its resources', async () => {
  const dispose = vi.fn().mockResolvedValue(undefined);
  vi.spyOn(PrismaPg.prototype, 'connect').mockResolvedValue({ dispose } as unknown as Adapter);
  await expect(new ObservablePrismaPg({}).connect()).rejects.toThrow('Unsupported database adapter pool interface');
  expect(dispose).toHaveBeenCalledTimes(1);
});
