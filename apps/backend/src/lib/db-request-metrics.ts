import { AsyncLocalStorage } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';

/**
 * Scoped database timing (Task 04.0 performance attribution). Prisma's engine invokes the driver adapter outside the caller's
 * AsyncLocalStorage context (verified on the real adapter: zero operations were attributable that way), so a scope observes every
 * round trip the adapter actually executes while it is open, and records how many HTTP requests overlapped it. Counts are exact
 * only when `attribution` is `exclusive` (no other request in flight in this process); otherwise they are an upper bound.
 * Application stages are timed through AsyncLocalStorage, which does hold in service code. No SQL, parameters or rows are kept;
 * every scope is bounded and only explicitly scoped routes collect anything.
 */
export type DbOperationKind = 'read' | 'write' | 'transaction_start' | 'commit' | 'rollback';
export interface DbOperation { kind: DbOperationKind; transactional: boolean; durationMs: number; poolQueued: boolean; failureKind?: string }
interface Collector { operations: DbOperation[]; dropped: number; stages: Record<string, number>; maxConcurrentRequests: number }

export const MAX_RECORDED_OPERATIONS = 64;
const MAX_STAGES = 16;
const MAX_ACTIVE_SCOPES = 32;
const stageStorage = new AsyncLocalStorage<Collector>();
const active = new Set<Collector>();
let inFlightRequests = 0;
const round = (value: number) => Math.round(value * 100) / 100;

/** Called by the request logger for every HTTP request so scopes know whether they ran alone. */
export function trackHttpRequest(): () => void {
  inFlightRequests += 1;
  for (const collector of active) collector.maxConcurrentRequests = Math.max(collector.maxConcurrentRequests, inFlightRequests);
  let ended = false;
  return () => { if (!ended) { ended = true; inFlightRequests -= 1; } };
}

export function collectDbMetrics<T>(action: () => Promise<T>): { result: Promise<T>; metrics: () => DbMetricsSummary } {
  const collector: Collector = { operations: [], dropped: 0, stages: {}, maxConcurrentRequests: inFlightRequests };
  // Beyond the bound a scope still runs, only unobserved (reported as such), so diagnostics never grow without limit.
  const observed = active.size < MAX_ACTIVE_SCOPES;
  if (observed) active.add(collector);
  const result = stageStorage.run(collector, action).finally(() => active.delete(collector));
  return { result, metrics: () => summarize(collector, observed) };
}

export function recordDbOperation(operation: DbOperation): void {
  if (!active.size) return;
  const entry = { ...operation, durationMs: round(operation.durationMs) };
  for (const collector of active) {
    if (collector.operations.length >= MAX_RECORDED_OPERATIONS) collector.dropped += 1;
    else collector.operations.push(entry);
  }
}

/** Times one named application stage of a scoped request (two clock reads outside a scope). */
export async function timeDbStage<T>(stage: string, action: () => Promise<T> | T): Promise<T> {
  const collector = stageStorage.getStore();
  const start = performance.now();
  try { return await action(); }
  finally {
    if (collector && (stage in collector.stages || Object.keys(collector.stages).length < MAX_STAGES)) {
      collector.stages[stage] = round((collector.stages[stage] ?? 0) + performance.now() - start);
    }
  }
}

export interface DbMetricsSummary {
  attribution: 'exclusive' | 'shared' | 'unobserved'; concurrentRequests: number;
  dbOperationCount: number; dbOperationsDropped: number; dbReadCount: number; dbWriteCount: number;
  transactionStartCount: number; transactionStartMs: number; commitCount: number; rollbackCount: number;
  queryMs: number; dbTotalMs: number; maxOperationMs: number; poolQueuedOperations: number;
  failedOperations: number; failureKinds: string[]; stagesMs: Record<string, number>;
  /** Execution order of the first operations, e.g. `transaction_start:301.2`, so per-statement cost is attributable. */
  sequence: string[];
}

function summarize({ operations, dropped, stages, maxConcurrentRequests }: Collector, observed: boolean): DbMetricsSummary {
  const sum = (filter: (operation: DbOperation) => boolean) => round(operations.filter(filter).reduce((total, operation) => total + operation.durationMs, 0));
  const count = (kind: DbOperationKind) => operations.filter(operation => operation.kind === kind).length;
  return {
    attribution: !observed ? 'unobserved' : maxConcurrentRequests <= 1 ? 'exclusive' : 'shared', concurrentRequests: maxConcurrentRequests,
    dbOperationCount: operations.length + dropped, dbOperationsDropped: dropped,
    dbReadCount: count('read'), dbWriteCount: count('write'),
    transactionStartCount: count('transaction_start'), transactionStartMs: sum(operation => operation.kind === 'transaction_start'),
    commitCount: count('commit'), rollbackCount: count('rollback'),
    queryMs: sum(operation => operation.kind === 'read' || operation.kind === 'write'), dbTotalMs: sum(() => true),
    maxOperationMs: operations.reduce((max, operation) => Math.max(max, operation.durationMs), 0),
    poolQueuedOperations: operations.filter(operation => operation.poolQueued).length,
    failedOperations: operations.filter(operation => operation.failureKind).length,
    failureKinds: [...new Set(operations.flatMap(operation => operation.failureKind ? [operation.failureKind] : []))].slice(0, 4),
    stagesMs: { ...stages },
    sequence: operations.slice(0, MAX_STAGES).map(operation => `${operation.kind}:${operation.durationMs}`),
  };
}
