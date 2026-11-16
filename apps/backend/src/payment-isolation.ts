/*
 * Payment isolation boundary (Task 04.0).
 *
 * On 2026-10-17 a watched `npm run dev` backend hot-reloaded uncommitted payment code against shared DEV and its in-process recovery
 * cancelled real DEV purchases. Database isolation alone does not prevent that, so every payment-mutating path asks this one decision:
 *
 * - Both URLs must identify one approved logical project/dataset and a session-compatible runtime connection.
 * - Disposable tests do not inherit shared authority. NODE_ENV=test never authorizes shared DB writes.
 * - Shared DEV requires the approved supervisor's live IPC activation; watched/shared development remains restricted.
 * - Production retains its explicit deployment approval, only for the verified production target.
 *
 * Denied means: no recovery runner, no worker batches, no provider mutation, no webhook ingestion and no customer payment write.
 * Payment status remains readable. Configuration classification never claims network/TLS readiness.
 */
import { resolveDatabaseTargets } from './lib/database-target.js';
import { devSupervisorAllowed } from './lib/dev-supervisor.js';

export type PaymentTargetKind = 'disposable' | 'shared' | 'unconfigured';
export interface PaymentIsolationDecision {
  allowed: boolean;
  target: PaymentTargetKind;
  /** Logical target identity, with no credentials or URL parameters. Safe to log. */
  identity: string;
  reason: 'disposable-target' | 'shared-target-approved' | 'shared-target-not-approved' | 'watched-dev-server-on-shared-target' |
    'database-unconfigured' | 'database-target-invalid' | 'provider-test-mode-required' | 'shared-supervisor-required';
}

export function resolvePaymentIsolation(environment: NodeJS.ProcessEnv = process.env): PaymentIsolationDecision {
  if (!environment.DATABASE_URL || !environment.DIRECT_URL) {
    return { allowed: false, target: 'unconfigured', identity: 'none', reason: 'database-unconfigured' };
  }
  let runtime;
  try { runtime = resolveDatabaseTargets(environment).runtime; }
  catch { return { allowed: false, target: 'shared', identity: 'invalid', reason: 'database-target-invalid' }; }
  const target = runtime.category === 'disposable' ? 'disposable' : 'shared';
  const denied = (reason: PaymentIsolationDecision['reason']): PaymentIsolationDecision =>
    ({ allowed: false, target, identity: runtime.identity, reason });
  // Mock tests may omit a key only after proving the disposable target configuration.
  const key = environment.STRIPE_SECRET_KEY;
  if (runtime.category !== 'production' &&
    (key ? !/^(?:sk|rk)_test_[A-Za-z0-9]+$/.test(key) : environment.NODE_ENV !== 'test')) return denied('provider-test-mode-required');
  if (runtime.category === 'disposable') return { allowed: true, target, identity: runtime.identity, reason: 'disposable-target' };
  if (environment.npm_lifecycle_event === 'dev') return denied('watched-dev-server-on-shared-target');
  if (runtime.category === 'dev') {
    return devSupervisorAllowed(runtime.identity)
      ? { allowed: true, target, identity: runtime.identity, reason: 'shared-target-approved' }
      : denied('shared-supervisor-required');
  }
  // Preserve the explicit production deployment approval contract. DEV/test cannot reach this branch.
  const physicalIdentities = [...new Set([environment.DATABASE_URL, environment.DIRECT_URL].map(value => {
    const url = new URL(value!);
    return `${url.hostname}:${url.port || '5432'}/${decodeURIComponent(url.pathname.slice(1))}`;
  }))].join(',');
  return environment.PAYMENT_SHARED_MUTATIONS_APPROVED?.trim() === physicalIdentities
    ? { allowed: true, target, identity: runtime.identity, reason: 'shared-target-approved' }
    : denied('shared-target-not-approved');
}

/** Supervisor authority is revocable; never cache an enabled decision across IPC loss/shutdown. */
export function paymentIsolation(): PaymentIsolationDecision {
  return resolvePaymentIsolation();
}
