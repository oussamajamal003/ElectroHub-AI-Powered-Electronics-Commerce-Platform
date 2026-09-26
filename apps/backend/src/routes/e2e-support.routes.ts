import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../lib/prisma.js';

const router = Router();
const runIdSchema = z.string().uuid();
const testEmailSchema = z.string().email().regex(/^e2e-[a-z0-9-]+@electrohub\.invalid$/i);
const purposeSchema = z.enum(['EMAIL_VERIFICATION', 'PASSWORD_RESET', 'EMAIL_CHANGE']);

router.use((request, response, next) => {
  const expected = process.env.E2E_TEST_SUPPORT_TOKEN;
  const provided = request.get('x-e2e-test-support-token') ?? '';
  const expectedBuffer = Buffer.from(expected ?? '');
  const providedBuffer = Buffer.from(provided);
  if (process.env.NODE_ENV !== 'test' || !expected || expectedBuffer.length !== providedBuffer.length || !timingSafeEqual(expectedBuffer, providedBuffer)) {
    response.sendStatus(404);
    return;
  }
  next();
});

router.post('/expire-otp', async (request, response, next) => {
  try {
    const body = z.object({ email: testEmailSchema, purpose: purposeSchema }).parse(request.body);
    const result = await prisma.otpChallenge.updateMany({
      where: { destination: body.email.toLowerCase(), purpose: body.purpose, consumedAt: null, lockedAt: null },
      data: { expiresAt: new Date(0) },
    });
    response.json({ expired: result.count });
  } catch (error) {
    next(error);
  }
});

router.post('/expire-reset-authorization', async (request, response, next) => {
  try {
    const body = z.object({ email: testEmailSchema }).parse(request.body);
    const user = await prisma.user.findUnique({ where: { email: body.email.toLowerCase() }, select: { id: true } });
    const result = user
      ? await prisma.passwordResetToken.updateMany({
        where: { userId: user.id, consumedAt: null },
        data: { expiresAt: new Date(0) },
      })
      : { count: 0 };
    response.json({ expired: result.count });
  } catch (error) {
    next(error);
  }
});

router.post('/cleanup', async (request, response, next) => {
  try {
    const { runId } = z.object({ runId: runIdSchema }).parse(request.body);
    const marker = `-${runId}-`;
    const users = await prisma.user.findMany({
      where: {
        OR: [
          { email: { startsWith: 'e2e-', contains: marker, endsWith: '@electrohub.invalid' } },
          { pendingEmail: { startsWith: 'e2e-', contains: marker, endsWith: '@electrohub.invalid' } },
        ],
      },
      select: { id: true },
    });
    const userIds = users.map((user) => user.id);
    if (!userIds.length) {
      const deliveryCount = await prisma.emailDelivery.count({
        where: { recipient: { startsWith: 'e2e-', contains: marker, endsWith: '@electrohub.invalid' } },
      });
      if (!deliveryCount) {
        response.json({ users: 0, emailDeliveries: 0, securityEvents: 0, refreshTokens: 0, otpChallenges: 0, resetAuthorizations: 0 });
        return;
      }
    }
    if (userIds.length) {
      const orders = await prisma.order.count({ where: { userId: { in: userIds } } });
      if (orders > 0) {
        response.status(409).json({ error: 'E2E cleanup refused because a marked account owns an order.' });
        return;
      }
    }

    const counts = await prisma.$transaction(async (transaction) => {
      const deliveries = await transaction.emailDelivery.deleteMany({
        where: {
          OR: [
            { userId: { in: userIds } },
            { recipient: { startsWith: 'e2e-', contains: marker, endsWith: '@electrohub.invalid' } },
          ],
        },
      });
      const securityEvents = await transaction.securityEvent.deleteMany({ where: { userId: { in: userIds } } });
      const refreshTokens = await transaction.refreshToken.deleteMany({ where: { userId: { in: userIds } } });
      const otpChallenges = await transaction.otpChallenge.deleteMany({ where: { userId: { in: userIds } } });
      const resetAuthorizations = await transaction.passwordResetToken.deleteMany({ where: { userId: { in: userIds } } });
      const deletedUsers = await transaction.user.deleteMany({ where: { id: { in: userIds } } });
      return {
        users: deletedUsers.count,
        emailDeliveries: deliveries.count,
        securityEvents: securityEvents.count,
        refreshTokens: refreshTokens.count,
        otpChallenges: otpChallenges.count,
        resetAuthorizations: resetAuthorizations.count,
      };
    }, { maxWait: 10_000, timeout: 30_000 });
    response.json(counts);
  } catch (error) {
    next(error);
  }
});

export default router;
