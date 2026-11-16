import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { paymentDiagnostics } from '../lib/payment-diagnostics.js';

type Kind = 'database' | 'stripe' | 'application';
const context = new AsyncLocalStorage<PaymentSetupTiming>();
function diagnostic(operation: () => void) { try { operation(); } catch { /* Measurements never alter financial outcomes. */ } }
export const PAYMENT_TRANSACTION_TIMEOUT_MS = 30_000;
export const PAYMENT_TRANSACTION_MAX_WAIT_MS = 10_000;
export const PAYMENT_SETUP_TRANSACTION_TIMEOUT_MS = PAYMENT_TRANSACTION_TIMEOUT_MS;
export const PAYMENT_SETUP_TRANSACTION_MAX_WAIT_MS = PAYMENT_TRANSACTION_MAX_WAIT_MS;
function beginDemand(kind: Kind) {
  let finish = () => {};
  if (kind === 'database') diagnostic(() => { finish = paymentDiagnostics.beginDatabaseOperation(); });
  return () => diagnostic(finish);
}

const SETUP_TRANSACTION_STAGES = new Set(['idempotency_lookup', 'replay_cart_lock', 'replay_snapshot', 'customer_validation',
  'active_attempt_lock', 'active_work_lock', 'cart_lock', 'active_attempt_lookup', 'active_snapshot', 'purchase_snapshot', 'attempt_create']);

/** Numeric timings only: never accepts query parameters, provider objects or customer data. */
export class PaymentSetupTiming {
  readonly correlationId: string;
  readonly requestStart = new Date().toISOString();
  private readonly started = performance.now();
  private readonly operations: { stage: string; kind: Kind; durationMs: number; outcome: string }[] = [];
  private readonly acquisitionAndBegin: number[] = [];
  private failureStage: string | null = null;
  private failureCode: string | null = null;
  private failureCategory: string | null = null;
  private requestOutcome: 'pending' | 'success' | 'error' = 'pending';
  constructor(correlationId?: string) {
    this.correlationId = correlationId && /^[a-z0-9_-]{1,100}$/i.test(correlationId) ? correlationId : randomUUID();
  }
  run<T>(operation: () => Promise<T>) { return context.run(this, operation); }
  async measure<T>(stage: string, kind: Kind, operation: () => Promise<T>): Promise<T> {
    const started = performance.now();
    const endDemand = beginDemand(kind);
    let failure: unknown;
    try { return await operation(); }
    catch (error) { failure = error; this.markFailure(stage, error); throw error; }
    finally {
      endDemand();
      const durationMs = performance.now() - started;
      let outcome = failure ? 'ERROR' : 'OK';
      diagnostic(() => {
        const code = failure && typeof failure === 'object' && 'code' in failure ? failure.code : null;
        if (typeof code === 'string' && /^(P\d{4}|ETIMEDOUT|ECONNRESET|ECONNREFUSED|53300|40001|40P01)$/.test(code)) outcome = code;
      });
      if (this.operations.length < 128) this.operations.push({ stage, kind, durationMs, outcome });
      diagnostic(() => paymentDiagnostics.record(kind === 'stripe' ? 'provider-operation' : kind === 'application' ? 'application-operation' : stage.includes('transaction') ? 'transaction' : 'database-operation', durationMs, failure, this.correlationId));
    }
  }
  markFailure(stage: string, error: unknown, replace = false): void {
    if (this.failureStage && !replace) return;
    this.failureStage = stage;
    const candidate = error && typeof error === 'object'
      ? ('code' in error ? error.code : 'errorCode' in error ? error.errorCode : undefined) : undefined;
    this.failureCode = typeof candidate === 'string' && /^(P\d{4}|ETIMEDOUT|ECONNRESET|ECONNREFUSED|53300|40001|40P01)$/.test(candidate)
      ? candidate : null;
    this.failureCategory = this.failureCode === 'P2024' ? 'prisma_pool_timeout'
      : this.failureCode === 'P2028' ? 'prisma_transaction_api_error'
      : this.failureCode === 'P2034' || this.failureCode === '40001' ? 'serialization_conflict'
      : this.failureCode === '40P01' ? 'deadlock'
      : this.failureCode === '53300' ? 'postgres_connection_limit'
      : this.failureCode === 'ETIMEDOUT' ? 'network_timeout'
      : this.failureCode?.startsWith('P') ? 'prisma_error'
      : this.failureCode ? 'transport_or_database_error' : null;
  }
  complete(outcome: 'success' | 'error'): void { this.requestOutcome = outcome; }
  transactionEntered(started: number) { this.acquisitionAndBegin.push(performance.now() - started); }
  report() {
    const sum = (stage: string) => this.operations.filter(item => item.stage === stage).reduce((total, item) => total + item.durationMs, 0);
    const total = (items: { durationMs: number }[]) => items.reduce((value, item) => value + item.durationMs, 0);
    const acquisitionAndBeginMs = this.acquisitionAndBegin.reduce((value, item) => value + item, 0);
    const setupTransactions = this.operations.filter(item => item.stage === 'setup_transaction');
    const transactionSpans = this.operations.filter(item => item.kind === 'database' && item.stage.endsWith('_transaction'))
      .map(item => ({ stage: item.stage, durationMs: item.durationMs, outcome: item.outcome,
        timeoutMs: PAYMENT_TRANSACTION_TIMEOUT_MS, maxWaitMs: PAYMENT_TRANSACTION_MAX_WAIT_MS }));
    // Statements awaited inside the setup transaction callback; each is at least one SQL round trip.
    const inSetupTransaction = this.operations.filter(item => SETUP_TRANSACTION_STAGES.has(item.stage));
    const leafDatabase = this.operations.filter(item => item.kind === 'database' && !item.stage.includes('transaction'));
    const locks = this.operations.filter(item => item.stage.endsWith('_lock'));
    const failureIndex = this.failureStage ? this.operations.findIndex(item => item.stage === this.failureStage && item.outcome !== 'OK') : -1;
    const providerOperationsBeforeFailure = this.operations.slice(0, failureIndex < 0 ? this.operations.length : failureIndex + 1)
      .filter(item => item.kind === 'stripe');
    const providerMutations = this.operations.filter(item => item.kind === 'stripe' && /^stripe\.(create|cancel|capture|refund)$/.test(item.stage));
    const latestProviderMutation = providerMutations.at(-1);
    const longestSetupTransactionMs = setupTransactions.reduce((value, item) => Math.max(value, item.durationMs), 0);
    return { event: 'payment.setup.performance', correlationId: this.correlationId, requestStart: this.requestStart,
      dbConnectionAcquisitionMs: null, setupQueryCount: null,
      // Where a setup transaction spends its budget. Client-observed, so lock wait includes its network round trip.
      setupTransactionAttempts: setupTransactions.length,
      setupTransactionOutcomes: setupTransactions.map(item => item.outcome),
      setupTransactionOperationCount: inSetupTransaction.length,
      setupTransactionOperationMs: total(inSetupTransaction),
      // Remainder of the transaction span: COMMIT/ROLLBACK plus client overhead. Meaningful for a single attempt.
      setupTransactionCommitAndOverheadMs: setupTransactions.length
        ? Math.max(0, total(setupTransactions) - acquisitionAndBeginMs - total(inSetupTransaction)) : 0,
      longestSetupTransactionMs, setupTransactionBudgetMs: PAYMENT_SETUP_TRANSACTION_TIMEOUT_MS,
      setupTransactionMaxWaitMs: PAYMENT_SETUP_TRANSACTION_MAX_WAIT_MS,
      setupTransactionBudgetExceeded: longestSetupTransactionMs >= PAYMENT_SETUP_TRANSACTION_TIMEOUT_MS,
      requestOutcome: this.requestOutcome, failureStage: this.failureStage, failureCode: this.failureCode,
      failureCategory: this.failureCategory,
      providerCallsBeforeFailureCount: providerOperationsBeforeFailure.length,
      providerMutationAttempted: Boolean(latestProviderMutation),
      // A resolved SDK call only proves a response was received; it does not by itself
      // prove authorization, capture, or any other final financial state.
      providerMutationOutcome: latestProviderMutation ? latestProviderMutation.outcome === 'OK' ? 'response_received' : 'ambiguous' : 'not_started',
      transactionSpans,
      instrumentedDatabaseOperationCount: leafDatabase.length, instrumentedDatabaseOperationMs: total(leafDatabase),
      rowLockOperationCount: locks.length, rowLockWaitMs: total(locks),
      externalCallCount: this.operations.filter(item => item.kind === 'stripe').length,
      acquisitionAndBeginMs,
      setupTransactionMs: sum('setup_transaction'), inlineWorkerMs: sum('inline_worker'),
      attemptStatusReadMs: sum('attempt_status_read'), cartProjectionMs: sum('cart_projection'),
      stripeApiMs: this.operations.filter(item => item.kind === 'stripe').reduce((total, item) => total + item.durationMs, 0),
      setupServiceMs: performance.now() - this.started, operations: this.operations.map(item => ({ ...item })),
      connectionDiagnostics: paymentDiagnostics.snapshot(),
      // Transaction/worker spans contain child operations; durations must not be summed across levels.
      metricSemantics: 'nested client-observed spans; SQL count and pure pool acquisition unavailable' };
  }
}

export async function paymentOperation<T>(stage: string, kind: Kind, operation: () => Promise<T>): Promise<T> {
  const active = context.getStore();
  if (active) return active.measure(stage, kind, operation);
  const started = performance.now();
  const endDemand = beginDemand(kind);
  const boundary = kind === 'stripe' ? 'provider-operation' : kind === 'application' ? 'application-operation' : stage.includes('transaction') ? 'transaction' : 'database-operation';
  let failure: unknown;
  try { return await operation(); }
  catch (error) { failure = error; throw error; }
  finally { endDemand(); diagnostic(() => paymentDiagnostics.record(boundary, performance.now() - started, failure)); }
}
export function paymentTransactionEntered(started: number) { context.getStore()?.transactionEntered(started); }
export function detachedPaymentOperation<T>(operation: () => Promise<T>) { return context.exit(operation); }
