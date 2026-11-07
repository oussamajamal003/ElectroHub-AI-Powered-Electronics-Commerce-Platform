import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { logger } from '../utils/logger.js';
import { verifyAnalyticsToken } from './analytics-token.js';

/**
 * Task 05.2 analytics event pipeline. `analytics_events` holds only controlled, non-identifying facts: the server-side outcome
 * of an image search (count, outcome category, latency) and a customer's selection of a product returned by that search.
 * - A storefront session's visible time: a random per-tab id (never linked to an account, cookie or IP) and a duration in ms.
 * Never stored here: uploaded images, user ids, emails, URLs, IP addresses or free text.
 */
export const ANALYTICS_RETENTION_DAYS = 400;
const DAY_MS = 86_400_000;
const PURGE_BATCH_SIZE = 1000;
const PURGE_MAX_BATCHES = 20;
const MAX_DURATION_MS = 300_000;
/** Longest visible time one storefront tab may report; anything longer is clamped. */
export const MAX_SESSION_MS = 4 * 60 * 60 * 1000;
export const STOREFRONT_SESSION_EVENT = 'storefront.session';

export type ImageSearchFailureCategory = 'inference_timeout' | 'upstream_unavailable' | 'too_large' | 'invalid' | 'busy' | 'failed';

export class AnalyticsUnavailableError extends Error {
  constructor() {
    super('Analytics event could not be stored.');
    this.name = 'AnalyticsUnavailableError';
  }
}

const bounded = (value: number) => Math.min(MAX_DURATION_MS, Math.max(0, Math.round(value)));

/** Fire-and-forget: a storage failure is logged with its error class only and never reaches the image-search response. */
function persistInBackground(event: string, row: Prisma.AnalyticsEventCreateManyInput) {
  void (async () => {
    try {
      await prisma.analyticsEvent.createMany({ data: [row], skipDuplicates: true });
    } catch (error) {
      logger.warn('ANALYTICS_EVENT_DROPPED', { operation: 'analytics.write', event, errorName: error instanceof Error ? error.name : 'unknown' });
    }
  })();
}

/** Records one served image search. A zero result count is a completed search with no results, not a failure. */
export function recordImageSearchCompleted(input: { correlationId: string; resultCount: number; durationMs: number }): void {
  persistInBackground('image_search.completed', {
    type: 'image_search.completed', source: 'SERVER', outcome: input.resultCount > 0 ? 'COMPLETED' : 'NO_RESULTS',
    correlationId: input.correlationId, resultCount: Math.max(0, Math.min(24, Math.round(input.resultCount))),
    durationMs: bounded(input.durationMs), idempotencyKey: `isr:${input.correlationId}`, occurredAt: new Date(),
  });
}

/** Records one failed image search with a fixed, non-sensitive category only. */
export function recordImageSearchFailed(input: { correlationId: string; category: ImageSearchFailureCategory; durationMs: number }): void {
  persistInBackground('image_search.failed', {
    type: 'image_search.failed', source: 'SERVER', outcome: input.category, correlationId: input.correlationId,
    durationMs: bounded(input.durationMs), idempotencyKey: `isr:${input.correlationId}`, occurredAt: new Date(),
  });
}

export type SelectionResult = { accepted: true } | { accepted: false; reason: 'INVALID_TOKEN' | 'PRODUCT_NOT_IN_RESULTS' };

/**
 * Accepts a selection only when the signed token is authentic and unexpired and the product was in that search's result list.
 * A duplicate submission (same search, same product) is absorbed by the idempotency key and still reports accepted.
 * Storage failures throw AnalyticsUnavailableError so the route can answer without exposing details.
 */
export async function recordImageSearchSelection(input: { token: unknown; productId: string }, now = Date.now()): Promise<SelectionResult> {
  const claims = verifyAnalyticsToken(input.token, now);
  if (!claims) return { accepted: false, reason: 'INVALID_TOKEN' };
  const productId = input.productId.toLowerCase();
  if (!claims.productIds.includes(productId)) return { accepted: false, reason: 'PRODUCT_NOT_IN_RESULTS' };
  try {
    await prisma.analyticsEvent.createMany({
      data: [{ type: 'image_search.result_selected', source: 'CLIENT', correlationId: claims.correlationId, productId,
        idempotencyKey: `iss:${claims.correlationId}:${productId}`, occurredAt: new Date(now) }],
      skipDuplicates: true,
    });
  } catch (error) {
    logger.warn('ANALYTICS_EVENT_DROPPED', { operation: 'analytics.write', event: 'image_search.result_selected',
      errorName: error instanceof Error ? error.name : 'unknown' });
    throw new AnalyticsUnavailableError();
  }
  return { accepted: true };
}

/**
 * Records (or extends) one storefront session's visible time. The tab reports its running total each time it is hidden, so the
 * same session id arrives several times: the row keeps the largest total and its original start, never a sum. A session row is
 * only ever updated by its own id and type, so this cannot touch any other event.
 */
export async function recordStorefrontSession(input: { sessionId: string; visibleMs: number }, now = Date.now()): Promise<void> {
  const visibleMs = Math.min(MAX_SESSION_MS, Math.max(0, Math.round(input.visibleMs)));
  const sessionId = input.sessionId.toLowerCase();
  try {
    await prisma.$executeRaw(Prisma.sql`
      INSERT INTO "analytics_events" ("id", "type", "source", "correlationId", "durationMs", "idempotencyKey", "occurredAt")
      VALUES (${randomUUID()}::uuid, ${STOREFRONT_SESSION_EVENT}, 'CLIENT', ${sessionId}::uuid, ${visibleMs}, ${`ses:${sessionId}`},
        ${new Date(now - visibleMs)})
      ON CONFLICT ("idempotencyKey") DO UPDATE SET "durationMs" = GREATEST("analytics_events"."durationMs", EXCLUDED."durationMs")
      WHERE "analytics_events"."type" = ${STOREFRONT_SESSION_EVENT}`);
  } catch (error) {
    logger.warn('ANALYTICS_EVENT_DROPPED', { operation: 'analytics.write', event: STOREFRONT_SESSION_EVENT,
      errorName: error instanceof Error ? error.name : 'unknown' });
    throw new AnalyticsUnavailableError();
  }
}

/** Deletes events older than the retention window in bounded batches (indexed by occurredAt). */
export async function purgeExpiredAnalyticsEvents(now = Date.now()): Promise<number> {
  const cutoff = new Date(now - ANALYTICS_RETENTION_DAYS * DAY_MS);
  let deleted = 0;
  for (let batch = 0; batch < PURGE_MAX_BATCHES; batch++) {
    const count = await prisma.$executeRaw(Prisma.sql`
      DELETE FROM "analytics_events" WHERE "id" IN (
        SELECT "id" FROM "analytics_events" WHERE "occurredAt" < ${cutoff} ORDER BY "occurredAt" ASC LIMIT ${PURGE_BATCH_SIZE})`);
    deleted += count;
    if (count < PURGE_BATCH_SIZE) break;
  }
  return deleted;
}
