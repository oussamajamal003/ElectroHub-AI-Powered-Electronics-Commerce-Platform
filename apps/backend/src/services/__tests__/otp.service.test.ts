import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OtpService } from '../otp.service.js';
import { prisma } from '../../lib/prisma.js';
import { OtpPurpose, OtpChallenge, User, OtpChannel } from '@prisma/client';
import crypto from 'crypto';
import { emailService } from '../email.service.js';

// Mock env
vi.mock('../../config/env.js', () => ({
  env: {
    OTP_HASH_SECRET: 'test-otp-secret-key-32chars-min-length',
  },
}));

// Mock email service
vi.mock('../email.service.js', () => ({
  emailService: {
    sendAccountVerificationOtp: vi.fn(),
  },
}));

// Mock prisma
vi.mock('../../lib/prisma.js', () => ({
  prisma: {
    otpChallenge: {
      updateMany: vi.fn(),
      create: vi.fn(),
      findUnique: vi.fn(),
      update: vi.fn(),
      findFirst: vi.fn(),
    },
    user: {
      update: vi.fn(),
    },
  },
}));

describe('OtpService', () => {
  let otpService: OtpService;

  beforeEach(() => {
    otpService = new OtpService();
    vi.clearAllMocks();
  });

  describe('generateCode & hashCode', () => {
    it('should generate a 6-digit numeric OTP', () => {
      const code = otpService.generateCode();
      expect(code).toHaveLength(6);
      expect(code).toMatch(/^[0-9]{6}$/);
    });

    it('should hash code predictably with HMAC sha256 without storing plaintext', () => {
      const code = '483921';
      const hash = otpService.hashCode(code);
      const expected = crypto
        .createHmac('sha256', 'test-otp-secret-key-32chars-min-length')
        .update(code)
        .digest('hex');
      expect(hash).toBe(expected);
      expect(hash).not.toContain(code);
    });
  });

  describe('createChallenge', () => {
    it('should invalidate existing active challenges, generate a 6-digit code, and persist only codeHash', async () => {
      vi.mocked(prisma.otpChallenge.updateMany).mockResolvedValue({ count: 1 });
      vi.mocked(prisma.otpChallenge.create).mockResolvedValue({} as unknown as OtpChallenge);

      const code = await otpService.createChallenge('user-1', 'test@example.com', OtpPurpose.EMAIL_VERIFICATION);

      expect(code).toMatch(/^[0-9]{6}$/);

      // Verify old active challenges are locked/invalidated
      expect(prisma.otpChallenge.updateMany).toHaveBeenCalledWith({
        where: {
          userId: 'user-1',
          purpose: OtpPurpose.EMAIL_VERIFICATION,
          consumedAt: null,
          lockedAt: null,
        },
        data: {
          lockedAt: expect.any(Date),
        },
      });

      // Verify new challenge persists codeHash, not plaintext code
      expect(prisma.otpChallenge.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-1',
          purpose: OtpPurpose.EMAIL_VERIFICATION,
          destination: 'test@example.com',
          codeHash: crypto
            .createHmac('sha256', 'test-otp-secret-key-32chars-min-length')
            .update(code)
            .digest('hex'),
          expiresAt: expect.any(Date),
          attempts: 0,
          maxAttempts: 5,
          resendCount: 0,
          lastSentAt: expect.any(Date),
        }),
      });
    });
  });

  describe('verifyChallenge', () => {
    it('should return true and consume challenge for correct code atomically', async () => {
      const code = '123456';
      const codeHash = crypto
        .createHmac('sha256', 'test-otp-secret-key-32chars-min-length')
        .update(code)
        .digest('hex');

      vi.mocked(prisma.otpChallenge.findUnique).mockResolvedValue({
        id: 'challenge-1',
        userId: 'user-1',
        purpose: OtpPurpose.EMAIL_VERIFICATION,
        codeHash,
        consumedAt: null,
        lockedAt: null,
        expiresAt: new Date(Date.now() + 10000), // future
        attempts: 0,
        maxAttempts: 5,
      } as unknown as OtpChallenge);

      vi.mocked(prisma.otpChallenge.updateMany).mockResolvedValue({ count: 1 });

      const result = await otpService.verifyChallenge('challenge-1', code);

      expect(result).toBe(true);
      expect(prisma.otpChallenge.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'challenge-1',
          consumedAt: null,
          lockedAt: null,
          attempts: { lt: 5 },
          expiresAt: { gt: expect.any(Date) },
        },
        data: { consumedAt: expect.any(Date) },
      });
    });

    it('should prevent replay by rejecting already consumed challenge', async () => {
      vi.mocked(prisma.otpChallenge.findUnique).mockResolvedValue({
        id: 'challenge-1',
        userId: 'user-1',
        purpose: OtpPurpose.EMAIL_VERIFICATION,
        codeHash: crypto.createHmac('sha256', 'test-otp-secret-key-32chars-min-length').update('123456').digest('hex'),
        consumedAt: new Date(),
        lockedAt: null,
        expiresAt: new Date(Date.now() + 10000),
        attempts: 0,
        maxAttempts: 5,
      } as unknown as OtpChallenge);

      const result = await otpService.verifyChallenge('challenge-1', '123456');

      expect(result).toBe(false);
      expect(prisma.otpChallenge.updateMany).not.toHaveBeenCalled();
    });

    it('should reject expired challenge even if code is correct', async () => {
      vi.mocked(prisma.otpChallenge.findUnique).mockResolvedValue({
        id: 'challenge-1',
        userId: 'user-1',
        purpose: OtpPurpose.EMAIL_VERIFICATION,
        codeHash: crypto.createHmac('sha256', 'test-otp-secret-key-32chars-min-length').update('123456').digest('hex'),
        consumedAt: null,
        lockedAt: null,
        expiresAt: new Date(Date.now() - 5000), // past
        attempts: 0,
        maxAttempts: 5,
      } as unknown as OtpChallenge);

      const result = await otpService.verifyChallenge('challenge-1', '123456');

      expect(result).toBe(false);
      expect(prisma.otpChallenge.updateMany).not.toHaveBeenCalled();
    });

    it('should increment attempts atomically on incorrect code and return false', async () => {
      const codeHash = crypto.createHmac('sha256', 'test-otp-secret-key-32chars-min-length').update('123456').digest('hex');

      vi.mocked(prisma.otpChallenge.findUnique)
        .mockResolvedValueOnce({
          id: 'challenge-1',
          userId: 'user-1',
          purpose: OtpPurpose.EMAIL_VERIFICATION,
          codeHash,
          consumedAt: null,
          lockedAt: null,
          expiresAt: new Date(Date.now() + 10000),
          attempts: 1,
          maxAttempts: 5,
        } as unknown as OtpChallenge)
        .mockResolvedValueOnce({
          id: 'challenge-1',
          userId: 'user-1',
          attempts: 2,
          maxAttempts: 5,
          lockedAt: null,
        } as unknown as OtpChallenge); // Mock the read-back

      vi.mocked(prisma.otpChallenge.updateMany).mockResolvedValue({ count: 1 });

      const result = await otpService.verifyChallenge('challenge-1', '654321');

      expect(result).toBe(false);
      expect(prisma.otpChallenge.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'challenge-1',
          consumedAt: null,
          lockedAt: null,
          attempts: { lt: 5 },
          expiresAt: { gt: expect.any(Date) },
        },
        data: { attempts: { increment: 1 } },
      });
    });

    it('should lock challenge when max attempts is reached', async () => {
      const codeHash = crypto.createHmac('sha256', 'test-otp-secret-key-32chars-min-length').update('123456').digest('hex');

      vi.mocked(prisma.otpChallenge.findUnique)
        .mockResolvedValueOnce({
          id: 'challenge-1',
          userId: 'user-1',
          purpose: OtpPurpose.EMAIL_VERIFICATION,
          codeHash,
          consumedAt: null,
          lockedAt: null,
          expiresAt: new Date(Date.now() + 10000),
          attempts: 4,
          maxAttempts: 5,
        } as unknown as OtpChallenge)
        .mockResolvedValueOnce({
          id: 'challenge-1',
          userId: 'user-1',
          attempts: 5,
          maxAttempts: 5,
          lockedAt: null,
        } as unknown as OtpChallenge); // Mock read-back after increment

      vi.mocked(prisma.otpChallenge.updateMany).mockResolvedValue({ count: 1 });

      const result = await otpService.verifyChallenge('challenge-1', '999999');

      expect(result).toBe(false);
      expect(prisma.otpChallenge.updateMany).toHaveBeenCalledWith({
        where: { id: 'challenge-1', lockedAt: null },
        data: { lockedAt: expect.any(Date) },
      });
    });

    it('should reject already locked challenge immediately', async () => {
      vi.mocked(prisma.otpChallenge.findUnique).mockResolvedValue({
        id: 'challenge-1',
        userId: 'user-1',
        purpose: OtpPurpose.EMAIL_VERIFICATION,
        codeHash: crypto.createHmac('sha256', 'test-otp-secret-key-32chars-min-length').update('123456').digest('hex'),
        consumedAt: null,
        lockedAt: new Date(),
        expiresAt: new Date(Date.now() + 10000),
        attempts: 5,
        maxAttempts: 5,
      } as unknown as OtpChallenge);

      const result = await otpService.verifyChallenge('challenge-1', '123456');

      expect(result).toBe(false);
      expect(prisma.otpChallenge.updateMany).not.toHaveBeenCalled();
    });
  });

  describe('resendChallenge', () => {
    it('should throttle resend if cooldown has not elapsed', async () => {
      vi.mocked(prisma.otpChallenge.findUnique).mockResolvedValue({
        id: 'challenge-1',
        consumedAt: null,
        lockedAt: null,
        expiresAt: new Date(Date.now() + 10000),
        lastSentAt: new Date(Date.now() - 20000), // only 20s ago, cooldown is 60s
      } as unknown as OtpChallenge);

      await expect(otpService.resendChallenge('challenge-1')).rejects.toThrow(/wait/i);
    });

    it('should issue new code, send email internally, and return metadata if cooldown has elapsed', async () => {
      vi.mocked(prisma.otpChallenge.findUnique).mockResolvedValue({
        id: 'challenge-1',
        userId: 'user-1',
        channel: OtpChannel.EMAIL,
        destination: 'test@example.com',
        consumedAt: null,
        lockedAt: null,
        expiresAt: new Date(Date.now() + 10000),
        lastSentAt: new Date(Date.now() - 65000), // 65s ago
        resendCount: 1,
      } as unknown as OtpChallenge);

      vi.mocked(emailService.sendAccountVerificationOtp).mockResolvedValue(true);
      vi.mocked(prisma.otpChallenge.update).mockResolvedValue({} as unknown as OtpChallenge);

      const result = await otpService.resendChallenge('challenge-1');

      expect(result.success).toBe(true);
      expect(result.expiresAt).toBeInstanceOf(Date);
      
      expect(emailService.sendAccountVerificationOtp).toHaveBeenCalledWith(
        'test@example.com',
        expect.stringMatching(/^[0-9]{6}$/),
        'user-1'
      );

      expect(prisma.otpChallenge.update).toHaveBeenCalledWith({
        where: { id: 'challenge-1' },
        data: expect.objectContaining({
          codeHash: expect.any(String),
          attempts: 0,
          lockedAt: null,
          resendCount: { increment: 1 },
          lastSentAt: expect.any(Date),
        }),
      });
    });
  });

  describe('verifyEmailOtp', () => {
    it('should verify challenge and update User.emailVerifiedAt on success', async () => {
      const code = '123456';
      const codeHash = crypto
        .createHmac('sha256', 'test-otp-secret-key-32chars-min-length')
        .update(code)
        .digest('hex');

      vi.mocked(prisma.otpChallenge.findUnique).mockResolvedValue({
        id: 'challenge-1',
        userId: 'user-1',
        purpose: OtpPurpose.EMAIL_VERIFICATION,
        codeHash,
        consumedAt: null,
        lockedAt: null,
        expiresAt: new Date(Date.now() + 10000),
        attempts: 0,
        maxAttempts: 5,
      } as unknown as OtpChallenge);

      vi.mocked(prisma.otpChallenge.updateMany).mockResolvedValue({ count: 1 });
      vi.mocked(prisma.user.update).mockResolvedValue({} as unknown as User);

      const result = await otpService.verifyEmailOtp('challenge-1', code);

      expect(result).toBe(true);
      expect(prisma.user.update).toHaveBeenCalledWith({
        where: { id: 'user-1' },
        data: {
          emailVerifiedAt: expect.any(Date),
        },
      });
    });
  });
});
