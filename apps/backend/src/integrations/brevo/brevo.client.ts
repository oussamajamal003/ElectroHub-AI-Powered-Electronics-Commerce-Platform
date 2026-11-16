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
    readonly category: 'rejected' | 'timeout' | 'network' | 'connect' | 'invalid_response' | 'configuration' = 'network',
    readonly retryAfterMs?: number
  ) {
    const safeCode = providerCode ? `, ${providerCode}` : '';
    super(category === 'rejected'
      ? `Brevo request rejected (HTTP ${statusCode}${safeCode})`
      : category === 'timeout'
        ? 'Brevo request timed out'
        : category === 'invalid_response'
          ? 'Brevo returned an invalid response'
          : category === 'configuration'
            ? 'Brevo API key is not configured'
            : 'Brevo network request failed');
    this.name = 'BrevoRequestError';
  }
}

const CONNECT_FAILURES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH']);
function connectFailure(err: unknown) {
  const cause = err instanceof Error ? (err as Error & { cause?: unknown }).cause : undefined;
  const code = cause && typeof cause === 'object' && 'code' in cause ? (cause as { code?: unknown }).code : undefined;
  return typeof code === 'string' && CONNECT_FAILURES.has(code);
}
/** Retry-After as delta-seconds or HTTP date; bounded to one hour; anything else is ignored. */
export function parseRetryAfter(value: string | null, now = Date.now()): number | undefined {
  if (!value) return undefined;
  const ms = /^\d{1,6}$/.test(value.trim()) ? Number(value.trim()) * 1000 : Date.parse(value) - now;
  return Number.isFinite(ms) && ms > 0 ? Math.min(ms, 3_600_000) : undefined;
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
      throw new BrevoRequestError(undefined, undefined, 'configuration');
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
        throw new BrevoRequestError(response.status, providerCode, 'rejected', parseRetryAfter(response.headers?.get?.('retry-after') ?? null));
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
      // Only a failure to establish the connection proves the request was never submitted; anything later stays ambiguous.
      throw new BrevoRequestError(undefined, undefined, connectFailure(err) ? 'connect' : 'network');
    } finally {
      clearTimeout(timer);
    }
  }
}
