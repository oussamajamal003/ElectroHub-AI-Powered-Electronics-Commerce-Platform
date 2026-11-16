import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';
import { performance } from 'node:perf_hooks';
import { logSafely } from '../utils/logger.js';
import { logContext } from '../utils/logContext.js';
import { recordDbOperation, type DbOperationKind } from './db-request-metrics.js';

const systemCodes = new Set([
  'ECONNRESET', 'ECONNREFUSED', 'ECONNABORTED', 'ETIMEDOUT', 'EPIPE', 'ENOTFOUND', 'EAI_AGAIN',
  'ERR_TLS_CERT_ALTNAME_INVALID', 'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY',
]);

/** Only classifications leave this boundary; never driver messages, SQL, parameters or endpoint details. */
export function databaseFailure(error: unknown) {
  const classification: { driverCode: string | null; sqlState: string | null; failureKind: string } = {
    driverCode: null, sqlState: null, failureKind: 'unknown',
  };
  const seen = new Set<object>();
  const visit = (value: unknown, depth = 0): void => {
    if (!value || typeof value !== 'object' || depth > 4 || seen.has(value)) return;
    seen.add(value);
    const record = value as Record<string, unknown>;
    const code = typeof record.code === 'string' ? record.code : '';
    if (!classification.driverCode && systemCodes.has(code)) classification.driverCode = code;
    if (!classification.sqlState && /^[0-9A-Z]{5}$/.test(code) && !/^P[0-9]{4}$/.test(code)) classification.sqlState = code;
    const message = typeof record.message === 'string' ? record.message : '';
    if (classification.failureKind === 'unknown') {
      if (/timeout exceeded when trying to connect/i.test(message)) classification.failureKind = 'pool_acquisition_timeout';
      else if (/connection (?:terminated due to connection timeout|timeout)|timeout expired/i.test(message)) classification.failureKind = 'connection_timeout';
      else if (/connection (?:terminated|closed)|client has encountered a connection error|not queryable/i.test(message)) classification.failureKind = 'connection_terminated';
    }
    visit(record.cause, depth + 1);
    if (Array.isArray(record.errors)) record.errors.slice(0, 8).forEach(item => visit(item, depth + 1));
  };
  visit(error);
  const { driverCode, sqlState } = classification;
  let { failureKind } = classification;
  if (driverCode?.includes('CERT') || driverCode?.includes('SELF_SIGNED') || driverCode?.includes('ISSUER')) failureKind = 'tls';
  else if (driverCode === 'ENOTFOUND' || driverCode === 'EAI_AGAIN') failureKind = 'dns';
  else if (driverCode === 'ETIMEDOUT') failureKind = 'connection_timeout';
  else if (driverCode) failureKind = 'network';
  else if (sqlState === '53300') failureKind = 'connection_capacity';
  else if (sqlState?.startsWith('08') || sqlState === '57P01' || sqlState === '57P02' || sqlState === '57P03') failureKind = 'connection_terminated';
  else if (sqlState === '57014') failureKind = 'query_cancelled';
  else if (sqlState === '25P03') failureKind = 'idle_transaction_timeout';
  else if (sqlState === '28P01' || sqlState === '28000') failureKind = 'authentication';
  return { failureKind, driverCode, sqlState };
}

type ConnectedAdapter = Awaited<ReturnType<PrismaPg['connect']>>;
type Transaction = Awaited<ReturnType<ConnectedAdapter['startTransaction']>>;
type Queryable = Pick<ConnectedAdapter, 'queryRaw' | 'executeRaw'>;

/**
 * Prisma 6.12 does not expose a pool/error callback in its public factory API.
 * The sole compatibility bridge is checked before any I/O; keep the real adapter's
 * conversion, transaction and disposal implementations. No global pg patch or retries.
 * Revalidate this boundary on adapter upgrades (the real-driver tests exercise it).
 */
export class ObservablePrismaPg extends PrismaPg {
  override async connect(): Promise<ConnectedAdapter> {
    const adapter = await super.connect();
    if (!('client' in adapter) || !(adapter.client instanceof pg.Pool)) {
      await adapter.dispose();
      throw new Error('Unsupported database adapter pool interface');
    }
    const pool = adapter.client;
    let degraded = false;
    const reported = new WeakSet<object>();
    const checkedOut = new WeakSet<pg.PoolClient>();
    const report = (operation: string, error: unknown, durationMs?: number, correlated = true) => {
      // Diagnostics can never replace the original database error or throw from an EventEmitter listener.
      try {
        const classification = databaseFailure(error);
        // SQL/domain failures already have Prisma/application coverage. These events
        // diagnose transport/capacity failures, including otherwise unclassified disconnects.
        if (classification.failureKind === 'unknown' && classification.sqlState) return;
        if (error && typeof error === 'object') {
          if (reported.has(error)) return;
          reported.add(error);
        }
        degraded = true;
        // Socket EventEmitters may retain the context of the request that created
        // the connection. That request is not evidence of who later encountered a fault.
        const correlationId = correlated ? logContext.getStore()?.requestId ?? null : null;
        const safeError = new Error('Database driver failure');
        safeError.name = 'DatabaseDriverError';
        if (error instanceof Error) safeError.stack = ['DatabaseDriverError: operation failed',
          ...(error.stack?.split('\n').filter(line => /^\s*at\s/.test(line)) ?? [])].join('\n');
        logSafely('error', 'Database driver operation failed', {
          operation, code: 'DATABASE_DRIVER_ERROR', ...classification, durationMs,
          requestId: correlationId, correlationId, error: safeError,
          totalConnections: pool.totalCount, idleConnections: pool.idleCount,
          waitingRequests: pool.waitingCount, connectionLimit: pool.options.max,
        });
      } catch { /* logSafely handles sink failures; even malformed errors cannot break recovery. */ }
    };
    const recovered = () => {
      if (!degraded) return;
      degraded = false;
      try {
        logSafely('info', 'Database operation succeeded after a driver failure', {
          operation: 'db.connection.recovered', totalConnections: pool.totalCount,
          idleConnections: pool.idleCount, waitingRequests: pool.waitingCount,
        });
      } catch { /* Observer isolation. */ }
    };
    // pg has already removed the broken idle client. Never release it again or end the pool here.
    pool.on('error', error => report('db.pool.idle_error', error, undefined, false));
    pool.on('connect', client => {
      // An interactive transaction can lose its socket BETWEEN queries, when pg has
      // removed the idle listener and no query callback is available to handle it.
      client.on('error', error => {
        if (checkedOut.has(client)) report('db.connection.error', error, undefined, false);
      });
    });
    pool.on('acquire', client => checkedOut.add(client));
    pool.on('release', (_error, client) => checkedOut.delete(client));
    const observe = async <T>(operation: string, kind: DbOperationKind, transactional: boolean, action: () => Promise<T>): Promise<T> => {
      const start = performance.now();
      // Queued requests at start mean this operation had to wait for a pooled connection (only meaningful for pool checkouts).
      const poolQueued = !transactional && pool.waitingCount > 0;
      try {
        const result = await action();
        recovered();
        recordDbOperation({ kind, transactional, durationMs: performance.now() - start, poolQueued });
        return result;
      } catch (error) {
        report(operation, error, performance.now() - start);
        recordDbOperation({ kind, transactional, durationMs: performance.now() - start, poolQueued, failureKind: databaseFailure(error).failureKind });
        throw error;
      }
    };
    const instrument = (target: Queryable, phase: string, transactional: boolean) => {
      const queryRaw = target.queryRaw.bind(target);
      const executeRaw = target.executeRaw.bind(target);
      target.queryRaw = query => observe(`${phase}.read`, 'read', transactional, () => queryRaw(query));
      target.executeRaw = query => observe(`${phase}.write`, 'write', transactional, () => executeRaw(query));
    };
    instrument(adapter, 'db.driver', false);
    const startTransaction = adapter.startTransaction.bind(adapter);
    adapter.startTransaction = isolationLevel => observe('db.transaction.acquire', 'transaction_start', false, async () => {
      const transaction: Transaction = await startTransaction(isolationLevel);
      instrument(transaction, 'db.transaction', true);
      const commit = transaction.commit.bind(transaction);
      const rollback = transaction.rollback.bind(transaction);
      transaction.commit = () => observe('db.transaction.commit', 'commit', true, commit);
      transaction.rollback = () => observe('db.transaction.rollback', 'rollback', true, rollback);
      return transaction;
    });
    // Prisma owns this pool: its existing dispose() -> pool.end() remains the only shutdown owner.
    return adapter;
  }
}
