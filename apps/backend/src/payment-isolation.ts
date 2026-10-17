/**
 * Payment isolation boundary (Task 03.6, Principal Architect gate).
 *
 * On 2026-10-17 a watched `npm run dev` backend hot-reloaded uncommitted payment code against shared DEV and its in-process recovery
 * cancelled real DEV purchases. Database isolation alone does not prevent that, so every payment-mutating path asks this one decision:
 *
 * - DISPOSABLE target (every database URL is loopback AND names an `electrohub_disposable*` / `electrohub_ci*` database): allowed.
 * - Any other (SHARED) target: allowed only when `PAYMENT_SHARED_MUTATIONS_APPROVED` equals the exact resolved target identity
 *   (`host:port/database`) AND the process is not the watched dev server (`npm run dev`). A reviewed deployment sets the variable
 *   deliberately; a hot-reloading developer backend can never be approved.
 * - Unit tests (NODE_ENV=test) use mocked databases and are allowed; DEV-backed integration suites keep their own explicit gates.
 *
 * Denied means: no recovery runner, no worker batches, no provider mutation, no webhook ingestion and no customer payment write.
 * Payment status remains readable. The decision is made from configuration only (no network), once per process.
 */
export type PaymentTargetKind = 'disposable' | 'shared' | 'unconfigured';
export interface PaymentIsolationDecision {
  allowed: boolean;
  target: PaymentTargetKind;
  /** Credential-free identity, e.g. `localhost:55433/electrohub_disposable`. Safe to log. */
  identity: string;
  reason: 'test-environment' | 'disposable-target' | 'shared-target-approved' | 'shared-target-not-approved' | 'watched-dev-server-on-shared-target' |
    'database-unconfigured';
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
const DISPOSABLE_DATABASE = /^electrohub_(?:disposable|ci)[a-z0-9_]*$/;

function describe(url: string | undefined): { identity: string; disposable: boolean } | null {
  if (!url) return null;
  try {
    const parsed = new URL(url);
    const database = decodeURIComponent(parsed.pathname.replace(/^\//, ''));
    const host = parsed.hostname.toLowerCase();
    return { identity: `${host}:${parsed.port || '5432'}/${database}`, disposable: LOOPBACK.has(host) && DISPOSABLE_DATABASE.test(database) };
  } catch { return { identity: 'unparseable', disposable: false }; }
}

export function resolvePaymentIsolation(environment: NodeJS.ProcessEnv = process.env): PaymentIsolationDecision {
  const targets = [describe(environment.DATABASE_URL), describe(environment.DIRECT_URL)].filter(value => value !== null);
  const identity = [...new Set(targets.map(value => value.identity))].join(',') || 'none';
  if (environment.NODE_ENV === 'test') return { allowed: true, target: targets.length && targets.every(value => value.disposable) ? 'disposable' : 'shared', identity, reason: 'test-environment' };
  if (!targets.length) return { allowed: false, target: 'unconfigured', identity, reason: 'database-unconfigured' };
  // Both URLs must agree: a disposable DATABASE_URL with a shared DIRECT_URL is still a shared target.
  if (targets.every(value => value.disposable)) return { allowed: true, target: 'disposable', identity, reason: 'disposable-target' };
  if (environment.npm_lifecycle_event === 'dev') return { allowed: false, target: 'shared', identity, reason: 'watched-dev-server-on-shared-target' };
  const approved = environment.PAYMENT_SHARED_MUTATIONS_APPROVED?.trim();
  return approved && approved === identity
    ? { allowed: true, target: 'shared', identity, reason: 'shared-target-approved' }
    : { allowed: false, target: 'shared', identity, reason: 'shared-target-not-approved' };
}

let cached: PaymentIsolationDecision | null = null;
/** The process-wide decision, computed once from configuration loaded at startup. */
export function paymentIsolation(): PaymentIsolationDecision {
  return cached ??= resolvePaymentIsolation();
}
