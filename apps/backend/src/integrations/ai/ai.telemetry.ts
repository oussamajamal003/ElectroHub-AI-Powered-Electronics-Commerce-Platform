import { logger } from '../../utils/logger.js';
import type { AiServiceEnvironment } from './ai.config.js';

/**
 * Task 04.1: sanitized telemetry for the Express -> FastAPI boundary.
 *
 * One structured event per upstream call (AI_SERVICE_REQUEST_COMPLETED / AI_SERVICE_REQUEST_FAILED) plus bounded
 * in-process counters per operation that the admin AI status route reports. Fields are an explicit allowlist: never
 * URLs, keys, headers, bodies, customer identifiers, images or vectors. Telemetry can never fail the AI call itself.
 */

const REQUEST_ID_PATTERN = /^[A-Za-z0-9_-]{1,100}$/;
/** Operations are fixed client paths, so this bound is only a guard against misuse. */
const MAX_OPERATIONS = 16;

export interface AiRequestTelemetry {
  operation: string;
  environment: AiServiceEnvironment;
  durationMs: number;
  requestId?: string;
  outcome: 'success' | 'failure';
  statusCode?: number;
  category?: string;
  code?: string;
}

interface OperationCounters {
  success: number;
  failure: number;
  failuresByCategory: Record<string, number>;
  lastDurationMs: number;
}

const counters = new Map<string, OperationCounters>();

function statusClass(statusCode: number | undefined) {
  return statusCode ? `${Math.floor(statusCode / 100)}xx` : 'none';
}

function count(event: AiRequestTelemetry) {
  let entry = counters.get(event.operation);
  if (!entry) {
    if (counters.size >= MAX_OPERATIONS) return;
    entry = { success: 0, failure: 0, failuresByCategory: {}, lastDurationMs: 0 };
    counters.set(event.operation, entry);
  }
  entry.lastDurationMs = event.durationMs;
  if (event.outcome === 'success') {
    entry.success += 1;
  } else {
    entry.failure += 1;
    const category = event.category ?? 'unknown';
    entry.failuresByCategory[category] = (entry.failuresByCategory[category] ?? 0) + 1;
  }
}

export function recordAiRequest(event: AiRequestTelemetry): void {
  try {
    count(event);
    const fields = {
      operation: event.operation,
      environment: event.environment,
      outcome: event.outcome,
      statusClass: statusClass(event.statusCode),
      statusCode: event.statusCode,
      category: event.category,
      code: event.code,
      durationMs: event.durationMs,
      requestId: event.requestId && REQUEST_ID_PATTERN.test(event.requestId) ? event.requestId : undefined,
    };
    if (event.outcome === 'success') logger.info('AI_SERVICE_REQUEST_COMPLETED', fields);
    else logger.warn('AI_SERVICE_REQUEST_FAILED', fields);
  } catch {
    // Observability must never turn a completed AI call (or its controlled failure) into a different error.
  }
}

/** Snapshot of per-operation counters since process start (copies; callers cannot mutate state). */
export function getAiServiceMetrics() {
  return Object.fromEntries(
    [...counters].map(([operation, entry]) => [operation, { ...entry, failuresByCategory: { ...entry.failuresByCategory } }])
  );
}

/** Test seam only. */
export function resetAiServiceMetricsForTests() {
  counters.clear();
}
