import { env } from '../../config/env.js';
import { logger } from '../../utils/logger.js';
import { BrevoClient } from './brevo.client.js';
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
      const errorMessage = err instanceof Error ? err.message : 'Brevo provider error';
      logger.error('Brevo provider failed to send transactional email', {
        errorMessage,
      });
      return {
        success: false,
        error: errorMessage,
      };
    }
  }
}

export const brevoProvider = new BrevoProvider();
