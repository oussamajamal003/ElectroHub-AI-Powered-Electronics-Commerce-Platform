import {
  BrevoSendEmailPayload,
  BrevoSendEmailResponse,
} from './brevo.types.js';

export interface BrevoClientOptions {
  apiKey?: string;
  baseUrl?: string;
  timeoutMs?: number;
}

export class BrevoRequestError extends Error {
  constructor(
    readonly statusCode?: number,
    readonly providerCode?: string,
    readonly category: 'rejected' | 'timeout' | 'network' | 'invalid_response' = 'network'
  ) {
    const safeCode = providerCode ? `, ${providerCode}` : '';
    super(category === 'rejected'
      ? `Brevo request rejected (HTTP ${statusCode}${safeCode})`
      : category === 'timeout'
        ? 'Brevo request timed out'
        : category === 'invalid_response'
          ? 'Brevo returned an invalid response'
          : 'Brevo network request failed');
    this.name = 'BrevoRequestError';
  }
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
        const rawProviderCode = responseData.code ?? responseData.errorCode;
        const providerCode = typeof rawProviderCode === 'string' && /^[a-z0-9_-]{1,48}$/i.test(rawProviderCode)
          ? rawProviderCode
          : undefined;
        throw new BrevoRequestError(response.status, providerCode, 'rejected');
      }

      if (!responseData.messageId || typeof responseData.messageId !== 'string') {
        throw new BrevoRequestError(undefined, undefined, 'invalid_response');
      }

      return {
        messageId: responseData.messageId,
      };
    } catch (err: unknown) {
      if (err instanceof BrevoRequestError) throw err;
      if (err instanceof Error && err.name === 'AbortError') throw new BrevoRequestError(undefined, undefined, 'timeout');
      throw new BrevoRequestError();
    } finally {
      clearTimeout(timer);
    }
  }
}
