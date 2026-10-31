import { z } from 'zod';
import { describeDatabaseTarget } from '../../lib/database-target.js';
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

export function simulationAvailability(source: NodeJS.ProcessEnv = process.env): SimulationAvailability {
  if (source.DELIVERY_SIMULATION_ENABLED !== 'true') return { enabled: false, reason: 'FLAG_OFF' };
  if (source.NODE_ENV === 'production') return { enabled: false, reason: 'PRODUCTION' };
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
