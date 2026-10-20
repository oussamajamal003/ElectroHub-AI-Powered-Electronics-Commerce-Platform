import { describe, expect, it } from 'vitest';
import { DevSupervisorAuthority, initializeDevSupervisor, requireSupervisedPaymentAttemptIds, requireSupervisedPaymentScope, validateGovernedSince, validateSupervisorAttemptIds, recoveryUnavailable, RECOVERY_DEGRADED_AFTER_FAILURES } from './dev-supervisor.js';

const identity = 'supabase:pzxekjybdiulzmssalfo/postgres';
const nonce = 'a'.repeat(64);
const prepare = { type: 'payment-supervisor.prepare', identity, parentPid: 123, nonce };
const attemptIds = ['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'];
describe('supervisor IPC authority', () => {
  it('does not grant API authority from prepare until activation', () => {
    const state = new DevSupervisorAuthority(identity, 123);
    expect(state.allows(identity, true)).toBe(false);
    expect(state.receive(prepare)).toBe('prepared');
    expect(state.allows(identity, true)).toBe(false);
    expect(state.receive({ type: 'payment-supervisor.activate', nonce })).toBe('activated');
    expect(state.allows(identity, true)).toBe(true);
    expect(state.allows(identity, false)).toBe(false);
    expect(state.allows('other', true)).toBe(false);
  });
  it('does not permit worker mutations while establishing readiness', () => {
    const state = new DevSupervisorAuthority(identity, 123);
    expect(state.allows(identity, true)).toBe(false);
    state.receive(prepare);
    expect(state.allows(identity, true)).toBe(false);
    state.receive({ type: 'payment-supervisor.activate', nonce });
    expect(state.allows(identity, true)).toBe(true);
  });
  it('rejects forged, replayed and wrong-parent/target messages', () => {
    const state = new DevSupervisorAuthority(identity, 123);
    for (const value of [null, 'prepare', { ...prepare, parentPid: 124 }, { ...prepare, identity: 'other' },
      { ...prepare, nonce: 'short' }, { type: 'payment-supervisor.activate', nonce }]) {
      expect(state.receive(value)).toBeNull();
      expect(state.allows(identity, true)).toBe(false);
    }
    expect(state.receive(prepare)).toBe('prepared');
    expect(state.receive(prepare)).toBeNull();
    expect(state.receive({ type: 'payment-supervisor.activate', nonce: 'b'.repeat(64) })).toBeNull();
    expect(state.allows(identity, true)).toBe(false);
  });
  it('irreversibly revokes authority on shutdown, even if activation is replayed', () => {
    const state = new DevSupervisorAuthority(identity, 123);
    state.receive(prepare);
    expect(state.receive({ type: 'payment-supervisor.revoke', nonce })).toBe('revoked');
    expect(state.allows(identity, true)).toBe(false);
    expect(state.receive({ type: 'payment-supervisor.activate', nonce })).toBeNull();
    expect(state.receive(prepare)).toBeNull();
  });
  it('issues the exact immutable attempt scope to an active worker only', () => {
    const state = new DevSupervisorAuthority(identity, 123, 'worker');
    expect(state.attemptIds(identity, true)).toBeNull();
    expect(state.receive({ ...prepare, attemptIds })).toBe('prepared');
    expect(state.attemptIds(identity, true)).toBeNull();
    expect(state.receive({ type: 'payment-supervisor.activate', nonce })).toBe('activated');
    const scope = state.attemptIds(identity, true);
    expect(scope).toEqual(attemptIds);
    expect(Object.isFrozen(scope)).toBe(true);
    expect(state.attemptIds(identity, false)).toBeNull();
    expect(new DevSupervisorAuthority(identity, 123).receive({ ...prepare, attemptIds })).toBe('scope-rejected');
  });
  it('rejects missing, empty, malformed, duplicated, and oversized worker scopes before preparation', () => {
    const invalid = [undefined, [], ['not-a-uuid', attemptIds[1]], [attemptIds[0], attemptIds[0]], [...attemptIds, '33333333-3333-4333-8333-333333333333']];
    for (const value of invalid) {
      expect(validateSupervisorAttemptIds(value)).toBeNull();
      expect(() => requireSupervisedPaymentAttemptIds(value)).toThrow('DEV_SUPERVISOR_ATTEMPT_SCOPE_REQUIRED');
      const state = new DevSupervisorAuthority(identity, 123, 'worker');
      expect(state.receive({ ...prepare, ...(value === undefined ? {} : { attemptIds: value }) })).toBe('scope-rejected');
      expect(state.attemptIds(identity, true)).toBeNull();
    }
  });
  it('does not trust a caller-set supervised environment flag without the supervisor IPC channel', async () => {
    const send = Object.getOwnPropertyDescriptor(process, 'send');
    const connected = Object.getOwnPropertyDescriptor(process, 'connected');
    Object.defineProperty(process, 'send', { configurable: true, writable: true, value: undefined });
    Object.defineProperty(process, 'connected', { configurable: true, writable: true, value: false });
    try {
      await expect(initializeDevSupervisor({ PAYMENT_DEV_SUPERVISED: '1', NODE_ENV: 'development',
        STRIPE_SECRET_KEY: 'sk_test_example', STRIPE_WEBHOOK_SECRET: 'whsec_example' })).rejects.toThrow('DEV_SUPERVISOR_CHANNEL_REQUIRED');
    } finally {
      const processRecord = process as unknown as Record<string, unknown>;
      if (send) Object.defineProperty(process, 'send', send); else delete processRecord.send;
      if (connected) Object.defineProperty(process, 'connected', connected); else delete processRecord.connected;
    }
  });
});

describe('supervised worker scope size', () => {
  const one = '51b336ee-f09a-4094-8b7e-5d4b90b9a815';
  const two = '11111111-1111-4111-8111-111111111111';
  it('accepts one or two exact reviewed IDs and nothing wider, empty, duplicated or malformed', () => {
    expect(validateSupervisorAttemptIds([one])).toEqual([one]);
    expect(validateSupervisorAttemptIds([one, two])).toEqual([one, two]);
    for (const bad of [[], [one, one], [one, two, '22222222-2222-4222-8222-222222222222'], ['all'], one, null]) {
      expect(validateSupervisorAttemptIds(bad)).toBeNull();
    }
    expect(() => requireSupervisedPaymentAttemptIds([])).toThrow('DEV_SUPERVISOR_ATTEMPT_SCOPE_REQUIRED');
    expect(Object.isFrozen(requireSupervisedPaymentAttemptIds([one]))).toBe(true);
  });
});

describe('governed worker scope over IPC', () => {
  const identity = 'supabase:pzxekjybdiulzmssalfo/postgres';
  const nonce = 'b'.repeat(64);
  const since = new Date(Date.now() - 3600_000).toISOString();
  const prepare = (extra: Record<string, unknown>) => ({ type: 'payment-supervisor.prepare', identity, parentPid: 77, nonce, ...extra });
  it('accepts exactly one bounded past boundary for the worker and exposes it only while active and connected', () => {
    const worker = new DevSupervisorAuthority(identity, 77, 'worker');
    expect(worker.receive(prepare({ createdSince: since }))).toBe('prepared');
    expect(worker.workerScope(identity, true)).toBeNull();
    worker.receive({ type: 'payment-supervisor.activate', nonce });
    expect(worker.workerScope(identity, true)).toEqual({ createdSince: new Date(since) });
    expect(worker.attemptIds(identity, true)).toBeNull();
    expect(worker.workerScope(identity, false)).toBeNull();
    worker.revoke();
    expect(worker.workerScope(identity, true)).toBeNull();
  });
  it('rejects both forms, neither, future, stale or malformed boundaries, and any scope sent to the API', () => {
    for (const extra of [{}, { createdSince: since, attemptIds: ['51b336ee-f09a-4094-8b7e-5d4b90b9a815'] },
      { createdSince: new Date(Date.now() + 60_000).toISOString() }, { createdSince: new Date(Date.now() - 31 * 86_400_000).toISOString() },
      { createdSince: 'yesterday' }, { createdSince: 1 }]) {
      expect(new DevSupervisorAuthority(identity, 77, 'worker').receive(prepare(extra))).toBe('scope-rejected');
    }
    expect(new DevSupervisorAuthority(identity, 77, 'api').receive(prepare({ createdSince: since }))).toBe('scope-rejected');
    expect(validateGovernedSince(since)).toEqual(new Date(since));
    expect(() => requireSupervisedPaymentScope(null)).toThrow('DEV_SUPERVISOR_ATTEMPT_SCOPE_REQUIRED');
    expect(requireSupervisedPaymentScope({ createdSince: new Date(since) })).toEqual({ createdSince: new Date(since) });
  });
});

describe('transient recovery failures do not tear down the supervised runtime', () => {
  it('degrades only when the loop reports the runner unavailable (3 consecutive failures); malformed counts fail closed', () => {
    expect(recoveryUnavailable({ event: 'payment.recovery.batch_failed', consecutiveFailures: 1 })).toBe(false);
    expect(recoveryUnavailable({ event: 'payment.recovery.batch_failed', consecutiveFailures: 2 })).toBe(false);
    expect(recoveryUnavailable({ event: 'payment.recovery.batch_failed', consecutiveFailures: 3 })).toBe(true);
    expect(recoveryUnavailable({ event: 'payment.recovery.batch_failed', consecutiveFailures: 9 })).toBe(true);
    for (const bad of [undefined, '1', 1.5, null]) expect(recoveryUnavailable({ event: 'payment.recovery.batch_failed', consecutiveFailures: bad })).toBe(true);
    expect(recoveryUnavailable({ event: 'payment.recovery.escalation', consecutiveFailures: 5 })).toBe(false);
    expect(RECOVERY_DEGRADED_AFTER_FAILURES).toBe(3);
  });
});
