import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { BrevoClient, BrevoRequestError } from './brevo.client.js';
import { createHash, randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import {
  BrevoEmailAddress,
  BrevoSendEmailPayload,
  SendTransactionalEmailOptions,
  SendTransactionalEmailResult,
} from './brevo.types.js';

export class BrevoProvider {
  private client: BrevoClient;
  private defaultSenderEmail: string;
  private defaultSenderName: string;

  constructor(client?: BrevoClient, defaultSender?: { email?: string; name?: string }) {
    this.client =
      client ||
      new BrevoClient({
        apiKey: env.BREVO_API_KEY,
      });

    this.defaultSenderEmail = defaultSender?.email || env.BREVO_SENDER_EMAIL || '';
    this.defaultSenderName = defaultSender?.name || env.BREVO_SENDER_NAME || 'ElectroHub';
  }

  /**
   * Send a transactional email through Brevo provider.
   */
  async sendTransactionalEmail(
    options: SendTransactionalEmailOptions
  ): Promise<SendTransactionalEmailResult> {
    try {
      const recipientEmail = typeof options.to === 'string' ? options.to : options.to.email;
      if (env.NODE_ENV === 'test' && env.E2E_OTP_OUTBOX_DIR && recipientEmail.endsWith('.invalid')) {
        const fileName = createHash('sha256').update(`${recipientEmail}:${options.subject}`).digest('hex');
        await mkdir(env.E2E_OTP_OUTBOX_DIR, { recursive: true });
        await writeFile(join(env.E2E_OTP_OUTBOX_DIR, `${fileName}.json`), JSON.stringify({
          to: recipientEmail,
          subject: options.subject,
          textContent: options.textContent,
        }), { mode: 0o600 });
        return { success: true, messageId: `e2e-${randomUUID()}` };
      }
      if (env.NODE_ENV === 'test' && process.env.VITEST_NO_MOCK_BREVO !== 'true') {
        return { success: true, messageId: `mocked-message-id-${randomUUID()}` };
      }

      const sender: BrevoEmailAddress = {
        email: options.sender?.email || this.defaultSenderEmail,
        name: options.sender?.name || this.defaultSenderName,
      };

      const recipient: BrevoEmailAddress =
        typeof options.to === 'string'
          ? { email: options.to }
          : { email: options.to.email, name: options.to.name };

      const payload: BrevoSendEmailPayload = {
        sender,
        to: [recipient],
        subject: options.subject,
        htmlContent: options.htmlContent,
        textContent: options.textContent,
        tags: options.tags,
        templateId: options.templateId,
        params: options.params,
      };

      const result = await this.client.sendSmtpEmail(payload);

      return {
        success: true,
        messageId: result.messageId,
      };
    } catch (err: unknown) {
      const safeError = err instanceof BrevoRequestError ? err.message : 'Brevo delivery failed';
      logger.error('Brevo provider failed to send transactional email', {
        category: err instanceof BrevoRequestError ? err.category : 'provider_error',
        statusCode: err instanceof BrevoRequestError ? err.statusCode : undefined,
        providerCode: err instanceof BrevoRequestError ? err.providerCode : undefined,
      });
      return {
        success: false,
        error: safeError,
      };
    }
  }
}

export const brevoProvider = new BrevoProvider();
