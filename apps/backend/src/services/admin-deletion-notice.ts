import type { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { recordAdminAudit } from './admin-audit.js';

/**
 * Deleted administrators are anonymized, not removed (orders, inventory and audit rows keep their foreign keys). The anonymization writes
 * `deleted-admin-<id>@deleted.invalid` (see anonymizeAdministrator); that address cannot be registered or invited (`.invalid`), so it is a
 * reliable marker that never matches an ordinary deactivated administrator.
 */
export const notDeletedAdmin: Prisma.UserWhereInput = { NOT: { email: { startsWith: 'deleted-admin-', endsWith: '@deleted.invalid' } } };

const DELETED_ACTION = 'ADMIN_ACCOUNT_DELETED';
const ACK_ACTION = 'ADMIN_DELETION_NOTICE_ACKNOWLEDGED';

/**
 * One-time, per-Owner notice that administrators were deleted. No new table: the committed deletion audit rows are the events (a rolled-back
 * deletion wrote none) and an Owner's acknowledgement is an audit row of their own holding a watermark, so it persists across refreshes and
 * devices and is independent for every Owner. Nothing about a deleted person (email, name) is exposed: only how many deletions are new.
 */
export const adminDeletionNoticeService = {
  async current(ownerId: string, db: Prisma.TransactionClient | typeof prisma = prisma) {
    const [ack, security] = await Promise.all([
      db.adminAuditLog.findFirst({ where: { actorId: ownerId, action: ACK_ACTION, outcome: 'SUCCESS' }, orderBy: { createdAt: 'desc' }, select: { details: true } }),
      db.adminAccountSecurity.findUnique({ where: { userId: ownerId }, select: { createdAt: true } }),
    ]);
    const through = typeof (ack?.details as { through?: unknown } | null)?.through === 'string' ? new Date((ack!.details as { through: string }).through) : null;
    const since = through && !Number.isNaN(through.getTime()) ? through : security?.createdAt ?? new Date(0);
    const where = { action: DELETED_ACTION, outcome: 'SUCCESS', createdAt: { gt: since }, NOT: { resourceId: ownerId } };
    const [count, latest] = await Promise.all([
      db.adminAuditLog.count({ where }),
      db.adminAuditLog.findFirst({ where, orderBy: { createdAt: 'desc' }, select: { createdAt: true } }),
    ]);
    return { count, through: latest ? new Date(latest.createdAt.getTime() + 1).toISOString() : null, since };
  },

  async pending(ownerId: string) {
    const { count, through } = await this.current(ownerId);
    return { count, through };
  },

  /** Acknowledges everything up to `through` (what the banner showed): later deletions stay unacknowledged. Never moves the watermark back. */
  async acknowledge(ownerId: string, through: Date, requestId?: string) {
    if (Number.isNaN(through.getTime()) || through.getTime() > Date.now() + 60_000) throw new AppError('Invalid acknowledgement.', 400, 'VALIDATION_FAILED');
    await prisma.$transaction(async tx => {
      const { since } = await this.current(ownerId, tx);
      if (through.getTime() <= since.getTime()) return;
      await recordAdminAudit({ actorId: ownerId, action: ACK_ACTION, resourceType: 'admin_user', resourceId: ownerId, outcome: 'SUCCESS',
        details: { through: through.toISOString() }, requestId }, tx);
    });
  },
};
