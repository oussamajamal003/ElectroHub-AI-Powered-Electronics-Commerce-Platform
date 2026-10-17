import { describe, expect, it } from 'vitest';
import { PaymentDiagnostics, collectTenantTelemetry } from './payment-diagnostics.js';
describe('Bounded client diagnostics', () => {
  it('tracks overlapping operation demand without claiming connection counts; completion is idempotent', () => {
    const d = new PaymentDiagnostics(true, 5);
    const first = d.beginDatabaseOperation(), second = d.beginDatabaseOperation();
    expect(d.snapshot().application.instrumentedOperationsInFlight).toBe(2);
    expect(d.snapshot().application.active).toBeNull();
    first(); first(); second();
    expect(d.snapshot().application.instrumentedOperationsInFlight).toBe(0);
    expect(d.snapshot().application.peakInstrumentedOperations).toBe(2);
    expect(d.snapshot().tenant.headroom).toBeNull();
    const disabled = new PaymentDiagnostics(false, 5); disabled.beginDatabaseOperation()();
    expect(disabled.snapshot().application.peakInstrumentedOperations).toBe(0);
  });
  it('does not derive tenant headroom from application demand', () => {
    const d = new PaymentDiagnostics(true, 5, () => ({ totalCount: 3, idleCount: 1, waitingCount: 2 }));
    expect(d.snapshot().application.active).toBe(2); expect(d.snapshot().tenant.headroom).toBeNull();
    expect(d.snapshot().application.acquisitionMs).toBeNull();
    expect(() => d.record('database-operation', 1, { get code() { throw Error('private'); } })).not.toThrow();
  });
  it('preserves missing database-event duration as unknown instead of recording zero', () => {
    const d = new PaymentDiagnostics(true, 5);
    d.record('database-operation', null, { code: 'DATABASE_ERROR' }, 'request_123');
    expect(d.snapshot().samples).toEqual([{ boundary: 'database-operation', durationMs: null, outcome: 'ERROR', correlationId: 'request_123' }]);
    expect(d.snapshot().application.errors).toBe(1);
  });
  it('bounds samples, classifies timeout and excludes secrets/error text', () => {
    const d = new PaymentDiagnostics(true, 5);
    for (let i = 0; i < 140; i++) d.record('transaction', 1, { code: 'P2028', message: 'sensitive-query' }, 'request_123');
    expect(d.snapshot().samples).toHaveLength(128); expect(d.snapshot().application.failures.transaction).toBe(140);
    expect(d.snapshot().application.timeouts).toBe(0); // P2028 alone does not establish a timeout.
    expect(JSON.stringify(d.snapshot())).not.toContain('sensitive'); expect(d.snapshot().samples[0].correlationId).toBe('request_123');
    const invalid = new PaymentDiagnostics(true, 5); invalid.record('transaction', 1, undefined, 'unsafe\ncorrelation');
    expect(invalid.snapshot().samples[0].correlationId).toBeNull();
  });
  it('separates known database connection failures from provider failures and explicit transaction timeouts', () => {
    const d = new PaymentDiagnostics(true, 5);
    d.record('provider-operation', 1, { code: 'ECONNREFUSED' });
    expect(d.snapshot().application.connectionErrors).toBe(0);
    d.record('database-operation', 2, { code: 'P1001' });
    d.record('transaction', 3, { code: 'ETIMEDOUT' });
    expect(d.snapshot().application.connectionErrors).toBe(1);
    expect(d.snapshot().application.transactionTimeouts).toBe(1);
    expect(d.snapshot().application.failures['provider-operation']).toBe(1);
  });
  it('collector failure and disabled diagnostics remain inert', () => {
    const d = new PaymentDiagnostics(false, 5, () => { throw Error('secret'); });
    d.record('provider-operation', 5); expect(d.snapshot().samples).toEqual([]); expect(d.snapshot().application.pool).toBeNull();
  });
  it('tenant collector rejects unavailable, stale or wrong-project observations', async () => {
    expect((await collectTenantTelemetry()).status).toBe('UNKNOWN');
    expect((await collectTenantTelemetry(async () => { throw Error('private'); })).status).toBe('UNKNOWN');
    const value = { projectRef: 'pzxekjybdiulzmssalfo', measuredAt: new Date().toISOString(), activeClients: 4,
      maximumClients: 200, activeSessions: 4, maximumSessions: 15, waitingClients: 0, utilization: 4 / 15, rejected: 0, timeouts: 0, headroom: 11 };
    expect((await collectTenantTelemetry(async () => value)).status).toBe('VERIFIED');
    expect((await collectTenantTelemetry(async () => ({ ...value, projectRef: 'foreign' }))).status).toBe('UNKNOWN');
  });
});
