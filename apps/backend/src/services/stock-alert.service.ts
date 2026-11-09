import { EmailDeliveryStatus, EmailType, InventoryStatus, Prisma, type PrismaClient } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { brevoProvider, type BrevoProvider } from '../integrations/brevo/brevo.provider.js';
import { logSafely } from '../utils/logger.js';
import { AdminInventoryPublisher } from '../sockets/admin-inventory.publisher.js';

type Db = PrismaClient | Prisma.TransactionClient;
const MAX_ATTEMPTS = 3;
const RETRY_MS = [60_000, 5 * 60_000, 30 * 60_000] as const;

type Transition = { productId: string; previousStatus: InventoryStatus | null; status: InventoryStatus; quantity: number; lowStockAt: number };

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);
const statusLabel = (status: InventoryStatus) => status === 'OUT_OF_STOCK' ? 'OUT OF STOCK' : 'LOW STOCK';
const alertUrl = (status: InventoryStatus) => `${process.env.FRONTEND_URL || 'http://localhost:3000'}/admin/inventory?status=${status}`;

function emailFor(event: { productName: string; sku: string; status: InventoryStatus; quantity: number; lowStockAt: number }) {
  const label = statusLabel(event.status);
  const action = event.status === 'OUT_OF_STOCK' ? 'Restock this product.' : 'Review and replenish inventory.';
  const subject = event.status === 'OUT_OF_STOCK' ? `Out of stock alert — ${event.productName}` : `Low stock alert — ${event.productName}`;
  const text = `Product: ${event.productName}\nSKU: ${event.sku}\nCurrent quantity: ${event.quantity}\n${event.status === 'LOW_STOCK' ? `Low-stock threshold: ${event.lowStockAt}\n` : ''}Status: ${label}\nAction: ${action}\n\n${alertUrl(event.status)}`;
  const html = `<!DOCTYPE html><html><body style="font-family:Arial,sans-serif;color:#0f172a"><h1 style="color:#2563eb">ElectroHub Admin</h1><h2>${label}</h2><p><strong>Product:</strong> ${escapeHtml(event.productName)}<br><strong>SKU:</strong> ${escapeHtml(event.sku)}<br><strong>Current quantity:</strong> ${event.quantity}${event.status === 'LOW_STOCK' ? `<br><strong>Low-stock threshold:</strong> ${event.lowStockAt}` : ''}<br><strong>Status:</strong> ${label}</p><p>${action}</p><p><a href="${escapeHtml(alertUrl(event.status))}">Review inventory</a></p></body></html>`;
  return { subject, text, html };
}

/**
 * Stock-transition outbox. Transition records are created inside the inventory transaction; all external effects happen only after
 * commit. A unique `(stockAlertEventId, userId)` delivery row makes replays, process restarts and concurrent workers idempotent.
 */
export class StockAlertService {
  constructor(private readonly db: PrismaClient = prisma,
    private readonly provider: Pick<BrevoProvider, 'sendTransactionalEmail'> = brevoProvider) {}

  async record(tx: Db, transition: Transition): Promise<string | null> {
    if (transition.previousStatus === transition.status) return null;
    const product = await tx.product.findUnique({ where: { id: transition.productId }, select: { name: true, sku: true, isTestFixture: true } });
    // Fixture/seeding writes are intentionally silent; a real product's initial record is handled by its operational create path.
    if (!product || product.isTestFixture) return null;
    const event = await tx.stockAlertEvent.create({ data: { ...transition, productName: product.name, sku: product.sku } });
    return event.id;
  }

  afterCommit(eventId: string | null | undefined): void {
    if (!eventId) return;
    AdminInventoryPublisher.afterCommit(eventId);
    void this.processEvent(eventId).catch(error => logSafely('error', 'Stock alert dispatch failed', {
      event: 'admin.stock_alert.dispatch_failed', eventId, errorName: error instanceof Error ? error.name : 'Unknown',
    }));
  }

  /** Startup/retry runner. It recovers work created just before a process crash and never changes inventory state. */
  async recover(limit = 50): Promise<number> {
    const now = new Date();
    await this.db.emailDelivery.updateMany({ where: { stockAlertEventId: { not: null }, status: EmailDeliveryStatus.SENDING, nextAttemptAt: { lte: now } },
      data: { status: EmailDeliveryStatus.QUEUED } });
    const pending = await this.db.stockAlertEvent.findMany({ where: { processedAt: null }, orderBy: { createdAt: 'asc' }, take: limit, select: { id: true } });
    for (const event of pending) await this.processEvent(event.id);
    const retryable = await this.db.emailDelivery.findMany({ where: { stockAlertEventId: { not: null }, status: { in: [EmailDeliveryStatus.QUEUED, EmailDeliveryStatus.FAILED] },
      attempts: { lt: MAX_ATTEMPTS }, OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }] }, orderBy: { createdAt: 'asc' }, take: limit,
      select: { stockAlertEventId: true } });
    for (const eventId of new Set(retryable.map(row => row.stockAlertEventId).filter((id): id is string => Boolean(id)))) await this.processEvent(eventId);
    return pending.length;
  }

  private async recipients() {
    return this.db.user.findMany({ where: { isActive: true, emailVerifiedAt: { not: null }, role: { name: 'ADMIN' },
      OR: [{ adminNotificationPreference: { is: null } }, { adminNotificationPreference: { is: { lowStock: true } } }] }, select: { id: true, email: true } });
  }

  private async processEvent(eventId: string): Promise<void> {
    const event = await this.db.stockAlertEvent.findUnique({ where: { id: eventId } });
    if (!event) return;
    // Restocks still emit the UI invalidation but have no warning emails.
    const warning = event.status === InventoryStatus.LOW_STOCK || event.status === InventoryStatus.OUT_OF_STOCK;
    if (!event.processedAt) {
      const recipients = warning ? await this.recipients() : [];
      await this.db.$transaction(async tx => {
        if (recipients.length) await tx.emailDelivery.createMany({ data: recipients.map(recipient => ({ userId: recipient.id, recipient: recipient.email,
          type: EmailType.ADMIN_NOTIFICATION, provider: 'BREVO', status: EmailDeliveryStatus.QUEUED, stockAlertEventId: event.id, nextAttemptAt: new Date() })), skipDuplicates: true });
        await tx.stockAlertEvent.updateMany({ where: { id: event.id, processedAt: null }, data: { processedAt: new Date() } });
      });
    }
    await this.deliver(event.id);
  }

  private async deliver(eventId: string): Promise<void> {
    const deliveries = await this.db.emailDelivery.findMany({ where: { stockAlertEventId: eventId, status: { in: [EmailDeliveryStatus.QUEUED, EmailDeliveryStatus.FAILED] },
      attempts: { lt: MAX_ATTEMPTS }, OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: new Date() } }] }, include: { stockAlertEvent: true, user: { select: { isActive: true, emailVerifiedAt: true,
        role: { select: { name: true } }, adminNotificationPreference: { select: { lowStock: true } } } } } });
    for (const delivery of deliveries) {
      const claimed = await this.db.emailDelivery.updateMany({ where: { id: delivery.id, status: delivery.status }, data: { status: EmailDeliveryStatus.SENDING,
        attempts: { increment: 1 }, nextAttemptAt: new Date(Date.now() + RETRY_MS[Math.min(delivery.attempts, RETRY_MS.length - 1)]) } });
      if (claimed.count !== 1) continue;
      const eligible = delivery.user?.isActive && delivery.user.emailVerifiedAt && delivery.user.role.name === 'ADMIN' && delivery.user.adminNotificationPreference?.lowStock !== false;
      if (!eligible || !delivery.stockAlertEvent) {
        await this.db.emailDelivery.update({ where: { id: delivery.id }, data: { status: EmailDeliveryStatus.BLOCKED, failureReason: 'Recipient is no longer eligible', nextAttemptAt: null } });
        continue;
      }
      const content = emailFor(delivery.stockAlertEvent);
      try {
        const result = await this.provider.sendTransactionalEmail({ to: delivery.recipient, subject: content.subject, htmlContent: content.html,
          textContent: content.text, tags: [EmailType.ADMIN_NOTIFICATION, 'STOCK_ALERT'] });
        if (result.success && result.messageId) {
          await this.db.emailDelivery.update({ where: { id: delivery.id }, data: { status: EmailDeliveryStatus.SENT, providerMessageId: result.messageId, sentAt: new Date(), nextAttemptAt: null } });
        } else await this.fail(delivery.id, delivery.attempts + 1);
      } catch { await this.fail(delivery.id, delivery.attempts + 1); }
    }
  }

  private async fail(id: string, attempts: number) {
    await this.db.emailDelivery.update({ where: { id }, data: { status: attempts >= MAX_ATTEMPTS ? EmailDeliveryStatus.FAILED : EmailDeliveryStatus.FAILED,
      failureReason: 'Email provider delivery failed', failedAt: new Date(), nextAttemptAt: attempts >= MAX_ATTEMPTS ? null : new Date(Date.now() + RETRY_MS[Math.min(attempts, RETRY_MS.length - 1)]) } });
  }
}

export const stockAlerts = new StockAlertService();
