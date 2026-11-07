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

export function activationLink(token: string): string {
  return `${(env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '')}/admin/activate#token=${encodeURIComponent(token)}`;
}

/** Existing-administrator activation email. Same fragment-only link and ledger rules as the invitation email. */
export async function sendAdminActivationEmail(input: { to: string; token: string; ownerName: string | null; expiresAt: Date },
  provider: BrevoProvider = brevoProvider): Promise<boolean> {
  const delivery = await prisma.emailDelivery.create({ data: { type: EmailType.ADMIN_ACTIVATION, recipient: input.to, status: EmailDeliveryStatus.QUEUED, provider: 'BREVO' } });
  const link = activationLink(input.token);
  const owner = input.ownerName ? escapeHtml(input.ownerName) : 'An ElectroHub owner';
  const expires = input.expiresAt.toUTCString();
  const htmlContent = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Activate your ElectroHub administrator account</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f8fafc;margin:0;padding:24px;color:#0f172a">
<div style="max-width:480px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;padding:32px">
<div style="font-size:22px;font-weight:700;color:#2563eb;text-align:center;margin-bottom:24px">ElectroHub</div>
<h1 style="font-size:20px;font-weight:600;margin:0 0 12px;text-align:center">Activate your administrator account</h1>
<p style="font-size:14px;line-height:1.6;color:#475569">${owner} authorized two-step verification for your administrator account. Choose a new password and set up an authenticator app to continue. Your previous password stops working once you finish this step.</p>
<p style="text-align:center;margin:24px 0"><a href="${escapeHtml(link)}" style="background:#2563eb;color:#fff;text-decoration:none;padding:12px 20px;font-weight:600;display:inline-block">Activate account</a></p>
<p style="font-size:13px;color:#64748b">This single-use link expires on ${escapeHtml(expires)}. If you were not expecting it, ignore this email and tell an owner.</p>
</div></body></html>`;
  const textContent = `Activate your ElectroHub administrator account\n\n${input.ownerName ?? 'An ElectroHub owner'} authorized two-step verification for your administrator account.\nActivate: ${link}\n\nThis single-use link expires on ${expires}. If you were not expecting it, ignore this email and tell an owner.`;
  try {
    const result = await provider.sendTransactionalEmail({ to: input.to, subject: 'Activate your ElectroHub administrator account', htmlContent, textContent, tags: [EmailType.ADMIN_ACTIVATION] });
    if (result.success && result.messageId) {
      await prisma.emailDelivery.update({ where: { id: delivery.id }, data: { status: EmailDeliveryStatus.SENT, providerMessageId: result.messageId, sentAt: new Date() } });
      return true;
    }
    await prisma.emailDelivery.update({ where: { id: delivery.id }, data: { status: EmailDeliveryStatus.FAILED, failureReason: 'Email provider delivery failed', failedAt: new Date() } });
  } catch {
    await prisma.emailDelivery.update({ where: { id: delivery.id }, data: { status: EmailDeliveryStatus.FAILED, failureReason: 'Email provider delivery failed', failedAt: new Date() } })
      .catch(() => undefined);
  }
  logger.error('ADMIN_ACTIVATION_DELIVERY_FAILED', { deliveryId: delivery.id });
  return false;
}

export function adminLoginLink(): string {
  return `${(env.FRONTEND_URL || 'http://localhost:3000').replace(/\/$/, '')}/admin/login`;
}

/**
 * Security notice after an Owner grant has committed (promotion or transfer on deletion). Carries no link token or secret: the new Owner
 * signs in normally with their own password and two-step verification. Never throws; the ledger row records the outcome.
 */
export async function sendOwnerGrantedEmail(input: { to: string }, provider: BrevoProvider = brevoProvider): Promise<boolean> {
  let deliveryId: string | null = null;
  try {
    const delivery = await prisma.emailDelivery.create({ data: { type: EmailType.SECURITY_ALERT, recipient: input.to, status: EmailDeliveryStatus.QUEUED, provider: 'BREVO' } });
    deliveryId = delivery.id;
    const link = adminLoginLink();
    const message = 'You are now an Owner of ElectroHub. Sign in again using your administrator credentials and two-step verification to manage your new permissions.';
    const htmlContent = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>You are now an ElectroHub Owner</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f8fafc;margin:0;padding:24px;color:#0f172a">
<div style="max-width:480px;margin:0 auto;background:#fff;border:1px solid #e2e8f0;padding:32px">
<div style="font-size:22px;font-weight:700;color:#2563eb;text-align:center;margin-bottom:24px">ElectroHub</div>
<h1 style="font-size:20px;font-weight:600;margin:0 0 12px;text-align:center">You are now an Owner</h1>
<p style="font-size:14px;line-height:1.6;color:#475569">${escapeHtml(message)}</p>
<p style="text-align:center;margin:24px 0"><a href="${escapeHtml(link)}" style="background:#2563eb;color:#fff;text-decoration:none;padding:12px 20px;font-weight:600;display:inline-block">Sign in to Admin</a></p>
<p style="font-size:13px;color:#64748b">Your existing sessions were signed out. If you did not expect this change, contact another Owner immediately.</p>
</div></body></html>`;
    const textContent = `You are now an ElectroHub Owner\n\n${message}\nSign in: ${link}\n\nYour existing sessions were signed out. If you did not expect this change, contact another Owner immediately.`;
    const result = await provider.sendTransactionalEmail({ to: input.to, subject: 'You are now an ElectroHub Owner', htmlContent, textContent, tags: [EmailType.SECURITY_ALERT] });
    if (result.success && result.messageId) {
      await prisma.emailDelivery.update({ where: { id: delivery.id }, data: { status: EmailDeliveryStatus.SENT, providerMessageId: result.messageId, sentAt: new Date() } });
      return true;
    }
    await prisma.emailDelivery.update({ where: { id: delivery.id }, data: { status: EmailDeliveryStatus.FAILED, failureReason: 'Email provider delivery failed', failedAt: new Date() } });
  } catch {
    if (deliveryId) {
      await prisma.emailDelivery.update({ where: { id: deliveryId }, data: { status: EmailDeliveryStatus.FAILED, failureReason: 'Email provider delivery failed', failedAt: new Date() } })
        .catch(() => undefined);
    }
  }
  logger.error('ADMIN_OWNER_GRANTED_DELIVERY_FAILED', { deliveryId });
  return false;
}
