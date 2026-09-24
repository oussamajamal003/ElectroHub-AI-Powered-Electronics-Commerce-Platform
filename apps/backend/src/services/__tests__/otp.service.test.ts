import { describe, it, expect, beforeEach, vi } from 'vitest';
import { OtpService } from '../otp.service.js';
import { prisma } from '../../lib/prisma.js';
import { OtpPurpose, OtpChallenge, User } from '@prisma/client';
import crypto from 'crypto';

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

    it('should hash code predictably with sha256 without storing plaintext', () => {
      const code = '483921';
      const hash = otpService.hashCode(code);
      const expected = crypto.createHash('sha256').update(code).digest('hex');
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
          codeHash: crypto.createHash('sha256').update(code).digest('hex'),
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
    it('should return true and consume challenge for correct code', async () => {
      const code = '123456';
      const codeHash = crypto.createHash('sha256').update(code).digest('hex');

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

      vi.mocked(prisma.otpChallenge.update).mockResolvedValue({} as unknown as OtpChallenge);

      const result = await otpService.verifyChallenge('challenge-1', code);

      expect(result).toBe(true);
      expect(prisma.otpChallenge.update).toHaveBeenCalledWith({
        where: { id: 'challenge-1' },
        data: { consumedAt: expect.any(Date) },
      });
    });

    it('should prevent replay by rejecting already consumed challenge', async () => {
      vi.mocked(prisma.otpChallenge.findUnique).mockResolvedValue({
        id: 'challenge-1',
        userId: 'user-1',
        purpose: OtpPurpose.EMAIL_VERIFICATION,
        codeHash: crypto.createHash('sha256').update('123456').digest('hex'),
        consumedAt: new Date(),
        lockedAt: null,
        expiresAt: new Date(Date.now() + 10000),
        attempts: 0,
        maxAttempts: 5,
      } as unknown as OtpChallenge);

      const result = await otpService.verifyChallenge('challenge-1', '123456');

      expect(result).toBe(false);
      expect(prisma.otpChallenge.update).not.toHaveBeenCalled();
    });

    it('should reject expired challenge even if code is correct', async () => {
      vi.mocked(prisma.otpChallenge.findUnique).mockResolvedValue({
        id: 'challenge-1',
        userId: 'user-1',
        purpose: OtpPurpose.EMAIL_VERIFICATION,
        codeHash: crypto.createHash('sha256').update('123456').digest('hex'),
        consumedAt: null,
        lockedAt: null,
        expiresAt: new Date(Date.now() - 5000), // past
        attempts: 0,
        maxAttempts: 5,
      } as unknown as OtpChallenge);

      const result = await otpService.verifyChallenge('challenge-1', '123456');

      expect(result).toBe(false);
      expect(prisma.otpChallenge.update).not.toHaveBeenCalled();
    });

    it('should increment attempts on incorrect code and return false', async () => {
      const codeHash = crypto.createHash('sha256').update('123456').digest('hex');

      vi.mocked(prisma.otpChallenge.findUnique).mockResolvedValue({
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

      vi.mocked(prisma.otpChallenge.update).mockResolvedValue({} as unknown as OtpChallenge);

      const result = await otpService.verifyChallenge('challenge-1', '654321');

      expect(result).toBe(false);
      expect(prisma.otpChallenge.update).toHaveBeenCalledWith({
        where: { id: 'challenge-1' },
        data: { attempts: 2, lockedAt: null },
      });
    });

    it('should lock challenge when max attempts is reached', async () => {
      const codeHash = crypto.createHash('sha256').update('123456').digest('hex');

      vi.mocked(prisma.otpChallenge.findUnique).mockResolvedValue({
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

      vi.mocked(prisma.otpChallenge.update).mockResolvedValue({} as unknown as OtpChallenge);

      const result = await otpService.verifyChallenge('challenge-1', '999999');

      expect(result).toBe(false);
      expect(prisma.otpChallenge.update).toHaveBeenCalledWith({
        where: { id: 'challenge-1' },
        data: { attempts: 5, lockedAt: expect.any(Date) },
      });
    });

    it('should reject already locked challenge immediately', async () => {
      vi.mocked(prisma.otpChallenge.findUnique).mockResolvedValue({
        id: 'challenge-1',
        userId: 'user-1',
        purpose: OtpPurpose.EMAIL_VERIFICATION,
        codeHash: crypto.createHash('sha256').update('123456').digest('hex'),
        consumedAt: null,
        lockedAt: new Date(),
        expiresAt: new Date(Date.now() + 10000),
        attempts: 5,
        maxAttempts: 5,
      } as unknown as OtpChallenge);

      const result = await otpService.verifyChallenge('challenge-1', '123456');

      expect(result).toBe(false);
      expect(prisma.otpChallenge.update).not.toHaveBeenCalled();
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

    it('should issue new code and reset attempts if cooldown has elapsed', async () => {
      vi.mocked(prisma.otpChallenge.findUnique).mockResolvedValue({
        id: 'challenge-1',
        consumedAt: null,
        lockedAt: null,
        expiresAt: new Date(Date.now() + 10000),
        lastSentAt: new Date(Date.now() - 65000), // 65s ago
        resendCount: 1,
      } as unknown as OtpChallenge);

      vi.mocked(prisma.otpChallenge.update).mockResolvedValue({} as unknown as OtpChallenge);

      const code = await otpService.resendChallenge('challenge-1');

      expect(code).toMatch(/^[0-9]{6}$/);
      expect(prisma.otpChallenge.update).toHaveBeenCalledWith({
        where: { id: 'challenge-1' },
        data: expect.objectContaining({
          codeHash: crypto.createHash('sha256').update(code).digest('hex'),
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
      const codeHash = crypto.createHash('sha256').update(code).digest('hex');

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

      vi.mocked(prisma.otpChallenge.update).mockResolvedValue({} as unknown as OtpChallenge);
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
