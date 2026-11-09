import { EmailDeliveryStatus, EmailType, type Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { brevoProvider, type BrevoProvider } from '../integrations/brevo/brevo.provider.js';
import { logger } from '../utils/logger.js';

const STALE_CLAIM_MS = 5 * 60 * 1000;
const MAX_RETRIES_PER_SWEEP = 25;
const NOTICE_TYPES = [EmailType.ADMIN_EMAIL_CHANGE_OLD, EmailType.ADMIN_EMAIL_CHANGE_NEW] as const;
type NoticeType = typeof NOTICE_TYPES[number];

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] as string);
}

function emailLayout(subject: string, heading: string, body: string, createdAt: Date) {
  const when = escapeHtml(createdAt.toUTCString());
  const htmlContent = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:24px 12px;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Poppins,sans-serif;color:#0f172a"><div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:32px 24px">
<div style="font-size:22px;font-weight:700;color:#2563eb;text-align:center;margin-bottom:24px">ElectroHub</div><h1 style="font-size:20px;line-height:1.3;font-weight:600;margin:0 0 12px;text-align:center">${escapeHtml(heading)}</h1>
<p style="font-size:14px;line-height:1.6;color:#475569;margin:0 0 12px">${body}</p><p style="font-size:13px;line-height:1.6;color:#64748b;margin:0 0 16px">Confirmed on ${when}.</p>
<p style="font-size:14px;line-height:1.6;color:#475569;margin:0 0 4px">If you did not make this change, contact the appropriate ElectroHub security administrator or support channel immediately.</p>
<div style="font-size:12px;color:#94a3b8;text-align:center;margin-top:28px;border-top:1px solid #f1f5f9;padding-top:16px">This is an automated security notice.</div></div></body></html>`;
  return { subject, htmlContent, textContent: `ElectroHub — ${heading}\n\n${body.replace(/<[^>]*>/g, '')}\n\nConfirmed on ${createdAt.toUTCString()}.\n\nIf you did not make this change, contact the appropriate ElectroHub security administrator or support channel immediately.` };
}

function notificationContent(type: NoticeType, createdAt: Date) {
  if (type === EmailType.ADMIN_EMAIL_CHANGE_OLD) {
    return emailLayout('Your ElectroHub administrator email was changed', 'Administrator email changed',
      'Your ElectroHub administrator email address was changed. The previous address can no longer be used to sign in.', createdAt);
  }
  return emailLayout('Your new ElectroHub administrator email is confirmed', 'New administrator email confirmed',
    'Your new email address is now used for administrator sign-in. For your security, all existing sessions have ended. Sign in again with your existing password and two-step verification.', createdAt);
}

/** A separate delivery type and copy make it clear that mailbox possession is being verified, not yet changed. */
export async function sendAdminEmailChangeOtp(email: string, code: string, userId: string, provider: BrevoProvider = brevoProvider): Promise<boolean> {
  const recipient = email.toLowerCase().trim();
  const delivery = await prisma.emailDelivery.create({ data: { type: EmailType.ADMIN_EMAIL_CHANGE_OTP, recipient, userId,
    status: EmailDeliveryStatus.QUEUED, provider: 'BREVO' }, select: { id: true } });
  const subject = 'Verify your new ElectroHub administrator email';
  const htmlContent = `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escapeHtml(subject)}</title></head>
<body style="margin:0;padding:24px 12px;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Poppins,sans-serif;color:#0f172a"><div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;border-radius:12px;padding:32px 24px">
<div style="font-size:22px;font-weight:700;color:#2563eb;text-align:center;margin-bottom:24px">ElectroHub</div><h1 style="font-size:20px;line-height:1.3;font-weight:600;margin:0 0 12px;text-align:center">Verify your new administrator email</h1>
<p style="font-size:14px;line-height:1.6;color:#475569;margin:0 0 16px">Enter this six-digit code to confirm that you can receive email at the new address. Your sign-in email will not change until verification succeeds.</p>
<div style="background:#f1f5f9;border:1px dashed #cbd5e1;border-radius:8px;padding:18px;text-align:center;margin:24px 0;font-family:monospace;font-size:32px;font-weight:700;letter-spacing:8px;color:#1e293b">${escapeHtml(code)}</div>
<p style="font-size:13px;line-height:1.6;color:#64748b">This code expires in one minute. If you did not request this change, ignore this message and contact your security administrator.</p></div></body></html>`;
  try {
    const result = await provider.sendTransactionalEmail({ to: recipient, subject, htmlContent,
      textContent: `ElectroHub — Verify your new administrator email\n\nYour six-digit code is ${code}. It expires in one minute. Your sign-in email will not change until verification succeeds.`,
      tags: [EmailType.ADMIN_EMAIL_CHANGE_OTP] });
    if (result.success && result.messageId) {
      await prisma.emailDelivery.update({ where: { id: delivery.id }, data: { status: EmailDeliveryStatus.SENT, providerMessageId: result.messageId, sentAt: new Date() } });
      return true;
    }
  } catch { /* delivery state is recorded below without exposing the recipient or code */ }
  await prisma.emailDelivery.update({ where: { id: delivery.id }, data: { status: EmailDeliveryStatus.FAILED,
    failureReason: 'Email provider delivery failed', failedAt: new Date() } }).catch(() => undefined);
  logger.error('ADMIN_EMAIL_CHANGE_OTP_DELIVERY_FAILED', { deliveryId: delivery.id, userId });
  return false;
}

/** Called in the account-change transaction so both notices exist if and only if the email update commits. */
export async function queueAdminEmailChangeNotices(tx: Prisma.TransactionClient, userId: string, oldEmail: string, newEmail: string): Promise<string[]> {
  const rows = await Promise.all([
    tx.emailDelivery.create({ data: { type: EmailType.ADMIN_EMAIL_CHANGE_OLD, recipient: oldEmail, userId, status: EmailDeliveryStatus.QUEUED, provider: 'BREVO' }, select: { id: true } }),
    tx.emailDelivery.create({ data: { type: EmailType.ADMIN_EMAIL_CHANGE_NEW, recipient: newEmail, userId, status: EmailDeliveryStatus.QUEUED, provider: 'BREVO' }, select: { id: true } }),
  ]);
  return rows.map(row => row.id);
}

async function deliverNotice(id: string, provider: BrevoProvider): Promise<boolean> {
  const row = await prisma.emailDelivery.findUnique({ where: { id }, select: { recipient: true, type: true, createdAt: true, status: true } });
  if (!row || row.status === EmailDeliveryStatus.SENT || !NOTICE_TYPES.includes(row.type as NoticeType)) return false;
  const content = notificationContent(row.type as NoticeType, row.createdAt);
  try {
    const result = await provider.sendTransactionalEmail({ to: row.recipient, ...content, tags: [row.type] });
    if (result.success && result.messageId) {
      await prisma.emailDelivery.update({ where: { id }, data: { status: EmailDeliveryStatus.SENT, providerMessageId: result.messageId, sentAt: new Date(), failureReason: null } });
      return true;
    }
  } catch { /* persisted as FAILED below; the retry sweep is safe after commit */ }
  await prisma.emailDelivery.update({ where: { id }, data: { status: EmailDeliveryStatus.FAILED, failureReason: 'Email provider delivery failed', failedAt: new Date() } }).catch(() => undefined);
  logger.error('ADMIN_EMAIL_CHANGE_NOTICE_DELIVERY_FAILED', { deliveryId: id });
  return false;
}

async function claim(id: string, fromStatus: EmailDeliveryStatus, olderThan?: Date): Promise<boolean> {
  const result = await prisma.emailDelivery.updateMany({ where: { id, status: fromStatus, ...(olderThan ? { updatedAt: { lt: olderThan } } : {}) },
    data: { status: EmailDeliveryStatus.QUEUED, updatedAt: new Date() } });
  return result.count === 1;
}

/** Best-effort after commit; delivery failure never changes the committed account identity. */
export async function dispatchAdminEmailChangeNotices(ids: string[], provider: BrevoProvider = brevoProvider): Promise<void> {
  await Promise.all(ids.map(async id => {
    try { await deliverNotice(id, provider); }
    catch (error) { logger.error('ADMIN_EMAIL_CHANGE_NOTICE_FAILED', { deliveryId: id, errorName: error instanceof Error ? error.name : 'unknown' }); }
  }));
}

export async function retryAdminEmailChangeNotices(provider: BrevoProvider = brevoProvider, now = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - STALE_CLAIM_MS);
  const rows = await prisma.emailDelivery.findMany({ where: { type: { in: [...NOTICE_TYPES] },
    OR: [{ status: EmailDeliveryStatus.FAILED }, { status: EmailDeliveryStatus.QUEUED, updatedAt: { lt: cutoff } }] },
    orderBy: { createdAt: 'asc' }, take: MAX_RETRIES_PER_SWEEP, select: { id: true, status: true } });
  let sent = 0;
  for (const row of rows) {
    const won = row.status === EmailDeliveryStatus.FAILED ? await claim(row.id, EmailDeliveryStatus.FAILED) : await claim(row.id, EmailDeliveryStatus.QUEUED, cutoff);
    if (won && await deliverNotice(row.id, provider)) sent += 1;
  }
  return sent;
}

export function startAdminEmailChangeNoticeRetry(intervalMs = 5 * 60 * 1000): () => void {
  const timer = setInterval(() => { void retryAdminEmailChangeNotices().catch(() => undefined); }, intervalMs);
  timer.unref();
  return () => clearInterval(timer);
}
