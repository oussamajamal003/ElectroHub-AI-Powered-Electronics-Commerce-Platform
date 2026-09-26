import crypto from 'crypto';
import { prisma } from '../lib/prisma.js';
import { OtpChannel, OtpPurpose, SecurityEventType } from '@prisma/client';
import { logger } from '../utils/logger.js';
import { env } from '../config/env.js';
import { emailService } from './email.service.js';

export type OtpFailureCode = 'OTP_INCORRECT' | 'OTP_EXPIRED' | 'OTP_CONSUMED' | 'OTP_ATTEMPTS_EXHAUSTED' | 'OTP_INVALID';
export type OtpVerificationOutcome = 'VERIFIED' | OtpFailureCode;

const otpFailureMessages: Record<OtpFailureCode, string> = {
  OTP_INCORRECT: 'Incorrect verification code. Please try again.',
  OTP_EXPIRED: 'This verification code has expired. Request a new code.',
  OTP_CONSUMED: 'This verification code is no longer valid. Request a new code.',
  OTP_ATTEMPTS_EXHAUSTED: 'Too many incorrect attempts. Request a new verification code.',
  OTP_INVALID: 'The verification code is no longer valid. Request a new code.',
};

export class OtpVerificationError extends Error {
  readonly statusCode: number;
  readonly code: OtpFailureCode;

  constructor(code: OtpFailureCode) {
    super(otpFailureMessages[code]);
    this.name = 'OtpVerificationError';
    this.code = code;
    this.statusCode = code === 'OTP_ATTEMPTS_EXHAUSTED' ? 429 : 400;
  }
}

export class OtpDeliveryError extends Error {
  readonly statusCode = 503;
  readonly code = 'OTP_DELIVERY_FAILED';

  constructor() {
    super('We could not send a verification code. Please try again shortly.');
    this.name = 'OtpDeliveryError';
  }
}

export const OTP_CONFIG = {
  TTL_SECONDS: 60,
  TTL_MS: 60 * 1000,
  MAX_ATTEMPTS: 5,
  RESEND_COOLDOWN_SECONDS: 60,
  RESEND_COOLDOWN_MS: 60 * 1000,
} as const;

export class OtpService {
  private readonly defaultTtlMs = OTP_CONFIG.TTL_MS; // 60 seconds (1 minute)
  private readonly maxAttempts = OTP_CONFIG.MAX_ATTEMPTS;
  private readonly resendCooldownMs = OTP_CONFIG.RESEND_COOLDOWN_MS; // 60 seconds

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
    const secret = env.OTP_HASH_SECRET || (env.NODE_ENV !== 'production' ? 'development_otp_fallback_secret_12345678' : undefined);
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
    return (await this.verifyChallengeWithOutcome(challengeId, code)) === 'VERIFIED';
  }

  async verifyChallengeWithOutcome(challengeId: string, code: string): Promise<OtpVerificationOutcome> {
    const challenge = await prisma.otpChallenge.findUnique({
      where: { id: challengeId },
    });

    if (!challenge) {
      logger.warn('OTP_VERIFICATION_FAILURE', { challengeId, reason: 'not_found' });
      return 'OTP_INVALID';
    }

    const now = new Date();

    if (challenge.consumedAt) {
      logger.warn('OTP_VERIFICATION_FAILURE', { challengeId, reason: 'already_consumed' });
      return 'OTP_CONSUMED';
    }

    if (challenge.lockedAt) {
      logger.warn('OTP_LOCKED', { challengeId, reason: 'already_locked' });
      return 'OTP_ATTEMPTS_EXHAUSTED';
    }

    if (challenge.expiresAt < now) {
      logger.warn('OTP_EXPIRED', { challengeId });
      return 'OTP_EXPIRED';
    }

    const isMatch = this.compareCodeHash(code, challenge.codeHash);

    if (isMatch) {
      // Atomic consumption
      const result = await prisma.otpChallenge.updateMany({
        where: { 
          id: challengeId, 
          consumedAt: null, 
          lockedAt: null,
          expiresAt: { gt: now },
          attempts: { lt: challenge.maxAttempts },
          codeHash: challenge.codeHash
        },
        data: { consumedAt: now },
      });

      if (result.count === 0) {
        logger.warn('OTP_VERIFICATION_FAILURE', { challengeId, reason: 'already_consumed_or_locked_concurrent' });
        return this.getChallengeFailureOutcome(challengeId);
      }

      logger.info('OTP_VERIFICATION_SUCCESS', {
        challengeId,
        userId: challenge.userId,
        purpose: challenge.purpose,
      });

      return 'VERIFIED';
    }

    // Atomic increment for wrong code
    await prisma.otpChallenge.updateMany({
      where: { 
        id: challengeId, 
        consumedAt: null, 
        lockedAt: null,
        attempts: { lt: challenge.maxAttempts },
        codeHash: challenge.codeHash
      },
      data: { attempts: { increment: 1 } },
    });

    // Check if it reached maxAttempts and lock it atomically
    const lockResult = await prisma.otpChallenge.updateMany({
      where: {
        id: challengeId,
        consumedAt: null,
        lockedAt: null,
        attempts: { gte: challenge.maxAttempts },
        codeHash: challenge.codeHash
      },
      data: { lockedAt: now },
    });

    if (lockResult.count > 0) {
      logger.warn('OTP_LOCKED', { challengeId, userId: challenge.userId });
      return 'OTP_ATTEMPTS_EXHAUSTED';
    } else {
      logger.warn('OTP_VERIFICATION_FAILURE', { challengeId, reason: 'wrong_code' });
    }

    return this.getChallengeFailureOutcome(challengeId, 'OTP_INCORRECT');
  }

  private async getChallengeFailureOutcome(
    challengeId: string,
    fallback: OtpFailureCode = 'OTP_INVALID'
  ): Promise<OtpFailureCode> {
    const challenge = await prisma.otpChallenge.findUnique({ where: { id: challengeId } });
    if (!challenge) return 'OTP_INVALID';
    if (challenge.consumedAt) return 'OTP_CONSUMED';
    if (challenge.lockedAt || challenge.attempts >= challenge.maxAttempts) return 'OTP_ATTEMPTS_EXHAUSTED';
    if (challenge.expiresAt <= new Date()) return 'OTP_EXPIRED';
    return fallback;
  }

  async getLatestChallengeIdByEmail(email: string, purpose: OtpPurpose): Promise<string | null> {
    const normalizedEmail = email.toLowerCase().trim();
    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } })
      ?? await prisma.user.findUnique({ where: { pendingEmail: normalizedEmail } });
    if (!user) return null;
    const challenge = await prisma.otpChallenge.findFirst({
      where: { userId: user.id, purpose, destination: normalizedEmail },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    return challenge?.id ?? null;
  }

  async getLatestChallengeIdByUserAndDestination(userId: string, destination: string, purpose: OtpPurpose): Promise<string | null> {
    const challenge = await prisma.otpChallenge.findFirst({
      where: { userId, destination: destination.toLowerCase().trim(), purpose },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });
    return challenge?.id ?? null;
  }

  async checkChallengeForAtomicConsumption(challengeId: string, code: string): Promise<OtpVerificationOutcome> {
    const challenge = await prisma.otpChallenge.findUnique({ where: { id: challengeId } });
    if (!challenge) return 'OTP_INVALID';
    if (challenge.consumedAt) return 'OTP_CONSUMED';
    if (challenge.lockedAt || challenge.attempts >= challenge.maxAttempts) return 'OTP_ATTEMPTS_EXHAUSTED';
    if (challenge.expiresAt <= new Date()) return 'OTP_EXPIRED';
    if (this.compareCodeHash(code, challenge.codeHash)) return 'VERIFIED';
    return this.verifyChallengeWithOutcome(challengeId, code);
  }

  /**
   * Find the most recent active challenge ID by email and purpose.
   */
  async getChallengeIdByEmail(email: string, purpose: OtpPurpose): Promise<string | null> {
    const normalizedEmail = email.toLowerCase().trim();
    const user = await prisma.user.findUnique({ where: { email: normalizedEmail } })
      ?? await prisma.user.findUnique({ where: { pendingEmail: normalizedEmail } });
    if (!user) return null;

    const challenge = await prisma.otpChallenge.findFirst({
      where: {
        userId: user.id,
        purpose,
        destination: normalizedEmail,
        consumedAt: null,
        lockedAt: null,
      },
      orderBy: { createdAt: 'desc' }
    });
    return challenge?.id || null;
  }

  matchesCode(code: string, codeHash: string): boolean {
    return this.compareCodeHash(code, codeHash);
  }

  async getChallengeIdByUserAndDestination(userId: string, destination: string, purpose: OtpPurpose): Promise<string | null> {
    const normalizedDestination = destination.toLowerCase().trim();
    const challenge = await prisma.otpChallenge.findFirst({
      where: {
        userId,
        destination: normalizedDestination,
        purpose,
        consumedAt: null,
        lockedAt: null,
      },
      orderBy: { createdAt: 'desc' }
    });
    return challenge?.id || null;
  }

  async getActiveChallengeForUser(userId: string, purpose: OtpPurpose): Promise<{ id: string; destination: string; codeHash: string } | null> {
    return prisma.otpChallenge.findFirst({
      where: { userId, purpose, consumedAt: null, lockedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, destination: true, codeHash: true },
    });
  }

  /**
   * Resend an OTP for an active challenge with server-side throttling.
   * Delivers via EmailService and returns metadata without exposing the plaintext OTP.
   * 
   * RESEND STATE ARCHITECTURE:
   * - Concurrency behavior: Atomic `updateMany` claims the resend window based on `lastSentAt` <= (now - cooldownMs).
   * - Which OTP is authoritative: The codeHash is committed BEFORE delivery. The database is ALWAYS authoritative.
   * - Crash behavior / Brevo fails: If delivery fails or the process crashes post-DB commit, the new code is authoritative but undelivered. The user must wait for the cooldown to retry.
   * - Post-Brevo failure: Since DB update happens BEFORE Brevo, there's no risk of sending an unpersisted code.
   */
  async resendChallenge(
    challengeId: string,
    cooldownMs: number = this.resendCooldownMs
  ): Promise<{ success: boolean; expiresAt: Date; resendAvailableAt: Date }> {
    const now = new Date();
    const thresholdDate = new Date(Date.now() - cooldownMs);
    const newCode = this.generateCode();
    const newCodeHash = this.hashCode(newCode);
    const newExpiresAt = new Date(Date.now() + this.defaultTtlMs);

    // 1. Atomically claim the resend opportunity and persist the new code.
    const claimResult = await prisma.otpChallenge.updateMany({
      where: {
        id: challengeId,
        consumedAt: null,
        lockedAt: null,
        OR: [
          { lastSentAt: null },
          { lastSentAt: { lte: thresholdDate } }
        ]
      },
      data: {
        codeHash: newCodeHash,
        attempts: 0,
        expiresAt: newExpiresAt,
        resendCount: { increment: 1 },
        lastSentAt: now,
      }
    });

    if (claimResult.count === 0) {
      // Claim failed. Identify reason.
      const current = await prisma.otpChallenge.findUnique({ where: { id: challengeId }});
      if (!current) throw new Error('Challenge not found');
      if (current.consumedAt) throw new Error('Challenge has already been consumed');
      if (current.lockedAt) throw new Error('Challenge is locked due to too many failed attempts');
      
      const elapsed = Date.now() - current.lastSentAt!.getTime();
      const waitSeconds = Math.ceil((cooldownMs - elapsed) / 1000);
      logger.warn('OTP_RESEND_THROTTLED', { challengeId, waitSeconds });
      throw new Error(`Please wait ${waitSeconds}s before requesting a new code.`);
    }

    // 2. We claimed the challenge. We must fetch it to get channel and destination.
    const challenge = await prisma.otpChallenge.findUniqueOrThrow({
      where: { id: challengeId }
    });

    // 3. Attempt delivery
    let deliverySuccess = false;
    try {
      if (challenge.channel === OtpChannel.EMAIL) {
        deliverySuccess = challenge.purpose === OtpPurpose.PASSWORD_RESET
          ? await emailService.sendPasswordResetOtp(challenge.destination, newCode, challenge.userId)
          : await emailService.sendAccountVerificationOtp(challenge.destination, newCode, challenge.userId);
      }
    } catch {
      logger.error('OTP_RESEND_DELIVERY_ERROR', { challengeId, reason: 'email_delivery_failed' });
    }

    if (!deliverySuccess) {
      logger.error('OTP_RESEND_DELIVERY_FAILED', { challengeId });
      // The DB reflects a sent code, but it failed to reach the provider.
      // This is the expected crash boundary behavior.
      throw new OtpDeliveryError();
    }

    logger.info('OTP_RESENT', {
      challengeId,
      userId: challenge.userId,
      resendCount: challenge.resendCount,
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
    return (await this.verifyEmailOtpWithOutcome(challengeId, code)) === 'VERIFIED';
  }

  async verifyEmailOtpWithOutcome(challengeId: string, code: string): Promise<OtpVerificationOutcome> {
    const challenge = await prisma.otpChallenge.findUnique({
      where: { id: challengeId },
    });

    if (!challenge || challenge.purpose !== OtpPurpose.EMAIL_VERIFICATION) {
      return 'OTP_INVALID';
    }

    if (!this.compareCodeHash(code, challenge.codeHash)) {
      return this.verifyChallengeWithOutcome(challengeId, code);
    }

    if (challenge.consumedAt) return 'OTP_CONSUMED';
    if (challenge.lockedAt || challenge.attempts >= challenge.maxAttempts) return 'OTP_ATTEMPTS_EXHAUSTED';
    if (challenge.expiresAt <= new Date()) return 'OTP_EXPIRED';

    const now = new Date();
    const verified = await prisma.$transaction(async (transaction) => {
      const user = await transaction.user.findUnique({ where: { id: challenge.userId } });
      if (!user || user.emailVerifiedAt || (user.email !== challenge.destination && user.pendingEmail !== challenge.destination)) return false;

      const consumed = await transaction.otpChallenge.updateMany({
        where: {
          id: challengeId,
          purpose: OtpPurpose.EMAIL_VERIFICATION,
          codeHash: challenge.codeHash,
          consumedAt: null,
          lockedAt: null,
          expiresAt: { gt: now },
          attempts: { lt: challenge.maxAttempts },
        },
        data: { consumedAt: now },
      });
      if (consumed.count !== 1) return false;

      await transaction.user.update({
        where: { id: user.id },
        data: user.pendingEmail === challenge.destination
          ? { email: challenge.destination, pendingEmail: null, emailVerifiedAt: now }
          : { emailVerifiedAt: now },
      });
      await transaction.securityEvent.create({ data: { userId: user.id, type: SecurityEventType.EMAIL_VERIFIED } });
      return true;
    }, { timeout: 15000 });
    return verified ? 'VERIFIED' : this.getChallengeFailureOutcome(challengeId);
  }
}

export const otpService = new OtpService();
