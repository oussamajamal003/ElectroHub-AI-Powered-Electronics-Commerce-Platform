import { resolveDatabaseTargets } from './lib/database-target.js';

let runtimeActivated = false;

/** Process-local activation is performed by the dedicated QA entrypoint, never by the ordinary server bootstrap. */
export function activateDeliveryQaRuntime(source: NodeJS.ProcessEnv = process.env): void {
  assertDeliveryQaRuntime(source);
  runtimeActivated = true;
}
export function isDeliveryQaRuntimeActive(): boolean { return runtimeActivated; }
export function deactivateDeliveryQaRuntime(): void { runtimeActivated = false; }

/** The separate QA entrypoint never starts background workers and cannot target any other database. */
export function assertDeliveryQaRuntime(source: NodeJS.ProcessEnv): void {
  if (source.NODE_ENV !== 'development' || source.DELIVERY_SHARED_DEV_QA !== 'true') throw new Error('DELIVERY_QA_OPT_IN_REQUIRED');
  const targets = resolveDatabaseTargets(source);
  if (targets.runtime.category !== 'dev' || targets.runtime.identity !== 'supabase:pzxekjybdiulzmssalfo/postgres' ||
      targets.migration.identity !== targets.runtime.identity) throw new Error('DELIVERY_QA_DEV_REQUIRED');
  if (source.STRIPE_SECRET_KEY || source.BREVO_API_KEY || source.COMMERCE_EMAIL_ENQUEUE_ENABLED !== 'false' ||
      source.COMMERCE_EMAIL_DISPATCH_ENABLED !== 'false' || source.COMMERCE_EMAIL_SEND_MODE !== 'disabled') {
    throw new Error('DELIVERY_QA_INTEGRATIONS_MUST_BE_DISABLED');
  }
}

/** Bound only the explicitly validated shared-DEV QA process; ordinary application pools keep their normal settings. */
export function deliveryQaPoolOptions(source: NodeJS.ProcessEnv): { max: number; min: number; idleTimeoutMillis: number } | null {
  if (source.DELIVERY_SHARED_DEV_QA !== 'true') return null;
  assertDeliveryQaRuntime(source);
  return { max: 2, min: 0, idleTimeoutMillis: 10_000 };
}
