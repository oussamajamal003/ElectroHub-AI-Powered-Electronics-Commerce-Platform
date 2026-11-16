import { describe, it, expect, beforeEach, vi } from 'vitest';
import { EmailService } from '../email.service.js';
import { brevoProvider } from '../../integrations/brevo/brevo.provider.js';
import { prisma } from '../../lib/prisma.js';
import { EmailType, EmailDeliveryStatus, EmailDelivery } from '@prisma/client';

// Mock prisma and provider
vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    emailDelivery: {
      create: vi.fn(),
      update: vi.fn(),
    },
  },
}));

vi.mock('../../integrations/brevo/brevo.provider.js', () => ({
  brevoProvider: {
    sendTransactionalEmail: vi.fn(),
  },
}));

describe('EmailService', () => {
  let emailService: EmailService;

  beforeEach(() => {
    emailService = new EmailService();
    vi.clearAllMocks();
  });

  describe('sendAccountVerificationOtp', () => {
    it('should persist QUEUED delivery, call Brevo, and transition to SENT on success', async () => {
      vi.mocked(prisma.emailDelivery.create).mockResolvedValue({ id: 'delivery-1' } as unknown as EmailDelivery);
      vi.mocked(brevoProvider.sendTransactionalEmail).mockResolvedValue({
        success: true,
        messageId: 'msg-brevo-999',
      });
      vi.mocked(prisma.emailDelivery.update).mockResolvedValue({} as unknown as EmailDelivery);

      const result = await emailService.sendAccountVerificationOtp('customer@example.com', '123456', 'user-123');

      expect(result).toBe(true);

      // Verify QUEUED record creation
      expect(prisma.emailDelivery.create).toHaveBeenCalledWith({
        data: {
          type: EmailType.ACCOUNT_VERIFICATION,
          recipient: 'customer@example.com',
          userId: 'user-123',
          status: EmailDeliveryStatus.QUEUED,
          provider: 'BREVO',
        },
      });

      // Verify Brevo provider call
      expect(brevoProvider.sendTransactionalEmail).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'customer@example.com',
          subject: 'Verify your ElectroHub account',
          tags: [EmailType.ACCOUNT_VERIFICATION],
          htmlContent: expect.stringContaining('123456'),
          textContent: expect.stringContaining('123456'),
        })
      );

      // Verify transition to SENT with providerMessageId
      expect(prisma.emailDelivery.update).toHaveBeenCalledWith({
        where: { id: 'delivery-1' },
        data: expect.objectContaining({
          status: EmailDeliveryStatus.SENT,
          providerMessageId: 'msg-brevo-999',
          sentAt: expect.any(Date),
        }),
      });
    });

    it('should transition to FAILED and handle provider errors gracefully', async () => {
      vi.mocked(prisma.emailDelivery.create).mockResolvedValue({ id: 'delivery-1' } as unknown as EmailDelivery);
      vi.mocked(brevoProvider.sendTransactionalEmail).mockResolvedValue({
        success: false,
        error: 'Brevo request rejected (HTTP 400, invalid_parameter)',
      });
      vi.mocked(prisma.emailDelivery.update).mockResolvedValue({} as unknown as EmailDelivery);

      const result = await emailService.sendAccountVerificationOtp('invalid@example.com', '123456');

      expect(result).toBe(false);

      expect(prisma.emailDelivery.update).toHaveBeenCalledWith({
        where: { id: 'delivery-1' },
        data: expect.objectContaining({
          status: EmailDeliveryStatus.FAILED,
          failureReason: 'Brevo request rejected (HTTP 400, invalid_parameter)',
          failedAt: expect.any(Date),
        }),
      });
    });

    it('should transition to FAILED when an unexpected exception is thrown', async () => {
      vi.mocked(prisma.emailDelivery.create).mockResolvedValue({ id: 'delivery-1' } as unknown as EmailDelivery);
      vi.mocked(brevoProvider.sendTransactionalEmail).mockRejectedValue(new Error('Network offline'));
      vi.mocked(prisma.emailDelivery.update).mockResolvedValue({} as unknown as EmailDelivery);

      const result = await emailService.sendAccountVerificationOtp('offline@example.com', '123456');

      expect(result).toBe(false);

      expect(prisma.emailDelivery.update).toHaveBeenCalledWith({
        where: { id: 'delivery-1' },
        data: expect.objectContaining({
          status: EmailDeliveryStatus.FAILED,
          failureReason: 'Email provider delivery failed',
          failedAt: expect.any(Date),
        }),
      });
    });
  });
});
