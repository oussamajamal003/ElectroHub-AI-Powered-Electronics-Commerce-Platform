import type { PrismaClient } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { orderReference } from './commerce-email.domain.js';

export class CustomerNotificationService {
  constructor(private readonly db: PrismaClient = prisma) {}

  async list(userId: string, before?: { at: Date; id: string }) {
    // A single database snapshot keeps list and badge consistent across concurrent reads/updates.
    const [rows, unreadCount] = await this.db.$transaction([
      this.db.customerNotification.findMany({ where: { userId, ...(before ? { OR: [{ occurredAt: { lt: before.at } }, { occurredAt: before.at, id: { lt: before.id } }] } : {}) },
        orderBy: [{ occurredAt: 'desc' }, { id: 'desc' }], take: 50 }),
      this.db.customerNotification.count({ where: { userId, readAt: null } }),
    ], { isolationLevel: 'RepeatableRead' });
    return { items: rows.map(row => ({ id: row.id, type: row.type, orderReference: orderReference(row.orderId),
      occurredAt: row.occurredAt.toISOString(), readAt: row.readAt?.toISOString() ?? null })), unreadCount,
      nextBefore: rows.length === 50 ? `${rows[49]!.occurredAt.toISOString()}|${rows[49]!.id}` : null };
  }

  async markRead(userId: string, id: string) {
    const result = await this.db.customerNotification.updateMany({ where: { id, userId, readAt: null }, data: { readAt: new Date() } });
    if (!result.count && !await this.db.customerNotification.findFirst({ where: { id, userId }, select: { id: true } })) {
      throw new AppError('Notification not found.', 404, 'NOTIFICATION_NOT_FOUND');
    }
  }
}
