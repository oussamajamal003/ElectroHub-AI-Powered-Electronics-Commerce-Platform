import { describe, expect, it, vi } from 'vitest';
import { performance } from 'node:perf_hooks';
import { paymentDiagnostics } from '../../lib/payment-diagnostics.js';
import { PaymentSetupTiming, detachedPaymentOperation, paymentOperation } from '../payment.setup-timing.js';

describe('Sanitized payment setup measurements', () => {
  it('diagnostic sink failure preserves success and the original provider failure with and without request context', async () => {
    const record = vi.spyOn(paymentDiagnostics, 'record').mockImplementation(() => { throw Error('diagnostic unavailable'); });
    const begin = vi.spyOn(paymentDiagnostics, 'beginDatabaseOperation').mockImplementation(() => { throw Error('counter unavailable'); });
    try {
      const primary = new Error('provider outcome unknown');
      for (const run of [(operation: () => Promise<unknown>) => operation(), (operation: () => Promise<unknown>) => new PaymentSetupTiming().run(operation)]) {
        await expect(run(() => paymentOperation('lookup', 'database', async () => 42))).resolves.toBe(42);
        await expect(run(() => paymentOperation('stripe.capture', 'stripe', async () => { throw primary; }))).rejects.toBe(primary);
      }
    } finally { record.mockRestore(); begin.mockRestore(); }
  });
  it('isolates concurrent request stages and excludes returned secrets', async () => {
    const first = new PaymentSetupTiming('request-one'); const second = new PaymentSetupTiming('request-two');
    await Promise.all([
      first.run(() => paymentOperation('first_lookup', 'database', async () => { await Promise.resolve(); return 'private-response'; })),
      second.run(() => paymentOperation('second_lookup', 'database', async () => 'another-private-response')),
    ]);
    expect(first.report().operations.map(item => item.stage)).toEqual(['first_lookup']);
    expect(second.report().operations.map(item => item.stage)).toEqual(['second_lookup']);
    expect(JSON.stringify([first.report(), second.report()])).not.toContain('private-response');
  });
  it('records failed stages and keeps detached worker work outside the request', async () => {
    const timing = new PaymentSetupTiming('failed-request');
    await timing.run(async () => {
      await expect(paymentOperation('failed_lookup', 'database', async () => { throw new Error('private-error-details'); })).rejects.toThrow();
      await detachedPaymentOperation(() => paymentOperation('detached_worker', 'application', async () => undefined));
    });
    expect(timing.report().operations.map(item => item.stage)).toEqual(['failed_lookup']);
    expect(JSON.stringify(timing.report())).not.toContain('private-error-details');
    expect(timing.report().dbConnectionAcquisitionMs).toBeNull();
    expect(timing.report().setupQueryCount).toBeNull();
  });
  it.each(['P2024', 'P2028'])('records the sanitized database error class %s at its stage', async code => {
    const timing = new PaymentSetupTiming('checkout_setup_error');
    await timing.run(async () => {
      await expect(paymentOperation('setup_transaction', 'database', async () => {
        throw Object.assign(new Error('sensitive database detail'), { code });
      })).rejects.toMatchObject({ code });
    });
    expect(timing.report().operations).toContainEqual(expect.objectContaining({
      stage: 'setup_transaction', kind: 'database', outcome: code, durationMs: expect.any(Number),
    }));
    expect(timing.report()).toMatchObject({ failureStage: 'setup_transaction', failureCode: code,
      failureCategory: code === 'P2024' ? 'prisma_pool_timeout' : 'prisma_transaction_api_error' });
    expect(timing.report().transactionSpans).toContainEqual(expect.objectContaining({ stage: 'setup_transaction',
      timeoutMs: 30_000, maxWaitMs: 10_000, outcome: code }));
    expect(JSON.stringify(timing.report())).not.toContain('sensitive database detail');
    expect(timing.report().correlationId).toBe('checkout_setup_error');
  });
  it('marks a failed provider mutation ambiguous and distinguishes it from a final request error', async () => {
    const timing = new PaymentSetupTiming('provider_setup_timeout');
    await timing.run(async () => {
      await expect(paymentOperation('stripe.create', 'stripe', async () => {
        throw Object.assign(new Error('provider response contained a private client secret'), { code: 'ETIMEDOUT' });
      })).rejects.toMatchObject({ code: 'ETIMEDOUT' });
    });
    timing.complete('error');
    expect(timing.report()).toMatchObject({ requestOutcome: 'error', failureStage: 'stripe.create', failureCode: 'ETIMEDOUT',
      failureCategory: 'network_timeout', providerCallsBeforeFailureCount: 1, providerMutationOutcome: 'ambiguous' });
    expect(JSON.stringify(timing.report())).not.toContain('private client secret');
  });
  it('reports a provider response without claiming a verified financial outcome', async () => {
    const timing = new PaymentSetupTiming('provider_response_received');
    await timing.run(() => paymentOperation('stripe.create', 'stripe', async () => ({ clientSecret: 'private-secret' })));
    expect(timing.report()).toMatchObject({ providerMutationAttempted: true, providerMutationOutcome: 'response_received' });
    expect(JSON.stringify(timing.report())).not.toContain('private-secret');
  });
  it('replaces unsafe correlation text rather than logging it', () => {
    const timing = new PaymentSetupTiming('sensitive input\nnot a correlation ID');
    expect(timing.correlationId).toMatch(/^[a-f0-9-]{36}$/);
    expect(JSON.stringify(timing.report())).not.toContain('sensitive input');
  });
});

describe('Setup transaction budget breakdown', () => {
  // Deterministic clock: each awaited step advances the measured time by an exact amount.
  function clock() {
    let now = 1_000; const spy = vi.spyOn(performance, 'now').mockImplementation(() => now);
    return { spend: async (ms: number) => { await Promise.resolve(); now += ms; }, restore: () => spy.mockRestore() };
  }
  it('separates acquisition, in-transaction statements, row-lock waits, external calls and commit remainder', async () => {
    const time = clock();
    try {
      const timing = new PaymentSetupTiming('setup_breakdown');
      await timing.run(async () => {
        await paymentOperation('stripe.account', 'stripe', () => time.spend(100));
        const started = performance.now();
        await paymentOperation('setup_transaction', 'database', async () => {
          await time.spend(400); timing.transactionEntered(started);
          await paymentOperation('idempotency_lookup', 'database', () => time.spend(1000));
          await paymentOperation('cart_lock', 'database', () => time.spend(3000));
          await paymentOperation('purchase_snapshot', 'database', () => time.spend(2000));
          await paymentOperation('attempt_create', 'database', () => time.spend(1500));
          await time.spend(600); // commit
        });
        await paymentOperation('attempt_status_read', 'database', () => time.spend(700));
      });
      expect(timing.report()).toMatchObject({ setupTransactionAttempts: 1, setupTransactionOutcomes: ['OK'],
        acquisitionAndBeginMs: 400, setupTransactionOperationCount: 4, setupTransactionOperationMs: 7500,
        rowLockOperationCount: 1, rowLockWaitMs: 3000, setupTransactionCommitAndOverheadMs: 600, longestSetupTransactionMs: 8500,
        externalCallCount: 1, stripeApiMs: 100, instrumentedDatabaseOperationCount: 5, instrumentedDatabaseOperationMs: 8200,
        setupTransactionBudgetMs: 30_000, setupTransactionMaxWaitMs: 10_000, setupTransactionBudgetExceeded: false,
        transactionSpans: [{ stage: 'setup_transaction', timeoutMs: 30_000, maxWaitMs: 10_000, outcome: 'OK', durationMs: 8500 }],
        dbConnectionAcquisitionMs: null, setupQueryCount: null });
    } finally { time.restore(); }
  });
  it('flags a transaction that outlived its budget and preserves the sanitized Prisma code of each attempt', async () => {
    const time = clock();
    try {
      const timing = new PaymentSetupTiming('setup_expired');
      const expired = Object.assign(new Error('Transaction already closed: SELECT private_column FROM private_table'), { code: 'P2028' });
      await timing.run(async () => {
        await paymentOperation('setup_transaction', 'database', async () => { await time.spend(1000); throw Object.assign(new Error('conflict'), { code: 'P2034' }); }).catch(() => undefined);
        await paymentOperation('setup_transaction', 'database', async () => {
          await paymentOperation('purchase_snapshot', 'database', () => time.spend(31_000)); throw expired;
        }).catch(() => undefined);
      });
      const report = timing.report();
      expect(report).toMatchObject({ setupTransactionAttempts: 2, setupTransactionOutcomes: ['P2034', 'P2028'],
        longestSetupTransactionMs: 31_000, setupTransactionBudgetExceeded: true });
      expect(JSON.stringify(report)).not.toMatch(/private_column|private_table|already closed/);
    } finally { time.restore(); }
  });
});
