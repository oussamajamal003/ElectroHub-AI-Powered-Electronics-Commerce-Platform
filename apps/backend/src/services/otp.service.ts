import crypto from 'crypto';
import { prisma } from '../lib/prisma.js';
import { OtpChannel, OtpPurpose } from '@prisma/client';
import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';
import { emailService } from './email.service.js';

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
   * Hashes a plaintext code using HMAC SHA-256 and a server-side secret.
   */
  hashCode(code: string): string {
    const secret = env.OTP_HASH_SECRET;
    if (!secret) {
      throw new Error('OTP_HASH_SECRET environment variable is missing');
    }
    return crypto.createHmac('sha256', secret).update(code).digest('hex');
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
   * Atomic operations prevent concurrent verification races.
   */
  async verifyChallenge(challengeId: string, code: string): Promise<boolean> {
    const challenge = await prisma.otpChallenge.findUnique({
      where: { id: challengeId },
    });

    if (!challenge) {
      logger.warn('OTP_VERIFICATION_FAILURE', { challengeId, reason: 'not_found' });
      return false;
    }

    if (challenge.consumedAt) {
      logger.warn('OTP_VERIFICATION_FAILURE', { challengeId, reason: 'already_consumed' });
      return false;
    }

    if (challenge.lockedAt) {
      logger.warn('OTP_LOCKED', { challengeId, reason: 'already_locked' });
      return false;
    }

    if (challenge.expiresAt < new Date()) {
      logger.warn('OTP_EXPIRED', { challengeId });
      return false;
    }

    const isMatch = this.compareCodeHash(code, challenge.codeHash);

    if (isMatch) {
      // Atomic consumption
      const result = await prisma.otpChallenge.updateMany({
        where: { id: challengeId, consumedAt: null },
        data: { consumedAt: new Date() },
      });

      if (result.count === 0) {
        logger.warn('OTP_VERIFICATION_FAILURE', { challengeId, reason: 'already_consumed_concurrent' });
        return false;
      }

      logger.info('OTP_VERIFICATION_SUCCESS', {
        challengeId,
        userId: challenge.userId,
        purpose: challenge.purpose,
      });
      return true;
    }

    // Atomic increment for wrong code
    await prisma.otpChallenge.updateMany({
      where: { id: challengeId, consumedAt: null, lockedAt: null },
      data: { attempts: { increment: 1 } },
    });

    // Check if it should be locked
    const updated = await prisma.otpChallenge.findUnique({ where: { id: challengeId } });
    if (updated && updated.attempts >= updated.maxAttempts && !updated.lockedAt) {
      await prisma.otpChallenge.updateMany({
        where: { id: challengeId, lockedAt: null },
        data: { lockedAt: new Date() },
      });
      logger.warn('OTP_LOCKED', {
        challengeId,
        userId: updated.userId,
        attempts: updated.attempts,
      });
    } else if (updated) {
      logger.warn('OTP_VERIFICATION_FAILURE', {
        challengeId,
        attempts: updated.attempts,
        remainingAttempts: Math.max(0, updated.maxAttempts - updated.attempts),
      });
    }

    return false;
  }

  /**
   * Resend an OTP for an active challenge with server-side throttling.
   * Delivers via EmailService and returns metadata without exposing the plaintext OTP.
   */
  async resendChallenge(
    challengeId: string,
    cooldownMs: number = this.resendCooldownMs
  ): Promise<{ success: boolean; expiresAt: Date; resendAvailableAt: Date }> {
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

    // Send email using internal delivery path
    let deliverySuccess = false;
    if (challenge.channel === OtpChannel.EMAIL) {
      deliverySuccess = await emailService.sendAccountVerificationOtp(
        challenge.destination,
        newCode,
        challenge.userId
      );
    }

    if (!deliverySuccess) {
      logger.error('OTP_RESEND_DELIVERY_FAILED', { challengeId });
      throw new Error('Failed to deliver the new verification code.');
    }

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

    return { 
      success: true, 
      expiresAt: newExpiresAt, 
      resendAvailableAt: new Date(Date.now() + cooldownMs) 
    };
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
