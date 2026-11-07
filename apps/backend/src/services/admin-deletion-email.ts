import { EmailDeliveryStatus, EmailType, type Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { brevoProvider, type BrevoProvider } from '../integrations/brevo/brevo.provider.js';
import { logger } from '../utils/logger.js';

/**
 * Task 05.2 administrator account-deletion confirmation.
 *
 * Durability and idempotency without a new table: the `email_deliveries` ledger row (type SECURITY_ALERT, recipient = the ORIGINAL
 * verified address, userId = the deleted account) is created INSIDE the deletion transaction, so it exists if and only if the deletion
 * committed — a rolled-back deletion leaves no row and no email, and a repeated or concurrent deletion request cannot create a second row
 * because the account is already inactive. After commit the row is claimed and sent; a failure leaves it FAILED and `retryDeletionNotices`
 * (run on a timer by the server) re-sends it under the same claim rule, so each deletion yields at most one delivered email. The message is
 * rebuilt from the row alone (recipient + creation time): it never carries a password, factor, code, token or account detail.
 */
const STALE_CLAIM_MS = 5 * 60 * 1000;
const MAX_RETRIES_PER_SWEEP = 25;
const DELETED_EMAIL_PREFIX = 'deleted-admin-';

const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] as string);

export const SUBJECT = 'Your ElectroHub administrator account was deleted';

export function buildDeletionEmail(deletedAt: Date) {
  const when = `${deletedAt.toUTCString()}`;
  const html = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(SUBJECT)}</title></head>
<body style="margin:0;padding:24px 12px;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Poppins,sans-serif;color:#0f172a">
<div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;padding:32px 24px">
<div style="font-size:22px;font-weight:700;color:#2563eb;text-align:center;margin-bottom:24px">ElectroHub</div>
<h1 style="font-size:20px;line-height:1.3;font-weight:600;margin:0 0 12px;text-align:center">Administrator account deleted</h1>
<p style="font-size:14px;line-height:1.6;color:#475569;margin:0 0 16px">This confirms that your ElectroHub administrator account was deleted.</p>
<table role="presentation" style="width:100%;border-collapse:collapse;margin:0 0 16px"><tr>
<td style="font-size:13px;color:#64748b;padding:8px 0;border-top:1px solid #f1f5f9;border-bottom:1px solid #f1f5f9">Deleted on</td>
<td style="font-size:13px;color:#0f172a;padding:8px 0;border-top:1px solid #f1f5f9;border-bottom:1px solid #f1f5f9;text-align:right">${escapeHtml(when)}</td></tr></table>
<p style="font-size:14px;line-height:1.6;color:#475569;margin:0 0 12px">Your administrator access has been removed and every active session was signed out.</p>
<p style="font-size:14px;line-height:1.6;color:#475569;margin:0 0 12px">Some business and security audit records, such as order history and security logs, may be retained as required for accountability.</p>
<p style="font-size:14px;line-height:1.6;color:#475569;margin:0 0 4px"><strong style="color:#0f172a">Was this unexpected?</strong> Contact ElectroHub support right away so we can investigate.</p>
<div style="font-size:12px;color:#94a3b8;text-align:center;margin-top:28px;border-top:1px solid #f1f5f9;padding-top:16px">&copy; ElectroHub. This is an automated security notice.</div>
</div></body></html>`;
  const text = `ElectroHub — Administrator account deleted

This confirms that your ElectroHub administrator account was deleted.

Deleted on: ${when}

Your administrator access has been removed and every active session was signed out.
Some business and security audit records, such as order history and security logs, may be retained as required for accountability.

Was this unexpected? Contact ElectroHub support right away so we can investigate.

This is an automated security notice.`;
  return { subject: SUBJECT, html, text };
}

/**
 * Called inside the deletion transaction BEFORE the account is anonymized, with the original address. Returns the ledger row id to
 * dispatch after commit, or null when there is no deliverable verified address.
 */
export async function queueDeletionNotice(tx: Prisma.TransactionClient, userId: string): Promise<string | null> {
  const account = await tx.user.findUnique({ where: { id: userId }, select: { email: true, emailVerifiedAt: true } });
  const recipient = account?.email.toLowerCase().trim();
  if (!recipient || !account?.emailVerifiedAt || recipient.startsWith(DELETED_EMAIL_PREFIX)) return null;
  const row = await tx.emailDelivery.create({ data: { type: EmailType.SECURITY_ALERT, recipient, userId, status: EmailDeliveryStatus.QUEUED, provider: 'BREVO' } });
  return row.id;
}

async function deliver(id: string, provider: BrevoProvider): Promise<boolean> {
  const row = await prisma.emailDelivery.findUnique({ where: { id }, select: { recipient: true, createdAt: true, status: true } });
  if (!row || row.status === EmailDeliveryStatus.SENT) return false;
  const content = buildDeletionEmail(row.createdAt);
  try {
    const result = await provider.sendTransactionalEmail({ to: row.recipient, subject: content.subject, htmlContent: content.html, textContent: content.text, tags: [EmailType.SECURITY_ALERT] });
    if (result.success && result.messageId) {
      await prisma.emailDelivery.update({ where: { id }, data: { status: EmailDeliveryStatus.SENT, providerMessageId: result.messageId, sentAt: new Date(), failureReason: null } });
      return true;
    }
  } catch {
    // fall through to the failure record
  }
  await prisma.emailDelivery.update({ where: { id }, data: { status: EmailDeliveryStatus.FAILED, failureReason: 'Email provider delivery failed', failedAt: new Date() } }).catch(() => undefined);
  logger.error('ADMIN_DELETION_NOTICE_DELIVERY_FAILED', { deliveryId: id });
  return false;
}

/** Exactly one caller wins the claim for a row: a QUEUED row only on first dispatch, a FAILED or stale-QUEUED row on retry. */
async function claim(id: string, fromStatus: EmailDeliveryStatus, olderThan?: Date): Promise<boolean> {
  const claimed = await prisma.emailDelivery.updateMany({
    where: { id, status: fromStatus, ...(olderThan ? { updatedAt: { lt: olderThan } } : {}) },
    data: { status: EmailDeliveryStatus.QUEUED, updatedAt: new Date() },
  });
  return claimed.count === 1;
}

/** After commit; never throws and never changes the committed deletion. */
export async function dispatchDeletionNotice(id: string | null, provider: BrevoProvider = brevoProvider): Promise<boolean> {
  if (!id) return false;
  try {
    // First dispatch owns the freshly queued row (created moments ago); retries use the stale/failed claims below.
    return await deliver(id, provider);
  } catch (error) {
    logger.error('ADMIN_DELETION_NOTICE_FAILED', { deliveryId: id, errorName: error instanceof Error ? error.name : 'unknown' });
    return false;
  }
}

/** Re-sends failed or abandoned deletion notices (only rows of deleted administrators). Safe to run concurrently on several instances. */
export async function retryDeletionNotices(provider: BrevoProvider = brevoProvider, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - STALE_CLAIM_MS);
  const rows = await prisma.emailDelivery.findMany({
    where: { type: EmailType.SECURITY_ALERT, user: { email: { startsWith: DELETED_EMAIL_PREFIX } },
      OR: [{ status: EmailDeliveryStatus.FAILED }, { status: EmailDeliveryStatus.QUEUED, updatedAt: { lt: cutoff } }] },
    orderBy: { createdAt: 'asc' }, take: MAX_RETRIES_PER_SWEEP, select: { id: true, status: true },
  });
  let sent = 0;
  for (const row of rows) {
    const won = row.status === EmailDeliveryStatus.FAILED ? await claim(row.id, EmailDeliveryStatus.FAILED) : await claim(row.id, EmailDeliveryStatus.QUEUED, cutoff);
    if (won && await deliver(row.id, provider)) sent += 1;
  }
  return sent;
}

export function startDeletionNoticeRetry(intervalMs = 5 * 60 * 1000): () => void {
  const timer = setInterval(() => { void retryDeletionNotices().catch(() => undefined); }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
