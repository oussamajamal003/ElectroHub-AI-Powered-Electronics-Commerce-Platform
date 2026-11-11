import { brevoProvider, type BrevoProvider } from '../integrations/brevo/brevo.provider.js';
import { escapeHtml } from '../emails/commerce/escape.js';
import { FONT_STACK } from '../emails/commerce/layout.js';
import { AppError } from '../middleware/errorHandler.js';

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
    `<p style="margin:0 0 24px 0;font-size:20px;line-height:28px;font-weight:700;">${store}</p>`,
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

/**
 * Delivers customer messages to the store's configured support mailbox; never accepts a recipient from the request.
 * Resolving means the provider accepted the message for delivery (HTTP 202 to the customer). It is not proof that it reached an inbox.
 */
export class StorefrontContactService {
  constructor(private readonly provider: Pick<BrevoProvider, 'sendTransactionalEmail'> = brevoProvider) {}

  async send(input: StorefrontContactMessage, recipient: string | null, storeName = 'ElectroHub'): Promise<void> {
    if (!recipient) throw new AppError('Contact delivery is temporarily unavailable.', 503, 'CONTACT_UNAVAILABLE');
    const { html, text } = renderContactNotification(input, storeName);
    const result = await this.provider.sendTransactionalEmail({ to: recipient, replyTo: { email: input.email, name: oneLine(input.name) },
      // Subject contract (`Store contact: …`) is relied on by the disposable capture helper and by mailbox filters; keep it stable.
      subject: `Store contact: ${oneLine(input.subject).slice(0, 120)}`, textContent: text, htmlContent: html });
    if (!result.success) throw new AppError('Contact delivery is temporarily unavailable.', 503, 'CONTACT_UNAVAILABLE');
  }
}

export const storefrontContact = new StorefrontContactService();
