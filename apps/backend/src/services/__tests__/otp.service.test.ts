import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OtpService, OTP_CONFIG } from '../otp.service.js';
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
      findUniqueOrThrow: vi.fn(),
      update: vi.fn(),
      findFirst: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    securityEvent: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}));

describe('OtpService', () => {
  let otpService: OtpService;

  beforeEach(() => {
    otpService = new OtpService();
    vi.resetAllMocks();
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

    it('should set OTP expiration to exactly 60 seconds (OTP_CONFIG.TTL_MS)', async () => {
      expect(OTP_CONFIG.TTL_SECONDS).toBe(60);
      expect(OTP_CONFIG.TTL_MS).toBe(60000);
      expect(OTP_CONFIG.RESEND_COOLDOWN_SECONDS).toBe(60);
      expect(OTP_CONFIG.RESEND_COOLDOWN_MS).toBe(60000);

      vi.mocked(prisma.otpChallenge.updateMany).mockResolvedValue({ count: 0 });
      vi.mocked(prisma.otpChallenge.create).mockResolvedValue({} as unknown as OtpChallenge);

      const before = Date.now();
      await otpService.createChallenge('user-1', 'test@example.com', OtpPurpose.EMAIL_VERIFICATION);
      const after = Date.now();

      const callData = vi.mocked(prisma.otpChallenge.create).mock.calls[0][0].data;
      const expiresAt = callData.expiresAt as Date;
      expect(expiresAt.getTime()).toBeGreaterThanOrEqual(before + 59000);
      expect(expiresAt.getTime()).toBeLessThanOrEqual(after + 61000);
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
        destination: 'test@example.com',
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
          codeHash,
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

    it('should return OTP_EXPIRED outcome with authoritative message when expired', async () => {
      vi.mocked(prisma.otpChallenge.findUnique).mockResolvedValue({
        id: 'challenge-1',
        userId: 'user-1',
        purpose: OtpPurpose.EMAIL_VERIFICATION,
        codeHash: crypto.createHmac('sha256', 'test-otp-secret-key-32chars-min-length').update('123456').digest('hex'),
        consumedAt: null,
        lockedAt: null,
        expiresAt: new Date(Date.now() - 5000),
        attempts: 0,
        maxAttempts: 5,
      } as unknown as OtpChallenge);

      const outcome = await otpService.verifyChallengeWithOutcome('challenge-1', '123456');
      expect(outcome).toBe('OTP_EXPIRED');
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
        } as unknown as OtpChallenge);

      vi.mocked(prisma.otpChallenge.updateMany).mockResolvedValue({ count: 1 });

      const result = await otpService.verifyChallenge('challenge-1', '654321');

      expect(result).toBe(false);
      expect(prisma.otpChallenge.updateMany).toHaveBeenNthCalledWith(1, {
        where: {
          id: 'challenge-1',
          consumedAt: null,
          lockedAt: null,
          attempts: { lt: 5 },
          codeHash,
        },
        data: { attempts: { increment: 1 } },
      });
      expect(prisma.otpChallenge.updateMany).toHaveBeenNthCalledWith(2, {
        where: {
          id: 'challenge-1',
          consumedAt: null,
          lockedAt: null,
          attempts: { gte: 5 },
          codeHash,
        },
        data: { lockedAt: expect.any(Date) },
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
        } as unknown as OtpChallenge);

      vi.mocked(prisma.otpChallenge.updateMany).mockResolvedValue({ count: 1 });

      const result = await otpService.verifyChallenge('challenge-1', '999999');

      expect(result).toBe(false);
      expect(prisma.otpChallenge.updateMany).toHaveBeenNthCalledWith(2, {
        where: {
          id: 'challenge-1',
          consumedAt: null,
          lockedAt: null,
          attempts: { gte: 5 },
          codeHash,
        },
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
      vi.mocked(prisma.otpChallenge.updateMany).mockResolvedValueOnce({ count: 0 });
      vi.mocked(prisma.otpChallenge.findUnique).mockResolvedValueOnce({
        id: 'challenge-1',
        consumedAt: null,
        lockedAt: null,
        expiresAt: new Date(Date.now() + 10000),
        lastSentAt: new Date(Date.now() - 20000), // only 20s ago, cooldown is 60s
      } as unknown as OtpChallenge);

      await expect(otpService.resendChallenge('challenge-1')).rejects.toThrow(/wait/i);
    });

    it('should issue new code, send email internally, and return metadata if cooldown has elapsed', async () => {
      vi.mocked(prisma.otpChallenge.updateMany).mockResolvedValueOnce({ count: 1 });
      vi.mocked(prisma.otpChallenge.findUniqueOrThrow).mockResolvedValueOnce({
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

      expect(prisma.otpChallenge.updateMany).toHaveBeenCalledWith({
        where: {
          id: 'challenge-1',
          consumedAt: null,
          lockedAt: null,
          OR: [
            { lastSentAt: null },
            { lastSentAt: { lte: expect.any(Date) } }
          ]
        },
        data: expect.objectContaining({
          codeHash: expect.any(String),
          attempts: 0,
          expiresAt: expect.any(Date),
          resendCount: { increment: 1 },
          lastSentAt: expect.any(Date)
        }),
      });
    });

    it('should set fresh 60-second expiry on resendChallenge', async () => {
      vi.mocked(prisma.otpChallenge.updateMany).mockResolvedValueOnce({ count: 1 });
      vi.mocked(prisma.otpChallenge.findUniqueOrThrow).mockResolvedValueOnce({
        id: 'challenge-1',
        userId: 'user-1',
        channel: OtpChannel.EMAIL,
        destination: 'test@example.com',
        consumedAt: null,
        lockedAt: null,
        expiresAt: new Date(Date.now() + 10000),
        lastSentAt: new Date(Date.now() - 65000),
        resendCount: 1,
      } as unknown as OtpChallenge);

      vi.mocked(emailService.sendAccountVerificationOtp).mockResolvedValue(true);

      const before = Date.now();
      const result = await otpService.resendChallenge('challenge-1');
      const after = Date.now();

      expect(result.success).toBe(true);
      expect(result.expiresAt.getTime()).toBeGreaterThanOrEqual(before + 59000);
      expect(result.expiresAt.getTime()).toBeLessThanOrEqual(after + 61000);
      expect(result.resendAvailableAt.getTime()).toBeGreaterThanOrEqual(before + 59000);
      expect(result.resendAvailableAt.getTime()).toBeLessThanOrEqual(after + 61000);
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
        destination: 'test@example.com',
        codeHash,
        consumedAt: null,
        lockedAt: null,
        expiresAt: new Date(Date.now() + 10000),
        attempts: 0,
        maxAttempts: 5,
      } as unknown as OtpChallenge);

      vi.mocked(prisma.user.findUnique).mockResolvedValue({ id: 'user-1', email: 'test@example.com', emailVerifiedAt: null, pendingEmail: null } as unknown as User);
      vi.mocked(prisma.otpChallenge.updateMany).mockResolvedValue({ count: 1 });
      vi.mocked(prisma.user.update).mockResolvedValue({} as unknown as User);
      vi.mocked(prisma.$transaction).mockImplementation(async (callback) => callback(prisma));

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
