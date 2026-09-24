import {
  BrevoSendEmailPayload,
  BrevoSendEmailResponse,
} from './brevo.types.js';

export interface BrevoClientOptions {
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
}

export class BrevoClient {
  private readonly apiKey: string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;

  constructor(options: BrevoClientOptions = {}) {
    this.apiKey = options.apiKey || '';
    this.baseUrl = (options.baseUrl || 'https://api.brevo.com/v3').replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs || 10000;
  }

  /**
   * Send transactional email via Brevo REST API: POST /v3/smtp/email
   */
  async sendSmtpEmail(payload: BrevoSendEmailPayload): Promise<BrevoSendEmailResponse> {
    if (!this.apiKey) {
      throw new Error('Brevo API key is not configured');
    }

    const endpoint = `${this.baseUrl}/smtp/email`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: {
          'accept': 'application/json',
          'api-key': this.apiKey,
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const responseText = await response.text();
      let responseData: Record<string, unknown> = {};

      try {
        responseData = responseText ? JSON.parse(responseText) : {};
      } catch {
        responseData = { raw: responseText };
      }

      if (!response.ok) {
        const errorMsg =
          typeof responseData.message === 'string'
            ? responseData.message
            : `Brevo request failed with status ${response.status}`;
        throw new Error(errorMsg);
      }

      if (!responseData.messageId || typeof responseData.messageId !== 'string') {
        throw new Error('Brevo response missing valid messageId');
      }

      return {
        messageId: responseData.messageId,
      };
    } catch (err: unknown) {
      if (err instanceof Error) {
        if (err.name === 'AbortError') {
          throw new Error(`Brevo request timed out after ${this.timeoutMs}ms`);
        }
        // Protect secret: ensure apiKey never leaks into any error message
        const sanitized = err.message.replace(new RegExp(this.apiKey, 'g'), '[REDACTED]');
        throw new Error(sanitized);
      }
      throw new Error('Unknown error communicating with Brevo');
    } finally {
      clearTimeout(timer);
    }
  }
}
