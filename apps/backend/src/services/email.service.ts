import { prisma } from '../lib/prisma.js';
import { brevoProvider, BrevoProvider } from '../integrations/brevo/brevo.provider.js';
import { EmailDeliveryStatus, EmailType } from '@prisma/client';
import { logger } from '../utils/logger.js';

export class EmailService {
  private provider: BrevoProvider;

  constructor(provider?: BrevoProvider) {
    this.provider = provider || brevoProvider;
  }

  /**
   * Helper to mask email addresses in logs to avoid PII exposure.
   * e.g., user@example.com -> u***r@example.com
   */
  private maskEmail(email: string): string {
    const parts = email.split('@');
    if (parts.length !== 2) return '[REDACTED_EMAIL]';
    const [name, domain] = parts;
    if (name.length <= 2) {
      return `${name[0]}*@${domain}`;
    }
    return `${name[0]}***${name[name.length - 1]}@${domain}`;
  }

  /**
   * Send an account verification OTP to a recipient email.
   * Tracks EmailDelivery lifecycle: QUEUED -> SENT or FAILED.
   * Never logs OTP or secrets.
   */
  async sendAccountVerificationOtp(email: string, otp: string, userId?: string): Promise<boolean> {
    const normalizedEmail = email.toLowerCase().trim();

    // 1. Persist QUEUED delivery record
    const delivery = await prisma.emailDelivery.create({
      data: {
        type: EmailType.ACCOUNT_VERIFICATION,
        recipient: normalizedEmail,
        userId: userId || null,
        status: EmailDeliveryStatus.QUEUED,
        provider: 'BREVO',
      },
    });

    const htmlContent = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Verify your ElectroHub account</title>
  <style>
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px; color: #0f172a; }
    .card { max-width: 480px; margin: 0 auto; background: #ffffff; border-radius: 12px; border: 1px solid #e2e8f0; padding: 32px; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
    .brand { font-size: 22px; font-weight: 700; color: #2563eb; text-align: center; margin-bottom: 24px; }
    h1 { font-size: 20px; font-weight: 600; margin: 0 0 12px; text-align: center; color: #0f172a; }
    p { font-size: 14px; line-height: 1.6; color: #475569; margin: 0 0 16px; }
    .code-container { background: #f1f5f9; border-radius: 8px; padding: 18px; text-align: center; margin: 24px 0; border: 1px dashed #cbd5e1; }
    .code { font-family: monospace; font-size: 32px; font-weight: 700; letter-spacing: 8px; color: #1e293b; }
    .notice { font-size: 13px; color: #64748b; margin-top: 16px; }
    .footer { font-size: 12px; color: #94a3b8; text-align: center; margin-top: 32px; border-top: 1px solid #f1f5f9; padding-top: 16px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="brand">ElectroHub</div>
    <h1>Verify your email</h1>
    <p>Please enter the following 6-digit verification code to verify your ElectroHub account. This code is valid for 10 minutes.</p>
    <div class="code-container">
      <span class="code">${otp}</span>
    </div>
    <p class="notice">If you did not request this verification code, please ignore this email. Never share this code with anyone.</p>
    <div class="footer">&copy; ElectroHub. All rights reserved.</div>
  </div>
</body>
</html>
    `.trim();

    const textContent = `ElectroHub — Verify your email\n\nYour 6-digit verification code is: ${otp}\n\nThis code will expire in 10 minutes. If you did not request this code, you can safely ignore this email.`;

    try {
      // 2. Call Brevo provider
      const result = await this.provider.sendTransactionalEmail({
        to: normalizedEmail,
        subject: 'Verify your ElectroHub account',
        htmlContent,
        textContent,
        tags: [EmailType.ACCOUNT_VERIFICATION],
      });

      if (result.success && result.messageId) {
        // 3. Mark SENT
        await prisma.emailDelivery.update({
          where: { id: delivery.id },
          data: {
            status: EmailDeliveryStatus.SENT,
            providerMessageId: result.messageId,
            sentAt: new Date(),
          },
        });

        logger.info('EMAIL_SEND_SUCCESS', {
          deliveryId: delivery.id,
          type: EmailType.ACCOUNT_VERIFICATION,
          recipient: this.maskEmail(normalizedEmail),
          providerMessageId: result.messageId,
        });

        return true;
      }

      // 4. Mark FAILED
      const failureReason = result.error || 'Provider rejected request';
      await prisma.emailDelivery.update({
        where: { id: delivery.id },
        data: {
          status: EmailDeliveryStatus.FAILED,
          failureReason,
          failedAt: new Date(),
        },
      });

      logger.error('EMAIL_SEND_FAILURE', {
        deliveryId: delivery.id,
        type: EmailType.ACCOUNT_VERIFICATION,
        recipient: this.maskEmail(normalizedEmail),
        reason: failureReason,
      });

      return false;
    } catch (err: unknown) {
      const failureReason = err instanceof Error ? err.message : 'Unexpected email delivery error';
      await prisma.emailDelivery.update({
        where: { id: delivery.id },
        data: {
          status: EmailDeliveryStatus.FAILED,
          failureReason,
          failedAt: new Date(),
        },
      });

      logger.error('EMAIL_SEND_FAILURE', {
        deliveryId: delivery.id,
        type: EmailType.ACCOUNT_VERIFICATION,
        recipient: this.maskEmail(normalizedEmail),
        reason: failureReason,
      });

      return false;
    }
  }
}

export const emailService = new EmailService();
