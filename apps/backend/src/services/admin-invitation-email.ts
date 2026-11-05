import { EmailDeliveryStatus, EmailType } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { brevoProvider, type BrevoProvider } from '../integrations/brevo/brevo.provider.js';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

/**
 * Task 05.2 invitation email. The link carries the token in the URL fragment, which browsers never send in requests or referrers.
 * The ledger row (email_deliveries) records the outcome only — never the link or token.
 */
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]!);

export function invitationLink(token: string): string {
  return `${(env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '')}/admin/invite#token=${encodeURIComponent(token)}`;
}

export async function sendAdminInvitationEmail(input: { to: string; token: string; inviterName: string | null; expiresAt: Date },
  provider: BrevoProvider = brevoProvider): Promise<boolean> {
  const delivery = await prisma.emailDelivery.create({ data: { type: EmailType.ADMIN_INVITATION, recipient: input.to, status: EmailDeliveryStatus.QUEUED, provider: 'BREVO' } });
  const link = invitationLink(input.token);
  const inviter = input.inviterName ? escapeHtml(input.inviterName) : 'An ElectroHub owner';
  const expires = input.expiresAt.toUTCString();
  const htmlContent = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>You're invited to ElectroHub Admin</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f8fafc;margin:0;padding:24px;color:#0f172a">
<div style="max-width:480px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;padding:32px">
<div style="font-size:22px;font-weight:700;color:#2563eb;text-align:center;margin-bottom:24px">ElectroHub</div>
<h1 style="font-size:20px;font-weight:600;margin:0 0 12px;text-align:center">You're invited to the Admin Portal</h1>
<p style="font-size:14px;line-height:1.6;color:#475569">${inviter} invited you to join the ElectroHub administration team. Create your account and set up two-step verification to get access.</p>
<p style="text-align:center;margin:24px 0"><a href="${escapeHtml(link)}" style="background:#2563eb;color:#fff;text-decoration:none;padding:12px 20px;font-weight:600;display:inline-block">Accept invitation</a></p>
<p style="font-size:13px;color:#64748b">This single-use invitation expires on ${escapeHtml(expires)}. If you were not expecting it, ignore this email.</p>
</div></body></html>`;
  const textContent = `ElectroHub Admin invitation\n\n${input.inviterName ?? 'An ElectroHub owner'} invited you to join the ElectroHub administration team.\nAccept: ${link}\n\nThis single-use invitation expires on ${expires}. If you were not expecting it, ignore this email.`;
  try {
    const result = await provider.sendTransactionalEmail({ to: input.to, subject: "You're invited to ElectroHub Admin", htmlContent, textContent, tags: [EmailType.ADMIN_INVITATION] });
    if (result.success && result.messageId) {
      await prisma.emailDelivery.update({ where: { id: delivery.id }, data: { status: EmailDeliveryStatus.SENT, providerMessageId: result.messageId, sentAt: new Date() } });
      return true;
    }
    await prisma.emailDelivery.update({ where: { id: delivery.id }, data: { status: EmailDeliveryStatus.FAILED, failureReason: 'Email provider delivery failed', failedAt: new Date() } });
  } catch {
    await prisma.emailDelivery.update({ where: { id: delivery.id }, data: { status: EmailDeliveryStatus.FAILED, failureReason: 'Email provider delivery failed', failedAt: new Date() } })
      .catch(() => undefined);
  }
  logger.error('ADMIN_INVITATION_DELIVERY_FAILED', { deliveryId: delivery.id });
  return false;
}
