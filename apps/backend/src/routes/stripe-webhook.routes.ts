import express, { Router, type RequestHandler } from 'express';
import type Stripe from 'stripe';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { env } from '../config/env.js';
import { AppError } from '../middleware/errorHandler.js';
import { stripeProvider } from '../services/stripe.provider.js';
import { logger } from '../utils/logger.js';
import { randomUUID } from 'node:crypto';
import { paymentIsolation, type PaymentIsolationDecision } from '../payment-isolation.js';

type WebhookDependencies = {
  database?: typeof prisma;
  webhookSecret?: string;
  constructEvent?: (payload: Buffer, signature: string, secret: string) => Stripe.Event;
  account?: () => Promise<string>;
  isolation?: () => PaymentIsolationDecision;
};

const recognized = new Set(['payment_intent.amount_capturable_updated', 'payment_intent.succeeded', 'payment_intent.payment_failed',
  'payment_intent.processing', 'payment_intent.canceled', 'refund.created', 'refund.updated', 'refund.failed', 'charge.refunded']);
const parseBytes = express.raw({ type: 'application/json', limit: '256kb' });
const boundedBytes: RequestHandler = (req, res, next) => parseBytes(req, res, (error: unknown) => {
  if (error && typeof error === 'object' && 'type' in error && error.type === 'entity.too.large') {
    next(new AppError('Webhook body is too large.', 413, 'WEBHOOK_BODY_TOO_LARGE')); return;
  }
  next(error);
});

/** Exact provider bytes are authenticated before any database mutation. No JWT or raw-body logging. */
export function createStripeWebhookRouter(dependencies: WebhookDependencies = {}) {
  const router = Router();
  const database = dependencies.database ?? prisma;
  const webhookSecret = dependencies.webhookSecret ?? env.STRIPE_WEBHOOK_SECRET;
  const constructEvent = dependencies.constructEvent ?? ((payload, signature, secret) =>
    stripeProvider.sdk().webhooks.constructEvent(payload, signature, secret));
  const account = dependencies.account ?? (() => stripeProvider.account());
  const isolation = dependencies.isolation ?? paymentIsolation;

  router.post('/api/webhooks/stripe', (req, res, next) => {
  const correlationId = randomUUID();
  const started = performance.now();
  res.locals.webhookAudit = { correlationId, signature: 'NOT_VERIFIED', database: 'NOT_STARTED' };
  res.setHeader('x-webhook-correlation-id', correlationId);
  const audit = (phase: string) => {
    // Logging is best effort; transport failures cannot change a committed outcome.
    try { logger.info('Stripe webhook audit', { event: 'stripe.webhook.audit', phase,
      ...res.locals.webhookAudit, status: phase === 'response' ? res.statusCode : undefined,
      durationMs: Math.round(performance.now() - started), timestampUtc: new Date().toISOString() }); }
    catch { /* The owned receipt sink separately reports persistence failure. */ }
  };
  res.locals.audit = audit;
  audit('arrival'); res.once('finish', () => audit('response')); next();
}, boundedBytes, async (req, res, next) => {
  let event: Stripe.Event;
  try {
    if (!isolation().allowed) throw new AppError('Payments are unavailable in this environment.', 503, 'PAYMENT_MUTATIONS_DISABLED');
    if (!webhookSecret?.startsWith('whsec_')) throw new AppError('Webhook unavailable.', 503, 'PAYMENT_CONFIGURATION_UNAVAILABLE');
    const signature = req.get('Stripe-Signature');
    if (!Buffer.isBuffer(req.body) || !signature) throw new AppError('Invalid webhook signature.', 400, 'WEBHOOK_INVALID_SIGNATURE');
    try { event = constructEvent(req.body, signature, webhookSecret); }
    catch { res.locals.webhookAudit.signature = 'INVALID'; throw new AppError('Invalid webhook signature.', 400, 'WEBHOOK_INVALID_SIGNATURE'); }
    const safeIdentity = (value: string, pattern: RegExp) => typeof value === 'string' && value.length <= 100 &&
      pattern.test(value) && !/(?:sk|rk|pk)_(?:test|live)_|whsec_|_secret_/.test(value) ? value : undefined;
    Object.assign(res.locals.webhookAudit, { signature: 'VALID',
      eventId: safeIdentity(event.id, /^evt_[A-Za-z0-9]+$/),
      eventType: safeIdentity(event.type, /^[a-z][a-z0-9_]*(?:\.[a-z0-9_]+)+$/) });
    res.locals.audit('signature');
    if (event.livemode || event.account && event.account !== await account()) throw new AppError('Webhook environment mismatch.', 400, 'WEBHOOK_ENVIRONMENT_MISMATCH');
    const object = event.data.object;
    const intentId = object.object === 'payment_intent' ? object.id :
      'payment_intent' in object && typeof object.payment_intent === 'string' ? object.payment_intent : null;
    // One atomic statement avoids three hosted-DB round trips and the interactive
    // transaction timeout. The FK read lock also serializes disposable fixture cleanup.
    // Only a newly accepted event wakes work; duplicates never disturb a live lease.
    // Timestamps come from the application clock, like every other PaymentWork write: CURRENT_TIMESTAMP in these
    // timestamp-without-time-zone columns follows the session TimeZone, so a non-UTC session scheduled work hours late.
    const receivedAt = new Date();
    const outcomes = await database.$queryRaw<Array<{ inserted: number; scheduled: number; existingDisposition: string | null; mismatch: boolean }>>(Prisma.sql`
      WITH bound AS MATERIALIZED (
        SELECT "id" FROM "payment_attempts"
        WHERE ${recognized.has(event.type)} AND "providerIntentId" = ${intentId}
        FOR KEY SHARE
      ), accepted AS (
        INSERT INTO "stripe_events" ("id", "type", "providerIntentId", "attemptId", "disposition", "createdAt")
        SELECT ${event.id}, ${event.type}, ${intentId}, bound."id",
          CASE WHEN bound."id" IS NULL THEN 'IGNORED' ELSE 'ACCEPTED' END, ${receivedAt}::timestamp(3)
        FROM (SELECT 1) AS event_row LEFT JOIN bound ON TRUE
        ON CONFLICT ("id") DO NOTHING
        RETURNING "attemptId"
      ), scheduled AS (
      UPDATE "payment_work" SET "state" = 'READY', "nextRunAt" = ${receivedAt}::timestamp(3), "retryCount" = 0, "updatedAt" = ${receivedAt}::timestamp(3)
      WHERE "attemptId" IN (SELECT "attemptId" FROM accepted)
        AND "state" IN ('READY', 'DONE', 'INCIDENT')
        RETURNING "attemptId"
      )
      SELECT (SELECT count(*)::int FROM accepted) AS inserted,
        (SELECT count(*)::int FROM scheduled) AS scheduled,
        (SELECT "disposition" FROM "stripe_events" WHERE "id" = ${event.id}) AS "existingDisposition",
        EXISTS (SELECT 1 FROM "stripe_events" e WHERE e."id" = ${event.id}
          AND (e."type" IS DISTINCT FROM ${event.type} OR e."providerIntentId" IS DISTINCT FROM ${intentId}
            OR e."attemptId" IS DISTINCT FROM (SELECT "id" FROM bound))) AS mismatch
    `);
    const outcome = outcomes[0];
    if (!outcome) throw new Error('Missing atomic ingestion result');
    const classification = outcome.inserted ? 'NEW' : outcome.mismatch ? 'BINDING_MISMATCH' :
      outcome.existingDisposition === 'ACCEPTED' ? 'DUPLICATE_ACCEPTED' :
      outcome.existingDisposition === 'IGNORED' ? 'DUPLICATE_IGNORED' :
      outcome.existingDisposition ? 'DUPLICATE_REJECTED' : 'DUPLICATE_PENDING';
    Object.assign(res.locals.webhookAudit, { database: 'COMMITTED', outcome: classification,
      inserted: outcome.inserted, scheduled: outcome.scheduled });
    res.locals.audit('database');
    // A concurrent INSERT conflict may be invisible to this statement's snapshot.
    // Do not acknowledge unverified persistence; a later provider delivery can verify it.
    if (classification === 'DUPLICATE_PENDING') throw new AppError('Webhook acceptance is temporarily unavailable.', 503, 'WEBHOOK_ACCEPTANCE_PENDING');
    if (classification === 'BINDING_MISMATCH') throw new AppError('Webhook event binding mismatch.', 409, 'WEBHOOK_BINDING_MISMATCH');
    res.json({ received: true });
  } catch (error) {
    const code = error instanceof AppError ? error.code : 'WEBHOOK_ACCEPTANCE_FAILED';
    res.locals.webhookAudit.failure = code;
    if (code === 'WEBHOOK_INVALID_SIGNATURE' && res.locals.webhookAudit.signature === 'NOT_VERIFIED') res.locals.webhookAudit.signature = 'MISSING_OR_INVALID';
    if (res.locals.webhookAudit.database === 'NOT_STARTED' && res.locals.webhookAudit.signature === 'VALID' && !(error instanceof AppError)) res.locals.webhookAudit.database = 'FAILED';
    next(error instanceof AppError ? error : new AppError('Webhook acceptance is temporarily unavailable.', 503, 'WEBHOOK_ACCEPTANCE_FAILED'));
  }
});
  return router;
}

export default createStripeWebhookRouter();
