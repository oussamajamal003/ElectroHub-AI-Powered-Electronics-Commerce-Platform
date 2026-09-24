import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { otpService } from '../otp.service.js';
import { emailService } from '../email.service.js';
import { prisma } from '../../lib/prisma.js';
import { OtpPurpose, OtpChannel } from '@prisma/client';
import { env } from '../../config/env.js';
import { vi } from 'vitest';

describe('OtpService Concurrency Integration', () => {
  const testUserId = 'test-concurrency-user';
  const destination = 'concurrency@example.com';
  let originalEmailMethod: any;

  beforeAll(async () => {
    // This test requires a real database connection.
    env.OTP_HASH_SECRET = 'test-otp-secret-key-32chars-min-length';
    
    // Mock the email service so we don't actually spam Brevo during integration tests
    originalEmailMethod = emailService.sendAccountVerificationOtp;
    emailService.sendAccountVerificationOtp = vi.fn().mockResolvedValue(true);

    await prisma.user.upsert({
      where: { email: destination },
      update: {},
      create: {
        id: testUserId,
        email: destination,
        firstName: 'Concurrency',
        lastName: 'Test',
        passwordHash: 'dummy',
        role: { connect: { name: 'CUSTOMER' } },
      },
    });
  });

  afterAll(async () => {
    await prisma.otpChallenge.deleteMany({ where: { userId: testUserId } });
    await prisma.user.delete({ where: { id: testUserId } });
    emailService.sendAccountVerificationOtp = originalEmailMethod;
  });

  it('TEST 1: Simultaneous verifyChallenge() calls should allow exactly one success', async () => {
    const testCode = await otpService.createChallenge(testUserId, destination, OtpPurpose.EMAIL_VERIFICATION);
    
    const latestChallenge = await prisma.otpChallenge.findFirstOrThrow({
      where: { userId: testUserId, purpose: OtpPurpose.EMAIL_VERIFICATION, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    
    const attempts = 20;
    const promises = Array.from({ length: attempts }).map(() =>
      otpService.verifyChallenge(latestChallenge.id, testCode)
    );

    const results = await Promise.all(promises);

    const successes = results.filter((r) => r === true);
    expect(successes.length).toBe(1);
    expect(results.length - successes.length).toBe(attempts - 1);

    const updated = await prisma.otpChallenge.findUnique({ where: { id: latestChallenge.id } });
    expect(updated?.consumedAt).not.toBeNull();
  });

  it('TEST 2: Concurrent incorrect OTP attempts should respect maxAttempts', async () => {
    await otpService.createChallenge(testUserId, destination, OtpPurpose.EMAIL_VERIFICATION);
    
    const challenge = await prisma.otpChallenge.findFirstOrThrow({
      where: { userId: testUserId, purpose: OtpPurpose.EMAIL_VERIFICATION, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    
    const attempts = 20; 
    const promises = Array.from({ length: attempts }).map(() =>
      otpService.verifyChallenge(challenge.id, '000000') // wrong code
    );

    const results = await Promise.all(promises);
    const successes = results.filter((r) => r === true);
    expect(successes.length).toBe(0);

    const updated = await prisma.otpChallenge.findUnique({ where: { id: challenge.id } });
    expect(updated?.attempts).toBe(5); // EXACTLY 5
    expect(updated?.lockedAt).not.toBeNull();
  });

  it('TEST 3: Correct OTP vs simultaneous lock race', async () => {
    const testCode = await otpService.createChallenge(testUserId, destination, OtpPurpose.EMAIL_VERIFICATION);
    
    const challenge = await prisma.otpChallenge.findFirstOrThrow({
      where: { userId: testUserId, purpose: OtpPurpose.EMAIL_VERIFICATION, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    
    // Artificially push attempts to 4 (max is 5)
    await prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: { attempts: 4 }
    });

    // Run 1 correct request and 5 wrong requests simultaneously
    const correctPromise = otpService.verifyChallenge(challenge.id, testCode);
    const wrongPromises = Array.from({ length: 5 }).map(() =>
      otpService.verifyChallenge(challenge.id, '000000')
    );

    const results = await Promise.all([correctPromise, ...wrongPromises]);

    const updated = await prisma.otpChallenge.findUnique({ where: { id: challenge.id } });

    // Based on race, either the correct one succeeded before lock, OR it failed because it got locked
    // But importantly, if it locked, it shouldn't be consumed.
    // If it was consumed, it shouldn't be locked.
    if (updated?.consumedAt) {
      expect(updated.lockedAt).toBeNull();
      expect(results[0]).toBe(true);
    } else {
      expect(updated?.lockedAt).not.toBeNull();
      expect(updated?.attempts).toBe(5);
      expect(results[0]).toBe(false);
    }
  });

  it('TEST 4: Expired OTP vs verification', async () => {
    const testCode = await otpService.createChallenge(testUserId, destination, OtpPurpose.EMAIL_VERIFICATION);
    
    const challenge = await prisma.otpChallenge.findFirstOrThrow({
      where: { userId: testUserId, purpose: OtpPurpose.EMAIL_VERIFICATION, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    
    // Artificially expire the challenge
    await prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: { expiresAt: new Date(Date.now() - 1000) }
    });

    const result = await otpService.verifyChallenge(challenge.id, testCode);
    expect(result).toBe(false); // Should fail due to expiry

    const updated = await prisma.otpChallenge.findUnique({ where: { id: challenge.id } });
    expect(updated?.consumedAt).toBeNull();
  });

  it('TEST 5: Concurrent resend should allow exactly one claim', async () => {
    await otpService.createChallenge(testUserId, destination, OtpPurpose.EMAIL_VERIFICATION);
    
    const challenge = await prisma.otpChallenge.findFirstOrThrow({
      where: { userId: testUserId, purpose: OtpPurpose.EMAIL_VERIFICATION, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    
    // Fast-forward lastSentAt to allow a resend
    await prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: { lastSentAt: new Date(Date.now() - 65000) } // past 60s cooldown
    });

    const promises = Array.from({ length: 15 }).map(() =>
      otpService.resendChallenge(challenge.id)
        .then(() => true)
        .catch(() => false) // Failures return false instead of throwing
    );

    const results = await Promise.all(promises);
    
    const successes = results.filter((r) => r === true);
    expect(successes.length).toBe(1); // EXACTLY 1 resend claim allowed
  });

  it('TEST 6: Resend + verify race', async () => {
    const testCode = await otpService.createChallenge(testUserId, destination, OtpPurpose.EMAIL_VERIFICATION);
    
    const challenge = await prisma.otpChallenge.findFirstOrThrow({
      where: { userId: testUserId, purpose: OtpPurpose.EMAIL_VERIFICATION, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    
    // Fast-forward lastSentAt
    await prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: { lastSentAt: new Date(Date.now() - 65000) }
    });

    // Race verify vs resend
    const pVerify = otpService.verifyChallenge(challenge.id, testCode);
    const pResend = otpService.resendChallenge(challenge.id).then(() => true).catch(() => false);

    const [verifyResult, resendResult] = await Promise.all([pVerify, pResend]);

    const updated = await prisma.otpChallenge.findUnique({ where: { id: challenge.id } });

    // If verify won, resend fails (already consumed).
    // If resend won, verify fails (wrong codeHash since resend mutated it).
    if (verifyResult) {
      expect(resendResult).toBe(false);
      expect(updated?.consumedAt).not.toBeNull();
    } else {
      expect(resendResult).toBe(true);
      expect(updated?.consumedAt).toBeNull();
      expect(updated?.resendCount).toBe(1);
    }
  });

  it('TEST 7: Replay attack (consumed challenge cannot be reused)', async () => {
    const testCode = await otpService.createChallenge(testUserId, destination, OtpPurpose.EMAIL_VERIFICATION);
    
    const challenge = await prisma.otpChallenge.findFirstOrThrow({
      where: { userId: testUserId, purpose: OtpPurpose.EMAIL_VERIFICATION, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    
    const firstResult = await otpService.verifyChallenge(challenge.id, testCode);
    expect(firstResult).toBe(true);

    const secondResult = await otpService.verifyChallenge(challenge.id, testCode);
    expect(secondResult).toBe(false);
  });

  it('TEST 8: Resend delivery failure behavior', async () => {
    await otpService.createChallenge(testUserId, destination, OtpPurpose.EMAIL_VERIFICATION);
    
    const challenge = await prisma.otpChallenge.findFirstOrThrow({
      where: { userId: testUserId, purpose: OtpPurpose.EMAIL_VERIFICATION, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    
    await prisma.otpChallenge.update({
      where: { id: challenge.id },
      data: { lastSentAt: new Date(Date.now() - 65000) }
    });

    // Simulate Brevo crash/failure
    emailService.sendAccountVerificationOtp = vi.fn().mockResolvedValue(false);

    let errorThrown = false;
    try {
      await otpService.resendChallenge(challenge.id);
    } catch (e) {
      errorThrown = true;
    }
    expect(errorThrown).toBe(true);

    // Assert that the database state reflects the newly claimed code (incremented resendCount), 
    // honoring the documented crash boundary.
    const updated = await prisma.otpChallenge.findUnique({ where: { id: challenge.id } });
    expect(updated?.resendCount).toBe(1);
    expect(updated?.lastSentAt?.getTime()).toBeGreaterThan(Date.now() - 5000);
  });
});
