export interface BrevoEmailAddress {
  email: string;
  name?: string;
}

export interface BrevoSendEmailPayload {
  sender?: BrevoEmailAddress;
  to: BrevoEmailAddress[];
  subject: string;
  htmlContent?: string;
  textContent?: string;
  tags?: string[];
  templateId?: number;
  params?: Record<string, unknown>;
  replyTo?: BrevoEmailAddress;
}

export interface BrevoSendEmailResponse {
  messageId: string;
}

export interface SendTransactionalEmailOptions {
  to: string | BrevoEmailAddress;
  subject: string;
  htmlContent?: string;
  textContent?: string;
  tags?: string[];
  templateId?: number;
  params?: Record<string, unknown>;
  sender?: BrevoEmailAddress;
}

/**
 * Structured, sanitized transport facts for callers that must decide retry safety (Task 03.8 commerce dispatcher).
 * Additive: OTP callers keep using success/messageId/error only. Never derived from human-readable error text.
 */
export interface SendTransactionalEmailFailure {
  category: 'rejected' | 'timeout' | 'network' | 'connect' | 'invalid_response' | 'configuration' | 'provider_error';
  httpStatus?: number;
  providerCode?: string;
  /** Validated Retry-After from a rejection, in milliseconds. */
  retryAfterMs?: number;
}

export interface SendTransactionalEmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
  failure?: SendTransactionalEmailFailure;
}
