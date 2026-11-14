import { createHash } from 'node:crypto';
import type { PrismaClient, Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { pushConfig, subscriptionSchema } from './customer-push.config.js';
import { lockUserTokenLifecycle } from '../repositories/auth.repository.js';

export async function pushSession(db: PrismaClient | Prisma.TransactionClient, raw: unknown, userId?: string) {
  if (typeof raw !== 'string' || !raw.startsWith('customer.') || raw.length > 2048) throw new AppError('Sign in again to manage notifications.', 401, 'PUSH_SESSION_REQUIRED');
  const token = await db.refreshToken.findFirst({ where: { tokenHash: createHash('sha256').update(raw).digest('hex'),
    isRevoked: false, expiresAt: { gt: new Date() }, ...(userId ? { userId } : {}), user: { isActive: true, role: { name: 'CUSTOMER' } } },
    select: { userId: true, familyId: true } });
  if (!token) throw new AppError('Sign in again to manage notifications.', 401, 'PUSH_SESSION_REQUIRED');
  return token;
}
export class CustomerPushService {
  constructor(private readonly db: PrismaClient = prisma) {}
  async register(userId: string, raw: unknown, input: unknown) {
    const parsed = subscriptionSchema.safeParse(input);
    if (!parsed.success) throw new AppError('Invalid push subscription.', 400, 'PUSH_SUBSCRIPTION_INVALID');
    const config = pushConfig();
    if (!config.enabled) throw new AppError('Delivery notifications are not configured.', 503, 'PUSH_UNAVAILABLE');
    return this.db.$transaction(async tx => {
      await lockUserTokenLifecycle(tx, userId);
      const session = await pushSession(tx, raw, userId);
      const existing = await tx.customerPushSubscription.findUnique({ where: { endpoint: parsed.data.endpoint } });
      // Never transfer an installation between identities, even with a copied endpoint. Unsubscribe and obtain a fresh endpoint.
      if (existing && (existing.userId !== userId || existing.familyId !== session.familyId || existing.revokedAt)) {
        throw new AppError('Reset browser notifications and enable them again.', 409, 'PUSH_RESET_REQUIRED');
      }
      if (existing) return { id: existing.id };
      if (await tx.customerPushSubscription.count({ where: { userId, revokedAt: null } }) >= 10) throw new AppError('Too many notification devices.', 409, 'PUSH_DEVICE_LIMIT');
      const row = await tx.customerPushSubscription.create({ data: { userId, familyId: session.familyId,
        endpoint: parsed.data.endpoint, p256dh: parsed.data.keys.p256dh, auth: parsed.data.keys.auth, vapidKey: config.publicKey } });
      return { id: row.id };
    });
  }
  async current(userId: string, raw: unknown, id?: string) {
    const session = await pushSession(this.db, raw, userId);
    return { enabled: Boolean(id && await this.db.customerPushSubscription.findFirst({ where: { id, userId, familyId: session.familyId, revokedAt: null, vapidKey: pushConfig().publicKey } })) };
  }
  async revoke(userId: string, raw: unknown, id: string) {
    return this.db.$transaction(async tx => {
      await lockUserTokenLifecycle(tx, userId);
      const session = await pushSession(tx, raw, userId);
      const row = await tx.customerPushSubscription.findFirst({ where: { id, userId, familyId: session.familyId } });
      if (!row) throw new AppError('Notification device not found.', 404, 'PUSH_NOT_FOUND');
      await tx.customerPushSubscription.update({ where: { id }, data: { revokedAt: new Date() } });
    });
  }
  /** The background SW must prove the current cookie session before showing or opening a notification.
   * This closes the already-in-flight provider message race after logout/account switching. Offline receipts fail closed. */
  async receipt(raw: unknown, bindingId: string, eventId: string) {
    if (!pushConfig().enabled) throw new AppError('Notifications unavailable.', 503, 'PUSH_UNAVAILABLE');
    const session = await pushSession(this.db, raw);
    const row = await this.db.customerPushDelivery.findFirst({ where: { notificationId: eventId, subscriptionId: bindingId,
      subscription: { userId: session.userId, familyId: session.familyId, revokedAt: null },
      notification: { userId: session.userId, order: { userId: session.userId } } }, include: { notification: true } });
    if (!row) throw new AppError('Notification unavailable.', 404, 'PUSH_NOT_FOUND');
    return { url: `/orders/ORD-${row.notification.orderId.toUpperCase()}` };
  }
}
