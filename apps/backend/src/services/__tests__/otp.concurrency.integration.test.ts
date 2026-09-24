import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { otpService } from '../otp.service.js';
import { prisma } from '../../lib/prisma.js';
import { OtpPurpose } from '@prisma/client';
import { env } from '../../config/env.js';

describe('OtpService Concurrency Integration', () => {
  const testUserId = 'test-concurrency-user';
  const destination = 'concurrency@example.com';
  let testCode: string;
  let testChallengeId: string;

  beforeAll(async () => {
    // This test requires a real database connection.
    // If it fails immediately, the database is unreachable.
    env.OTP_HASH_SECRET = 'test-otp-secret-key-32chars-min-length';
    await prisma.user.upsert({
      where: { email: destination },
      update: {},
      create: {
        id: testUserId,
        email: destination,
        firstName: 'Concurrency',
        lastName: 'Test',
        passwordHash: 'dummy',
        role: 'CUSTOMER',
      },
    });
  });

  afterAll(async () => {
    await prisma.otpChallenge.deleteMany({ where: { userId: testUserId } });
    await prisma.user.delete({ where: { id: testUserId } });
  });

  it('TEST 1: Simultaneous verifyChallenge() calls should allow exactly one success', async () => {
    // Create valid OTP
    testCode = await otpService.createChallenge(testUserId, destination, OtpPurpose.EMAIL_VERIFICATION);
    
    const latestChallenge = await prisma.otpChallenge.findFirst({
      where: { userId: testUserId, purpose: OtpPurpose.EMAIL_VERIFICATION, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    
    expect(latestChallenge).not.toBeNull();
    testChallengeId = latestChallenge!.id;

    // Launch multiple simultaneous requests
    const attempts = 20;
    const promises = Array.from({ length: attempts }).map(() =>
      otpService.verifyChallenge(testChallengeId, testCode)
    );

    const results = await Promise.all(promises);

    // Exactly one should be true, the rest false
    const successes = results.filter((r) => r === true);
    expect(successes.length).toBe(1);
    expect(results.length - successes.length).toBe(attempts - 1);
  });

  it('TEST 2: Concurrent incorrect OTP attempts should respect maxAttempts', async () => {
    await otpService.createChallenge(testUserId, destination, OtpPurpose.EMAIL_VERIFICATION);
    
    const challenge = await prisma.otpChallenge.findFirst({
      where: { userId: testUserId, purpose: OtpPurpose.EMAIL_VERIFICATION, consumedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    
    expect(challenge).not.toBeNull();
    const challengeId = challenge!.id;

    // Launch multiple simultaneous wrong requests
    const attempts = 20; // maxAttempts is 5
    const promises = Array.from({ length: attempts }).map(() =>
      otpService.verifyChallenge(challengeId, '000000') // wrong code
    );

    const results = await Promise.all(promises);

    // All should fail
    const successes = results.filter((r) => r === true);
    expect(successes.length).toBe(0);

    // Check DB state
    const updated = await prisma.otpChallenge.findUnique({ where: { id: challengeId } });
    expect(updated?.attempts).toBe(5); // Should max out at 5 and lock, though depending on race might be slightly higher, but lockedAt is set
    expect(updated?.lockedAt).not.toBeNull();
  });
});
