import { logger } from '../../utils/logger.js';
import { AI_SERVICE_ENVIRONMENTS } from './ai.config.js';

export const IMAGE_SEARCH_OUTCOMES = [
  'admitted', 'busy', 'rate_limited', 'parsed', 'invalid', 'too_large', 'parse_failed',
  'upload_timeout', 'request_timeout', 'disconnected', 'upstream_unavailable', 'inference_timeout', 'completed', 'failed',
] as const;
export type ImageSearchOutcome = typeof IMAGE_SEARCH_OUTCOMES[number];
interface LifecycleEvent {
  outcome: ImageSearchOutcome;
  requestId?: string;
  uploadDurationMs?: number;
  durationMs?: number;
  statusCode?: number;
  activeRequests?: number;
  resultCount?: number;
  modelVersion?: string;
  embeddingVersion?: string;
}
const counts = new Map<ImageSearchOutcome, number>();
const bounded = (value: number | undefined, max: number) =>
  value !== undefined && Number.isFinite(value) ? Math.min(max, Math.max(0, Math.round(value))) : undefined;
const version = (value: string | undefined) => value && /^[A-Za-z0-9._-]{1,64}$/.test(value) ? value : undefined;

/** Explicit allowlist, fixed categories and saturating counters. No request bodies or arbitrary labels are accepted. */
export function recordImageSearchLifecycle(event: LifecycleEvent): void {
  try {
    if (!IMAGE_SEARCH_OUTCOMES.includes(event.outcome)) return;
    counts.set(event.outcome, Math.min(Number.MAX_SAFE_INTEGER, (counts.get(event.outcome) ?? 0) + 1));
    const configured = process.env.AI_SERVICE_ENVIRONMENT ?? process.env.NODE_ENV;
    const fields = {
      operation: 'image_search.lifecycle',
      environment: AI_SERVICE_ENVIRONMENTS.find(value => value === configured) ?? 'development',
      outcome: event.outcome,
      requestId: event.requestId && /^[A-Za-z0-9_-]{1,100}$/.test(event.requestId) ? event.requestId : undefined,
      uploadDurationMs: bounded(event.uploadDurationMs, 300_000),
      durationMs: bounded(event.durationMs, 300_000),
      statusCode: bounded(event.statusCode, 599),
      activeRequests: bounded(event.activeRequests, 64),
      resultCount: bounded(event.resultCount, 24),
      modelVersion: version(event.modelVersion),
      embeddingVersion: version(event.embeddingVersion),
    };
    if (['admitted', 'parsed', 'completed'].includes(event.outcome)) logger.info('IMAGE_SEARCH_LIFECYCLE', fields);
    else logger.warn('IMAGE_SEARCH_LIFECYCLE', fields);
  } catch { /* Observability must never alter a request outcome. */ }
}

export function getImageSearchLifecycleMetrics() { return Object.fromEntries(counts); }
export function resetImageSearchLifecycleMetricsForTests() { counts.clear(); }
