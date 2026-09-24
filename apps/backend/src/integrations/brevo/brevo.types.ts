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

export interface SendTransactionalEmailResult {
  success: boolean;
  messageId?: string;
  error?: string;
}
