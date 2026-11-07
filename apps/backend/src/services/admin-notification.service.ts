import { EmailDeliveryStatus, EmailType, Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { brevoProvider, type BrevoProvider } from '../integrations/brevo/brevo.provider.js';
import { AppError } from '../middleware/errorHandler.js';
import { recordAdminAudit } from './admin-audit.js';
import { orderReference } from './commerce-email.domain.js';
import { parseOrThrow } from './store-settings.service.js';
import { logSafely } from '../utils/logger.js';

/**
 * Task 05.2 operational administrator email. Only two events exist: an order whose payment was authoritatively confirmed, and an
 * inventory adjustment that moved a product into LOW_STOCK or OUT_OF_STOCK. Recipients are ACTIVE, email-verified ADMIN users whose
 * preference for that event is on (no row = the schema default, on). Security alerts are not represented here and are never disabled.
 *
 * Delivery is fire-and-forget after the business transaction has committed: a failure is recorded on the EmailDelivery row (QUEUED
 * becomes SENT or FAILED) and logged without addresses, customer data or the payment outcome changing. Content carries the order
 * reference and total, or the product name and stock only.
 */
const TX = { maxWait: 10_000, timeout: 20_000 };
const PREFERENCE_KEYS = ['orderPaid', 'lowStock', 'invitationAccepted'] as const;
export type AdminPreferenceKey = (typeof PREFERENCE_KEYS)[number];
type NotificationKind = 'ORDER_PAID' | 'LOW_STOCK' | 'INVITATION_ACCEPTED';

const preferenceSelect = { orderPaid: true, lowStock: true, invitationAccepted: true, version: true } as const;
const DEFAULT_PREFERENCES = { orderPaid: true, lowStock: true, invitationAccepted: true, version: 0 } as const;

export const preferencesUpdateSchema = z.object({
  expectedVersion: z.number().int().min(0, 'Reload your preferences and try again.'),
  orderPaid: z.boolean(),
  lowStock: z.boolean(),
  invitationAccepted: z.boolean(),
}).strict();

export interface AdminPreferences { orderPaid: boolean; lowStock: boolean; invitationAccepted: boolean; version: number }

interface OperationalEmail { subject: string; text: string; html: string }
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const footer = 'You receive this because this alert is on in Settings > Notifications. Manage it in the Admin Console.';
const wrapHtml = (heading: string, body: string) => `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${escapeHtml(heading)}</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f8fafc;margin:0;padding:24px;color:#0f172a">
<div style="max-width:480px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;padding:32px">
<div style="font-size:22px;font-weight:700;color:#2563eb;text-align:center;margin-bottom:24px">ElectroHub Admin</div>
<h1 style="font-size:18px;font-weight:600;margin:0 0 12px">${escapeHtml(heading)}</h1>
<p style="font-size:14px;line-height:1.6;color:#475569">${body}</p>
<p style="font-size:12px;color:#94a3b8;margin-top:24px">${escapeHtml(footer)}</p></div></body></html>`;

const orderPaidEmail = (reference: string, total: string, currency: string): OperationalEmail => ({
  subject: `Payment confirmed: order ${reference}`,
  text: `Payment was confirmed for order ${reference} (total ${currency} ${total}).\n\n${footer}`,
  html: wrapHtml(`Payment confirmed: order ${reference}`, `Payment was confirmed for order <strong>${escapeHtml(reference)}</strong> (total ${escapeHtml(currency)} ${escapeHtml(total)}).`),
});

const lowStockEmail = (productName: string, status: 'LOW_STOCK' | 'OUT_OF_STOCK', quantity: number): OperationalEmail => {
  const label = status === 'OUT_OF_STOCK' ? 'out of stock' : 'low on stock';
  return {
    subject: `Stock alert: ${productName} is ${label}`,
    text: `${productName} is ${label} (${quantity} left).\n\n${footer}`,
    html: wrapHtml(`Stock alert: ${productName}`, `${escapeHtml(productName)} is ${label} (${quantity} left).`),
  };
};

const invitationAcceptedEmail = (): OperationalEmail => ({
  subject: 'Your administrator invitation was accepted',
  text: `An administrator you invited accepted the invitation. They must finish two-step verification before they can sign in.

${footer}`,
  html: wrapHtml('Invitation accepted', 'An administrator you invited accepted the invitation. They must finish two-step verification before they can sign in.'),
});

const conflict = (message: string, current: unknown) => Object.assign(new AppError(message, 409, 'VERSION_CONFLICT'), { current });
const projectPreferences = (row: { orderPaid: boolean; lowStock: boolean; invitationAccepted: boolean; version: number }): AdminPreferences =>
  ({ orderPaid: row.orderPaid, lowStock: row.lowStock, invitationAccepted: row.invitationAccepted, version: row.version });

export class AdminNotificationService {
  constructor(private readonly db: PrismaClient = prisma,
    private readonly provider: Pick<BrevoProvider, 'sendTransactionalEmail'> = brevoProvider) {}

  // ─── Per-administrator preferences (self only; the route passes the authenticated user id) ───

  async getPreferences(userId: string): Promise<AdminPreferences> {
    const row = await this.db.adminNotificationPreference.findUnique({ where: { userId }, select: preferenceSelect });
    return projectPreferences(row ?? DEFAULT_PREFERENCES);
  }

  async updatePreferences(userId: string, input: unknown, requestId?: string | null): Promise<AdminPreferences> {
    const { expectedVersion, ...next } = parseOrThrow(preferencesUpdateSchema, input);
    try {
      return await this.db.$transaction(async tx => {
        const current = await tx.adminNotificationPreference.findUnique({ where: { userId }, select: preferenceSelect });
        const currentVersion = current?.version ?? 0;
        if (currentVersion !== expectedVersion) {
          throw conflict('Your notification preferences changed elsewhere. Reload to review the latest values.', projectPreferences(current ?? DEFAULT_PREFERENCES));
        }
        let version: number;
        if (!current) {
          await tx.adminNotificationPreference.create({ data: { userId, ...next, version: 1 } });
          version = 1;
        } else {
          const result = await tx.adminNotificationPreference.updateMany({ where: { userId, version: expectedVersion },
            data: { ...next, version: { increment: 1 } } });
          if (result.count !== 1) throw conflict('Your notification preferences changed elsewhere. Reload to review the latest values.', await this.getPreferences(userId));
          version = expectedVersion + 1;
        }
        const changedFields = PREFERENCE_KEYS.filter(key => !current || current[key] !== next[key]);
        await recordAdminAudit({ actorId: userId, action: 'NOTIFICATION_PREFERENCES_UPDATED', resourceType: 'ADMIN_NOTIFICATION_PREFERENCE',
          resourceId: userId, outcome: 'SUCCESS', details: { version, changedFields }, requestId }, tx);
        return projectPreferences({ ...next, version });
      }, TX);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw conflict('Your notification preferences changed elsewhere. Reload to review the latest values.', await this.getPreferences(userId));
      }
      throw error;
    }
  }

  // ─── Operational events (fire-and-forget after commit; never throws to the caller) ───

  /** Call only after the payment transition that proves the payment has committed. */
  notifyOrderPaid(orderId: string): void {
    this.dispatchInBackground('ORDER_PAID', async () => {
      const order = await this.db.order.findUnique({ where: { id: orderId }, select: { total: true, currency: true } });
      if (!order) return null;
      return orderPaidEmail(orderReference(orderId), new Prisma.Decimal(order.total).toFixed(2), order.currency);
    });
  }

  /** Call after an inventory adjustment committed a transition INTO LOW_STOCK or OUT_OF_STOCK. */
  notifyLowStock(input: { productName: string; status: 'LOW_STOCK' | 'OUT_OF_STOCK'; quantity: number }): void {
    this.dispatchInBackground('LOW_STOCK', async () => lowStockEmail(input.productName, input.status, input.quantity));
  }

  /** Call after an invitation was accepted; only its inviter is notified (when their preference is on). No invitee identity is sent. */
  notifyInvitationAccepted(inviterId: string | null): void {
    if (!inviterId) return;
    this.dispatchInBackground('INVITATION_ACCEPTED', async () => invitationAcceptedEmail(), inviterId);
  }

  private dispatchInBackground(kind: NotificationKind, build: () => Promise<OperationalEmail | null>, onlyUserId?: string): void {
    void (async () => {
      try {
        const content = await build();
        if (content) await this.deliver(kind, content, onlyUserId);
      } catch (error) {
        logSafely('error', 'Admin operational notification failed.', { event: 'admin.notification.failed', kind,
          errorName: error instanceof Error ? error.name : 'unknown' });
      }
    })();
  }

  /** Active, verified administrators whose preference for this event is on (absent preference = default on). */
  async recipientsFor(kind: NotificationKind, onlyUserId?: string): Promise<{ id: string; email: string }[]> {
    const enabled = kind === 'ORDER_PAID' ? { orderPaid: true } : kind === 'LOW_STOCK' ? { lowStock: true } : { invitationAccepted: true };
    return this.db.user.findMany({
      where: { isActive: true, emailVerifiedAt: { not: null }, role: { name: 'ADMIN' }, ...(onlyUserId ? { id: onlyUserId } : {}),
        OR: [{ adminNotificationPreference: { is: null } }, { adminNotificationPreference: { is: enabled } }] },
      select: { id: true, email: true },
    });
  }

  private async deliver(kind: NotificationKind, content: OperationalEmail, onlyUserId?: string): Promise<void> {
    const recipients = await this.recipientsFor(kind, onlyUserId);
    let sent = 0; let failed = 0;
    for (const recipient of recipients) {
      const delivery = await this.db.emailDelivery.create({ data: { type: EmailType.ADMIN_NOTIFICATION, userId: recipient.id,
        recipient: recipient.email, status: EmailDeliveryStatus.QUEUED, provider: 'BREVO' } });
      let ok = false;
      try {
        const result = await this.provider.sendTransactionalEmail({ to: recipient.email, subject: content.subject, htmlContent: content.html,
          textContent: content.text, tags: [EmailType.ADMIN_NOTIFICATION] });
        if (result.success && result.messageId) {
          await this.db.emailDelivery.update({ where: { id: delivery.id }, data: { status: EmailDeliveryStatus.SENT,
            providerMessageId: result.messageId, sentAt: new Date() } });
          ok = true;
        } else {
          await this.db.emailDelivery.update({ where: { id: delivery.id }, data: { status: EmailDeliveryStatus.FAILED,
            failureReason: 'Email provider delivery failed', failedAt: new Date() } });
        }
      } catch {
        await this.db.emailDelivery.update({ where: { id: delivery.id }, data: { status: EmailDeliveryStatus.FAILED,
          failureReason: 'Email provider delivery failed', failedAt: new Date() } }).catch(() => undefined);
      }
      if (ok) sent += 1; else failed += 1;
    }
    // Counts and the event kind only: no addresses, names or order details in logs.
    logSafely(failed ? 'warn' : 'info', 'Admin operational notification delivered.', { event: 'admin.notification.delivery', kind,
      recipients: recipients.length, sent, failed });
  }
}

export const adminNotifications = new AdminNotificationService();
