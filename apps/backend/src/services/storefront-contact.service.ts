import { renderEmailHeader } from '../emails/brand.js';
import { brevoProvider, type BrevoProvider } from '../integrations/brevo/brevo.provider.js';
import { AppError } from '../middleware/errorHandler.js';

export interface StorefrontContactMessage { name: string; email: string; subject: string; message: string }
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Delivers customer messages to the store's configured support mailbox; never accepts a recipient from the request. */
export class StorefrontContactService {
  constructor(private readonly provider: Pick<BrevoProvider, 'sendTransactionalEmail'> = brevoProvider) {}

  async send(input: StorefrontContactMessage, recipient: string | null): Promise<void> {
    if (!recipient) throw new AppError('Contact delivery is temporarily unavailable.', 503, 'CONTACT_UNAVAILABLE');
    const safeName = escapeHtml(input.name), safeEmail = escapeHtml(input.email);
    const safeSubject = escapeHtml(input.subject), safeMessage = escapeHtml(input.message).replace(/\r?\n/g, '<br>');
    const result = await this.provider.sendTransactionalEmail({ to: recipient, replyTo: { email: input.email, name: input.name }, subject: `Store contact: ${input.subject.slice(0, 120)}`,
      textContent: `From: ${input.name} <${input.email}>\n\n${input.message}`, htmlContent: `${renderEmailHeader({ marginBottom: 16 })}<p><b>From:</b> ${safeName} &lt;${safeEmail}&gt;</p><p><b>Subject:</b> ${safeSubject}</p><p>${safeMessage}</p>` });
    if (!result.success) throw new AppError('Contact delivery is temporarily unavailable.', 503, 'CONTACT_UNAVAILABLE');
  }
}

export const storefrontContact = new StorefrontContactService();
