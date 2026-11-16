/** Client-observed boundaries only. No SQL, parameters, provider objects or error messages. */
export class PaymentDiagnostics {
  private readonly samples: { boundary: string; durationMs: number | null; outcome: string; correlationId: string | null }[] = [];
  private errors = 0;
  private timeouts = 0;
  private inFlight = 0;
  private peakInFlight = 0;
  private transactionTimeouts = 0;
  private connectionErrors = 0;
  private readonly failures = { 'prisma-query': 0, 'database-operation': 0, transaction: 0, 'provider-operation': 0, 'application-operation': 0 };
  constructor(private readonly enabled: boolean, private readonly maximum: number,
    private readonly pool?: () => { totalCount: number; idleCount: number; waitingCount: number }) {}
  /** Instrumented operation demand, NOT checked-out connections; nested spans can overlap. */
  beginDatabaseOperation() {
    if (!this.enabled) return () => {};
    this.inFlight++;
    this.peakInFlight = Math.max(this.peakInFlight, this.inFlight);
    let ended = false;
    return () => { if (!ended) { ended = true; this.inFlight--; } };
  }
  record(boundary: 'prisma-query' | 'database-operation' | 'transaction' | 'provider-operation' | 'application-operation', durationMs: number | null,
    error?: unknown, correlationId?: string) {
    if (!this.enabled || durationMs !== null && (!Number.isFinite(durationMs) || durationMs < 0)) return;
    let code = '';
    try { code = error && typeof error === 'object' && 'code' in error ? String(error.code) : ''; } catch { /* Untrusted exception metadata is not logged. */ }
    const outcome = ['P2028', 'P2024', 'P1001', 'P1002', 'P1017', 'ETIMEDOUT', 'ECONNREFUSED', '53300'].includes(code) ? code : error ? 'ERROR' : 'OK';
    if (error) this.errors++;
    if (error) this.failures[boundary]++;
    if (['P2024', 'P1002', 'ETIMEDOUT'].includes(outcome)) this.timeouts++;
    // P2028 includes non-timeout transaction API failures; do not relabel all as timeouts.
    if (boundary === 'transaction' && ['P1002', 'ETIMEDOUT'].includes(outcome)) this.transactionTimeouts++;
    if (['prisma-query', 'database-operation', 'transaction'].includes(boundary) &&
      ['P2024', 'P1001', 'P1002', 'P1017', 'ECONNREFUSED', '53300'].includes(outcome)) this.connectionErrors++;
    this.samples.push({ boundary, durationMs, outcome, correlationId: correlationId && /^[a-z0-9_-]{1,100}$/i.test(correlationId) ? correlationId : null });
    if (this.samples.length > 128) this.samples.shift();
  }
  snapshot() {
    let pool: { totalCount: number; idleCount: number; waitingCount: number } | null = null;
    try {
      const candidate = this.pool?.();
      if (candidate && Object.values(candidate).every(n => Number.isInteger(n) && n >= 0) && candidate.idleCount <= candidate.totalCount) {
        pool = { totalCount: candidate.totalCount, idleCount: candidate.idleCount, waitingCount: candidate.waitingCount };
      }
    } catch { /* Diagnostics must not affect financial execution. */ }
    return { application: { configuredMaximum: this.maximum, pool, active: pool ? pool.totalCount - pool.idleCount : null,
      errors: this.errors, timeouts: this.timeouts, acquisitionMs: null,
      failures: { ...this.failures }, transactionTimeouts: this.transactionTimeouts, connectionErrors: this.connectionErrors,
      instrumentedOperationsInFlight: this.inFlight, peakInstrumentedOperations: this.peakInFlight },
      tenant: { activeClients: null, maximumClients: null, activeSessions: null, maximumSessions: null, peakDemand: null, waitingClients: null, utilization: null,
        rejected: null, timeouts: null, headroom: null, status: 'UNKNOWN' },
      samples: this.samples.map(sample => ({ ...sample })),
      semantics: 'Error counters count observed boundary failures, not unique incidents. In-flight/peak values count nested instrumented operations, not connections. Prisma query/client durations include transport; pure acquisition and server execution are UNKNOWN' };
  }
}
export const paymentDiagnostics = new PaymentDiagnostics(process.env.ELECTROHUB_SQL_DIAGNOSTICS === '1' && process.env.NODE_ENV !== 'production',
  process.env.NODE_ENV === 'production' ? 10 : 5);

type TenantTelemetry = { projectRef: string; measuredAt: string; activeClients: number; maximumClients: number; activeSessions: number; maximumSessions: number;
  waitingClients: number; utilization: number; rejected: number; timeouts: number; headroom: number };
/** Operator-authorized read-only extension point. No credential/config discovery or HTTP endpoint. */
export async function collectTenantTelemetry(read?: () => Promise<TenantTelemetry>) {
  const unknown = { status: 'UNKNOWN' as const, required: 'DEV operator Supavisor tenant metrics: active/max sessions AND clients, waiting clients, utilization, rejection/timeout counters and headroom' };
  if (process.env.NODE_ENV === 'production' || !read) return unknown;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = await Promise.race([read(), new Promise<never>((_resolve, reject) => { timer = setTimeout(() => reject(new Error('Telemetry unavailable')), 2000); })]);
    const age = Date.now() - Date.parse(value.measuredAt);
    const numbers = [value.activeClients, value.maximumClients, value.activeSessions, value.maximumSessions, value.waitingClients, value.rejected, value.timeouts, value.headroom];
    if (value.projectRef !== 'pzxekjybdiulzmssalfo' || !Number.isFinite(age) || age < 0 || age > 60000 ||
      !numbers.every(n => Number.isInteger(n) && n >= 0) || value.activeClients > value.maximumClients ||
      !Number.isFinite(value.utilization) || value.utilization < 0 || value.utilization > 1 ||
      value.headroom > value.maximumClients - value.activeClients || value.headroom > value.maximumSessions - value.activeSessions) return unknown;
    return { status: 'VERIFIED' as const, activeClients: value.activeClients, maximumClients: value.maximumClients,
      activeSessions: value.activeSessions, maximumSessions: value.maximumSessions,
      waitingClients: value.waitingClients, utilization: value.utilization, rejected: value.rejected,
      timeouts: value.timeouts, headroom: value.headroom, measuredAt: value.measuredAt };
  } catch { return unknown; } finally { if (timer) clearTimeout(timer); }
}
