import { logSafely } from '../utils/logger.js';

/**
 * Task 04.7 real-time observability (architecture §8.6). Fixed, low-cardinality names only: never user ids, order ids, rooms or payloads.
 * Counters are cumulative for the process; gauges are current values. A periodic snapshot goes through the existing logger.
 */
const COUNTERS = ['connections_accepted', 'connections_refused', 'subscribe_ok', 'subscribe_denied', 'subscribe_rate_limited',
  'session_expired', 'user_disconnects', 'published', 'publish_failed', 'revoked', 'simulation_ticks', 'simulation_failed'] as const;
export type RealtimeCounter = typeof COUNTERS[number];

const counters = Object.fromEntries(COUNTERS.map(name => [name, 0])) as Record<RealtimeCounter, number>;
const gauges = { connected_sockets: 0, active_subscriptions: 0, simulation_runners: 0 };
export type RealtimeGauge = keyof typeof gauges;

export const realtimeMetrics = {
  increment(name: RealtimeCounter, by = 1) { counters[name] += by; },
  adjust(name: RealtimeGauge, by: number) { gauges[name] = Math.max(0, gauges[name] + by); },
  set(name: RealtimeGauge, value: number) { gauges[name] = Math.max(0, value); },
  snapshot() { return { counters: { ...counters }, gauges: { ...gauges } }; },
  /** Test isolation only. */
  reset() { for (const name of COUNTERS) counters[name] = 0; for (const name of Object.keys(gauges) as RealtimeGauge[]) gauges[name] = 0; },
};

/** Logs one `delivery.realtime.metrics` snapshot per interval. The timer never keeps the process alive. */
export function startRealtimeMetricsLog(intervalMs = 60_000) {
  const timer = setInterval(() => logSafely('info', 'Delivery realtime metrics', { event: 'delivery.realtime.metrics', ...realtimeMetrics.snapshot() }), intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
