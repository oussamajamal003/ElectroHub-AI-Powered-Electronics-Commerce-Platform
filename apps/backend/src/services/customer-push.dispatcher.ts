import { randomUUID } from 'node:crypto';
import type { PrismaClient } from '@prisma/client';
import { sendNotification } from 'web-push';
import { pushConfig, subscriptionSchema } from './customer-push.config.js';
import { logSafely } from '../utils/logger.js';

export interface PushTransport { send(subscription: { endpoint: string; keys: { p256dh: string; auth: string } }, payload: string): Promise<{ statusCode: number }> }
export function realPushTransport(): PushTransport {
  const config = pushConfig();
  if (!config.enabled) throw new Error('PUSH_NOT_CONFIGURED');
  return { send: (subscription, payload) => sendNotification(subscription, payload, { TTL: 300, urgency: 'normal', timeout: 10000,
    vapidDetails: { subject: config.subject, publicKey: config.publicKey, privateKey: config.privateKey } }) };
}
export function pushDispatchAllowed(target: { kind: string; identity: string }, source: NodeJS.ProcessEnv = process.env) {
  return pushConfig(source).enabled && source.npm_lifecycle_event !== 'dev' &&
    (target.kind === 'disposable' || source.CUSTOMER_PUSH_APPROVED_TARGET === target.identity);
}
/** Bounded channel delivery on the existing notification journal. No network inside a DB transaction.
 * The SW re-authorizes the current session at receipt/click, closing logout-after-claim races. */
export class CustomerPushDispatcher {
  constructor(private readonly db: PrismaClient, private readonly transport: PushTransport) {}
  async runBatch() {
    // Prisma DateTime uses timestamp without time zone with UTC values. Do not
    // compare it with a session-local timestamp on non-UTC PostgreSQL servers.
    await this.db.$executeRaw`UPDATE customer_push_subscriptions s SET "revokedAt"=timezone('UTC',now())
      WHERE s."revokedAt" IS NULL AND NOT EXISTS(SELECT 1 FROM refresh_tokens r
        WHERE r."userId"=s."userId" AND r."familyId"=s."familyId" AND NOT r."isRevoked" AND r."expiresAt">timezone('UTC',now()))`;
    const claims = await this.db.$queryRaw<{ id: string }[]>`
      WITH due AS (SELECT id FROM customer_push_deliveries
        WHERE ((state IN ('QUEUED','RETRY') AND "availableAt" <= timezone('UTC',now())) OR (state='LEASED' AND "leaseUntil" < timezone('UTC',now())))
        AND attempts < 5 ORDER BY "availableAt", id LIMIT 10 FOR UPDATE SKIP LOCKED)
      UPDATE customer_push_deliveries d SET state='LEASED', attempts=attempts+1, "lastCode"=NULL, "leaseUntil"=timezone('UTC',now())+interval '60 seconds'
      FROM due WHERE d.id=due.id RETURNING d.id`;
    for (const claim of claims) await this.process(claim.id);
    // Exhausted crashed claims must not remain leased forever.
    await this.db.customerPushDelivery.updateMany({ where: { state: 'LEASED', attempts: { gte: 5 }, leaseUntil: { lt: new Date() } }, data: { state: 'FAILED', lastCode: 'RETRY_EXHAUSTED', leaseUntil: null } });
    return { claimed: claims.length };
  }
  async process(id: string) {
    const row = await this.db.customerPushDelivery.findUnique({ where: { id }, include: { subscription: { include: { user: true } }, notification: { include: { order: true } } } });
    if (!row || row.lastCode?.startsWith('SEND_') || row.state !== 'LEASED' || !row.leaseUntil || row.leaseUntil <= new Date()) return;
    // Conditional per-attempt latch prevents duplicated process() calls from both reaching the transport.
    const latch = `SEND_${randomUUID().slice(0, 8)}`;
    const claimed = await this.db.customerPushDelivery.updateMany({ where: { id, state: 'LEASED', attempts: row.attempts, lastCode: row.lastCode }, data: { lastCode: latch } });
    if (!claimed.count || row.lastCode?.startsWith('SEND_')) return;
    const subscription = row.subscription;
    const session = await this.db.refreshToken.findFirst({ where: { userId: subscription.userId, familyId: subscription.familyId, isRevoked: false, expiresAt: { gt: new Date() } }, select: { id: true } });
    const valid = subscriptionSchema.safeParse({ endpoint: subscription.endpoint, keys: { p256dh: subscription.p256dh, auth: subscription.auth } });
    const current = await this.db.customerPushSubscription.findUnique({ where: { id: subscription.id }, select: { revokedAt: true } });
    if (!session || !current || current.revokedAt || !subscription.user.isActive || row.notification.userId !== subscription.userId || row.notification.order.userId !== subscription.userId || !valid.success || subscription.vapidKey !== pushConfig().publicKey) {
      await this.finish(id, row.attempts, latch, 'REVOKED', 'CONSENT_OR_SESSION_ENDED'); return;
    }
    // Do not send stale delivery notices long after fulfillment has progressed.
    if (row.notification.order.status !== 'OUT_FOR_DELIVERY' || Date.now() - row.notification.occurredAt.getTime() > 24 * 3600_000) {
      await this.finish(id, row.attempts, latch, 'EXPIRED', 'EVENT_STALE'); return;
    }
    let status = 0;
    try {
      const result = await this.transport.send(valid.data, JSON.stringify({ v: 1, bindingId: subscription.id, eventId: row.notificationId }));
      status = result.statusCode;
    } catch (error) { if (error && typeof error === 'object' && 'statusCode' in error && typeof error.statusCode === 'number') status = error.statusCode; }
    if (status >= 200 && status < 300) { await this.finish(id, row.attempts, latch, 'ACCEPTED', `HTTP_${status}`); return; }
    if (status === 404 || status === 410) {
      await this.db.customerPushSubscription.updateMany({ where: { id: subscription.id }, data: { revokedAt: new Date() } });
      await this.finish(id, row.attempts, latch, 'EXPIRED', `HTTP_${status}`); return;
    }
    const retry = (!status || status === 429 || status >= 500) && row.attempts < 5;
    await this.finish(id, row.attempts, latch, retry ? 'RETRY' : 'FAILED', status ? `HTTP_${status}` : 'TRANSPORT_UNCERTAIN');
  }
  private async finish(id: string, attempt: number, latch: string, state: string, code: string) {
    await this.db.customerPushDelivery.updateMany({ where: { id, attempts: attempt, state: 'LEASED', lastCode: latch }, data: {
      state, lastCode: code, leaseUntil: null, ...(state === 'ACCEPTED' ? { acceptedAt: new Date() } : {}),
      ...(state === 'RETRY' ? { availableAt: new Date(Date.now() + Math.min(3600_000, 30000 * 2 ** attempt)) } : {}),
    } });
    logSafely(state === 'FAILED' ? 'warn' : 'info', 'Customer push attempt completed', { event: 'customer_push_attempt', deliveryId: id, attempt, state, code });
  }
}
