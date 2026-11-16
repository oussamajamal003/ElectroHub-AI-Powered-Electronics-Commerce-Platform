import { z } from 'zod';
import { describeDatabaseTarget, resolveDatabaseTargets } from '../../lib/database-target.js';
import { assertDeliveryQaRuntime, isDeliveryQaRuntimeActive } from '../../delivery-qa-runtime.config.js';
import coastal from './routes/demo-hub-coastal.json';
import north from './routes/demo-hub-north.json';

/**
 * Task 04.7 demo simulation guards (architecture §8.5, decision D5). It runs only when DELIVERY_SIMULATION_ENABLED=true, NODE_ENV is not
 * production, and DATABASE_URL classifies as a loopback disposable database (`electrohub_disposable_*` / `electrohub_ci*`). Shared DEV and
 * PROD are always refused. Production with the flag set refuses to boot.
 */
export const SIMULATION_TICK_MS = 5_000;
export const SIMULATION_MAX_TICKS = 240;
export const SIMULATION_MAX_POINTS = 120;

export type SimulationAvailability = { enabled: true } | { enabled: false; reason: 'FLAG_OFF' | 'PRODUCTION' | 'DATABASE_NOT_DISPOSABLE' };

/** Strictly scoped opt-in for the dedicated shared-DEV QA entrypoint; never inferred from the ordinary simulation flag. */
export function sharedDevSimulationScope(source: NodeJS.ProcessEnv = process.env): { runId: string; orderIds: string[]; customerUserId: string; productId: string } | null {
  if (source.NODE_ENV !== 'development' || source.DELIVERY_SHARED_DEV_QA !== 'true' ||
      source.DELIVERY_SHARED_DEV_SIMULATION !== 'true' || source.DELIVERY_SIMULATION_ENABLED !== 'true') return null;
  const runId = source.DELIVERY_QA_RUN_ID ?? '';
  const orderIds = (source.DELIVERY_QA_ORDER_IDS ?? '').split(',');
  const customerUserId = source.DELIVERY_QA_CUSTOMER_USER_ID ?? '';
  const productId = source.DELIVERY_QA_PRODUCT_ID ?? '';
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  if (!/^QA-DELIVERY-[0-9]{8}-[a-z0-9]{4,32}$/.test(runId) || !orderIds.length || orderIds.length > 10 ||
      orderIds.some(id => !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(id)) ||
      new Set(orderIds).size !== orderIds.length || !uuid.test(customerUserId) || !uuid.test(productId)) return null;
  try {
    assertDeliveryQaRuntime(source);
    const targets = resolveDatabaseTargets(source);
    if (targets.runtime.category !== 'dev' || targets.runtime.identity !== 'supabase:pzxekjybdiulzmssalfo/postgres' ||
        targets.migration.identity !== targets.runtime.identity) return null;
  } catch { return null; }
  return { runId, orderIds, customerUserId, productId };
}

/**
 * Permanent DEV demo scope for the ordinary shared-DEV backend (any local port). Eligibility rests on trusted server configuration and the
 * positively verified DEV database identity, never on ports or client input: an explicit allowlist of order UUIDs plus the QA run marker,
 * the one QA customer and the one test-fixture product. The runner and the payment-eligibility exception re-verify every order against the
 * database (zero total, unpaid, no attempt, marker, fixture product), so an ordinary purchase can never qualify.
 */
export function devDemoSimulationScope(source: NodeJS.ProcessEnv = process.env): ReturnType<typeof sharedDevSimulationScope> {
  if (source.NODE_ENV !== 'development' || source.DELIVERY_DEV_DEMO !== 'true' || source.DELIVERY_SIMULATION_ENABLED !== 'true') return null;
  const runId = source.DELIVERY_DEV_DEMO_RUN_ID ?? '';
  const orderIds = (source.DELIVERY_DEV_DEMO_ORDER_IDS ?? '').split(',').map(id => id.trim());
  const customerUserId = source.DELIVERY_DEV_DEMO_CUSTOMER_USER_ID ?? '';
  const productId = source.DELIVERY_DEV_DEMO_PRODUCT_ID ?? '';
  const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
  if (!/^QA-DELIVERY-[0-9]{8}-[a-z0-9]{4,32}$/.test(runId) || !orderIds.length || orderIds.length > 10 || orderIds.some(id => !uuid.test(id)) ||
      new Set(orderIds).size !== orderIds.length || !uuid.test(customerUserId) || !uuid.test(productId)) return null;
  try {
    const targets = resolveDatabaseTargets(source);
    if (targets.runtime.category !== 'dev' || targets.runtime.identity !== 'supabase:pzxekjybdiulzmssalfo/postgres' ||
        targets.migration.identity !== targets.runtime.identity) return null;
  } catch { return null; }
  return { runId, orderIds, customerUserId, productId };
}

/**
 * DEV-wide simulation (Task 04.7 follow-up): any legitimately trackable OUT_FOR_DELIVERY order on the verified shared DEV project, with no order,
 * customer, product or marker allowlist. It needs the trusted explicit opt-in (DELIVERY_DEV_DEMO=true) and the positively verified DEV identity.
 * It grants NO payment privilege: eligibility (successful payment, status, delivery record) is still enforced under the order row lock by
 * DeliveryService. Unpaid zero-value QA fixtures are a separate mechanism (`devDemoSimulationScope` / `sharedDevSimulationScope`).
 */
export function devWideSimulationEnabled(source: NodeJS.ProcessEnv = process.env): boolean {
  if (source.NODE_ENV !== 'development' || source.DELIVERY_DEV_DEMO !== 'true' || source.DELIVERY_SIMULATION_ENABLED !== 'true') return false;
  try {
    const targets = resolveDatabaseTargets(source);
    return targets.runtime.category === 'dev' && targets.runtime.identity === 'supabase:pzxekjybdiulzmssalfo/postgres' && targets.migration.identity === targets.runtime.identity;
  } catch { return false; }
}

/** The dedicated QA runtime keeps its exact allowlist; DEV-wide never applies there. Null means "not the QA runtime". */
export function qaRuntimeSimulationScope(): ReturnType<typeof sharedDevSimulationScope> {
  return isDeliveryQaRuntimeActive() ? sharedDevSimulationScope() : null;
}

/** Scope that may grant the unpaid zero-value QA payment exception: the QA runtime's, else the optional DEV fixture allowlist. */
export function activeSharedDevSimulationScope(): ReturnType<typeof sharedDevSimulationScope> {
  return qaRuntimeSimulationScope() ?? devDemoSimulationScope();
}

export type SimulationMode = 'QA_RUNTIME' | 'DEV_WIDE' | null;
export function simulationMode(source: NodeJS.ProcessEnv = process.env): SimulationMode {
  if (source === process.env && isDeliveryQaRuntimeActive()) return qaRuntimeSimulationScope() ? 'QA_RUNTIME' : null;
  if (source !== process.env && sharedDevSimulationScope(source)) return 'QA_RUNTIME';
  return devWideSimulationEnabled(source) ? 'DEV_WIDE' : null;
}

export function simulationAvailability(source: NodeJS.ProcessEnv = process.env): SimulationAvailability {
  if (source.DELIVERY_SIMULATION_ENABLED !== 'true') return { enabled: false, reason: 'FLAG_OFF' };
  if (source.NODE_ENV === 'production') return { enabled: false, reason: 'PRODUCTION' };
  if (simulationMode(source)) return { enabled: true };
  try {
    if (describeDatabaseTarget(source.DATABASE_URL).category !== 'disposable') return { enabled: false, reason: 'DATABASE_NOT_DISPOSABLE' };
  } catch { return { enabled: false, reason: 'DATABASE_NOT_DISPOSABLE' }; }
  return { enabled: true };
}

/** Server bootstrap calls this once. The flag in production is a configuration error, never silently ignored. */
export function assertSimulationBootConfig(source: NodeJS.ProcessEnv = process.env) {
  if (source.DELIVERY_SIMULATION_ENABLED === 'true' && source.NODE_ENV === 'production') {
    throw new Error('DELIVERY_SIMULATION_ENABLED must not be set in production.');
  }
}

// Offsets in degrees from the configured hub, bounded to about ±0.2° (~20 km), so a demo route always plays near DELIVERY_ORIGIN.
const offset = z.tuple([z.number().finite().min(-0.2).max(0.2), z.number().finite().min(-0.2).max(0.2)]);
const fixture = z.object({ id: z.string().regex(/^[a-z0-9-]{1,40}$/), label: z.string().min(1).max(80), fictional: z.literal(true),
  description: z.string().max(200), offsets: z.array(offset).min(2).max(SIMULATION_MAX_POINTS) });
export type SimulationRoute = z.infer<typeof fixture>;

/** Approved fixtures only; each is re-validated at load so a bad edit fails loudly rather than publishing odd coordinates. */
export const SIMULATION_ROUTES: ReadonlyMap<string, SimulationRoute> = new Map([north, coastal].map(raw => {
  const route = fixture.parse(raw);
  return [route.id, route] as const;
}));
