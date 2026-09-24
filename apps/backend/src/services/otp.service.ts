import crypto from 'crypto';
import { prisma } from '../lib/prisma.js';
import { OtpChannel, OtpPurpose } from '@prisma/client';
import { logger } from '../utils/logger.js';

export interface VerifyChallengeResult {
  success: boolean;
  reason?: 'not_found' | 'expired' | 'locked' | 'already_consumed' | 'invalid_code';
  remainingAttempts?: number;
}

export class OtpService {
  private readonly defaultTtlMs = 10 * 60 * 1000; // 10 minutes
  private readonly maxAttempts = 5;
  private readonly resendCooldownMs = 60 * 1000; // 60 seconds

  /**
   * Generates a cryptographically secure 6-digit numeric OTP.
   */
  generateCode(): string {
    return crypto.randomInt(100000, 1000000).toString();
  }

  /**
   * Hashes a plaintext code using SHA-256.
   */
  hashCode(code: string): string {
    return crypto.createHash('sha256').update(code).digest('hex');
  }

  /**
   * Timing-safe verification of code against codeHash.
   */
  private compareCodeHash(code: string, codeHash: string): boolean {
    const inputHash = this.hashCode(code);
    const inputBuffer = Buffer.from(inputHash, 'hex');
    const targetBuffer = Buffer.from(codeHash, 'hex');

    if (inputBuffer.length !== targetBuffer.length) {
      return false;
    }

    return crypto.timingSafeEqual(inputBuffer, targetBuffer);
  }

  /**
   * Helper to mask destination in logs.
   */
  private maskDestination(destination: string): string {
    const parts = destination.split('@');
    if (parts.length !== 2) return '[REDACTED]';
    const [name, domain] = parts;
    if (name.length <= 2) {
      return `${name[0]}*@${domain}`;
    }
    return `${name[0]}***${name[name.length - 1]}@${domain}`;
  }

  /**
   * Create a new OTP challenge.
   * Deterministic Policy: Any existing unconsumed, unlocked challenges
   * for this (userId, purpose) are locked/invalidated first.
   * Returns the plaintext 6-digit code for delivery (never persisted).
   */
  async createChallenge(
    userId: string,
    destination: string,
    purpose: OtpPurpose,
    ttlMs: number = this.defaultTtlMs
  ): Promise<string> {
    const normalizedDestination = destination.toLowerCase().trim();

    // 1. Invalidate previous active challenges for this user and purpose
    await prisma.otpChallenge.updateMany({
      where: {
        userId,
        purpose,
        consumedAt: null,
        lockedAt: null,
      },
      data: {
        lockedAt: new Date(),
      },
    });

    // 2. Generate and hash new 6-digit code
    const code = this.generateCode();
    const codeHash = this.hashCode(code);
    const expiresAt = new Date(Date.now() + ttlMs);

    // 3. Persist new challenge
    await prisma.otpChallenge.create({
      data: {
        userId,
        purpose,
        channel: OtpChannel.EMAIL,
        destination: normalizedDestination,
        codeHash,
        expiresAt,
        attempts: 0,
        maxAttempts: this.maxAttempts,
        resendCount: 0,
        lastSentAt: new Date(),
      },
    });

    logger.info('OTP_CREATED', {
      userId,
      purpose,
      destination: this.maskDestination(normalizedDestination),
      expiresAt,
    });

    return code;
  }

  /**
   * Verify an OTP challenge.
   * Returns boolean (or boolean compatible).
   * Enforces expiration, attempt limits, single-use consumption, and locking.
   */
  async verifyChallenge(challengeId: string, code: string): Promise<boolean> {
    const challenge = await prisma.otpChallenge.findUnique({
      where: { id: challengeId },
    });

    if (!challenge) {
      logger.warn('OTP_VERIFICATION_FAILURE', { challengeId, reason: 'not_found' });
      return false;
    }

    // 1. Check if already consumed
    if (challenge.consumedAt) {
      logger.warn('OTP_VERIFICATION_FAILURE', { challengeId, reason: 'already_consumed' });
      return false;
    }

    // 2. Check if already locked
    if (challenge.lockedAt) {
      logger.warn('OTP_LOCKED', { challengeId, reason: 'already_locked' });
      return false;
    }

    // 3. Check expiration
    if (challenge.expiresAt < new Date()) {
      logger.warn('OTP_EXPIRED', { challengeId });
      return false;
    }

    // 4. Compare code with hash
    const isMatch = this.compareCodeHash(code, challenge.codeHash);

    if (isMatch) {
      // Consume challenge immediately (replay prevention)
      await prisma.otpChallenge.update({
        where: { id: challengeId },
        data: {
          consumedAt: new Date(),
        },
      });

      logger.info('OTP_VERIFICATION_SUCCESS', {
        challengeId,
        userId: challenge.userId,
        purpose: challenge.purpose,
      });

      return true;
    }

    // Wrong code: increment attempt counter
    const newAttempts = challenge.attempts + 1;
    const shouldLock = newAttempts >= challenge.maxAttempts;

    await prisma.otpChallenge.update({
      where: { id: challengeId },
      data: {
        attempts: newAttempts,
        lockedAt: shouldLock ? new Date() : null,
      },
    });

    if (shouldLock) {
      logger.warn('OTP_LOCKED', {
        challengeId,
        userId: challenge.userId,
        attempts: newAttempts,
      });
    } else {
      logger.warn('OTP_VERIFICATION_FAILURE', {
        challengeId,
        attempts: newAttempts,
        remainingAttempts: challenge.maxAttempts - newAttempts,
      });
    }

    return false;
  }

  /**
   * Resend an OTP for an active challenge with server-side throttling.
   * Returns new plaintext 6-digit code.
   */
  async resendChallenge(
    challengeId: string,
    cooldownMs: number = this.resendCooldownMs
  ): Promise<string> {
    const challenge = await prisma.otpChallenge.findUnique({
      where: { id: challengeId },
    });

    if (!challenge) {
      throw new Error('Challenge not found');
    }

    if (challenge.consumedAt) {
      throw new Error('Challenge has already been consumed');
    }

    if (challenge.lockedAt) {
      throw new Error('Challenge is locked due to too many failed attempts');
    }

    // Check throttle cooldown
    if (challenge.lastSentAt) {
      const elapsed = Date.now() - challenge.lastSentAt.getTime();
      if (elapsed < cooldownMs) {
        const waitSeconds = Math.ceil((cooldownMs - elapsed) / 1000);
        logger.warn('OTP_RESEND_THROTTLED', { challengeId, waitSeconds });
        throw new Error(`Please wait ${waitSeconds}s before requesting a new code.`);
      }
    }

    // Issue new code and reset attempts for this challenge
    const newCode = this.generateCode();
    const newCodeHash = this.hashCode(newCode);
    const newExpiresAt = new Date(Date.now() + this.defaultTtlMs);

    await prisma.otpChallenge.update({
      where: { id: challengeId },
      data: {
        codeHash: newCodeHash,
        attempts: 0,
        lockedAt: null,
        expiresAt: newExpiresAt,
        resendCount: { increment: 1 },
        lastSentAt: new Date(),
      },
    });

    logger.info('OTP_RESENT', {
      challengeId,
      userId: challenge.userId,
      resendCount: challenge.resendCount + 1,
    });

    return newCode;
  }

  /**
   * Verify email OTP and update User.emailVerifiedAt on success.
   */
  async verifyEmailOtp(challengeId: string, code: string): Promise<boolean> {
    const challenge = await prisma.otpChallenge.findUnique({
      where: { id: challengeId },
    });

    if (!challenge || challenge.purpose !== OtpPurpose.EMAIL_VERIFICATION) {
      return false;
    }

    const verified = await this.verifyChallenge(challengeId, code);

    if (verified) {
      await prisma.user.update({
        where: { id: challenge.userId },
        data: {
          emailVerifiedAt: new Date(),
        },
      });
      return true;
    }

    return false;
  }
}

export const otpService = new OtpService();
