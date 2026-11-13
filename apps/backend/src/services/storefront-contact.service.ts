import { renderEmailHeader } from '../emails/brand.js';
import { brevoProvider, type BrevoProvider } from '../integrations/brevo/brevo.provider.js';
import { escapeHtml } from '../emails/commerce/escape.js';
import { FONT_STACK } from '../emails/commerce/layout.js';
import { AppError } from '../middleware/errorHandler.js';
import type { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '../lib/prisma.js';

/** Contact recipients have completed MFA, still possess an active factor, and have an MFA-assured login record. */
export const contactAdministratorWhere = {
  isActive: true, emailVerifiedAt: { not: null }, role: { name: 'ADMIN' },
  adminSecurity: { is: { mfaEnrolledAt: { not: null } } },
  adminSessions: { some: {} },
  OR: [
    { adminMfaFactors: { some: { verifiedAt: { not: null }, disabledAt: null } } },
    { adminWebAuthnCredentials: { some: { revokedAt: null } } },
  ],
} satisfies Prisma.UserWhereInput;

export function contactAdministratorFilter(nodeEnv = process.env.NODE_ENV): Prisma.UserWhereInput {
  return nodeEnv === 'test' ? contactAdministratorWhere : { ...contactAdministratorWhere, AND: [
    { NOT: { email: { endsWith: '.invalid', mode: 'insensitive' } } },
    { NOT: { email: { endsWith: '.test', mode: 'insensitive' } } },
  ] };
}
import { logger } from '../utils/logger.js';
import { z } from 'zod';

export interface StorefrontContactMessage { name: string; email: string; subject: string; message: string }

const oneLine = (value: string) => value.replace(/[\r\n]+/g, ' ').trim();

/** Branded notification for the store's support mailbox. Every customer value is escaped; nothing here is a link the customer controls. */
export function renderContactNotification(input: StorefrontContactMessage, storeName: string) {
  const store = escapeHtml(oneLine(storeName) || 'ElectroHub');
  const name = escapeHtml(input.name), email = escapeHtml(input.email), subject = escapeHtml(input.subject);
  const message = escapeHtml(input.message).replace(/\r?\n/g, '<br>');
  const label = `margin:0 0 2px 0;font-size:12px;line-height:16px;color:#475569;text-transform:uppercase;letter-spacing:.04em;`;
  const value = `margin:0 0 16px 0;font-size:15px;line-height:22px;color:#0F172A;`;
  const html = [
    '<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>New contact message</title></head>`,
    '<body style="margin:0;padding:0;background-color:#F8FAFC;">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background-color:#F8FAFC;"><tr><td align="center" style="padding:24px;">',
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background-color:#FFFFFF;border:1px solid #E2E8F0;border-top:3px solid #2563EB;">',
    `<tr><td style="padding:32px;font-family:${FONT_STACK};color:#0F172A;">`,
    renderEmailHeader({ marginBottom: 16, storeName }),
    `<h1 style="margin:0 0 16px 0;font-size:22px;line-height:30px;font-weight:600;">New message from the Contact page</h1>`,
    `<p style="${label}">From</p><p style="${value}">${name} &lt;${email}&gt;</p>`,
    `<p style="${label}">Subject</p><p style="${value}">${subject}</p>`,
    `<p style="${label}">Message</p><p style="${value}">${message}</p>`,
    `<p style="margin:24px 0 0 0;font-size:12px;line-height:18px;color:#64748B;">Reply to this email to answer the customer directly. `
      + `This message was sent from the ${store} storefront contact form; the sender's address has not been verified.</p>`,
    '</td></tr></table></td></tr></table></body></html>',
  ].join('');
  const text = `New message from the ${oneLine(storeName) || 'ElectroHub'} Contact page\n\nFrom: ${oneLine(input.name)} <${oneLine(input.email)}>\nSubject: ${oneLine(input.subject)}\n\n${input.message}\n\n`
    + 'Reply to this email to answer the customer directly. The sender address has not been verified.';
  return { html, text };
}

const recipientSchema = z.string().trim().email().max(255);

/**
 * Delivers customer messages to the store's configured support mailbox (Admin -> Settings -> Store email); never accepts a recipient
 * from the request and never falls back to a hard-coded or sender address. The provider's configured, verified sender stays the From
 * address; the customer is only the Reply-To.
 *
 * Outcomes, each with a distinct safe code so the storefront can say what actually happened:
 *  - resolves: the provider ACCEPTED the message for delivery (HTTP 202). That is not proof that it reached an inbox.
 *  - 503 CONTACT_NOT_CONFIGURED: no valid support mailbox is configured; nothing was sent. An administrator must set the Store email.
 *  - 503 CONTACT_UNAVAILABLE: the provider rejected, timed out or could not be reached; nothing was accepted. Safe to retry.
 * Logs carry only categories and provider status codes: never the recipient, the customer's address or the message.
 */
export class StorefrontContactService {
  constructor(private readonly provider: Pick<BrevoProvider, 'sendTransactionalEmail'> = brevoProvider,
    private readonly db: Pick<PrismaClient, 'user'> = prisma) {}

  /**
   * The configured Store Settings support mailbox is the destination. Only when none is configured does the message fall back
   * to the verified, MFA-enrolled administrators (one provider request, Bcc), so an empty setting never silently drops mail.
   */
  async deliver(input: StorefrontContactMessage, supportEmail: string | null, storeName = 'ElectroHub'): Promise<void> {
    if (recipientSchema.safeParse(supportEmail ?? '').success) return this.send(input, supportEmail, storeName);
    return this.sendToAdministrators(input, storeName);
  }

  async sendToAdministrators(input: StorefrontContactMessage, storeName = 'ElectroHub'): Promise<void> {
    const administrators = await this.db.user.findMany({ where: contactAdministratorFilter(), select: { email: true },
      orderBy: { id: 'asc' }, take: 1001 });
    // One provider request prevents a partial loop from sending the same message
    // again to earlier recipients when a later per-recipient call fails.
    const recipients = [...new Set(administrators.map(admin => admin.email.toLowerCase()))];
    if (recipients.length > 1000) throw new AppError('Contact delivery is temporarily unavailable.', 503, 'CONTACT_UNAVAILABLE');
    await this.send(input, recipients[0] ?? null, storeName, recipients.slice(1).map(email => ({ email })));
  }

  async send(input: StorefrontContactMessage, recipient: string | null, storeName = 'ElectroHub', bcc: { email: string }[] = []): Promise<void> {
    const to = recipientSchema.safeParse(recipient ?? '');
    if (!to.success) {
      logger.warn('Contact message not sent: no support mailbox or eligible administrator is configured', { event: 'contact.recipient_missing', configured: Boolean(recipient) });
      throw new AppError('Our support inbox is not set up yet, so messages cannot be delivered right now.', 503, 'CONTACT_NOT_CONFIGURED');
    }
    const { html, text } = renderContactNotification(input, storeName);
    let result: Awaited<ReturnType<BrevoProvider['sendTransactionalEmail']>>;
    try {
      result = await this.provider.sendTransactionalEmail({ to: to.data, ...(bcc.length ? { bcc } : {}), replyTo: { email: input.email, name: oneLine(input.name) },
        // Subject contract (`Store contact: …`) is relied on by the disposable capture helper and by mailbox filters; keep it stable.
        subject: `Store contact: ${oneLine(input.subject).slice(0, 120)}`, textContent: text, htmlContent: html });
    } catch {
      result = { success: false, failure: { category: 'provider_error' } };
    }
    if (!result.success) {
      logger.error('Contact message was not accepted by the email provider', { event: 'contact.provider_rejected',
        category: result.failure?.category ?? 'provider_error', providerStatus: result.failure?.httpStatus, providerCode: result.failure?.providerCode });
      throw new AppError('Contact delivery is temporarily unavailable.', 503, 'CONTACT_UNAVAILABLE');
    }
  }
}

export const storefrontContact = new StorefrontContactService();
