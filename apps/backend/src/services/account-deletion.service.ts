import { SecurityEventType } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { verifyPassword } from '../utils/hash.js';
import { createAccountDeletionProof } from './account-deletion-proof.js';
import { REDACTED_SHIPPING } from './delivery-privacy.js';

export class AccountDeletionService {
  async verifyPassword(userId: string, password: string) {
    const user = await prisma.user.findFirst({
      where: { id: userId, isActive: true, role: { name: 'CUSTOMER' } },
      select: { passwordHash: true },
    });
    if (!user?.passwordHash || !await verifyPassword(password, user.passwordHash)) {
      throw new AppError('Your current password is incorrect.', 400, 'ACCOUNT_REAUTH_FAILED');
    }
    return createAccountDeletionProof(userId);
  }

  async verifyGoogleIdentity(userId: string, subject: string) {
    const linked = await prisma.oAuthAccount.findFirst({
      where: {
        provider: 'GOOGLE',
        providerAccountId: subject,
        userId,
        user: { isActive: true, role: { name: 'CUSTOMER' } },
      },
      select: { id: true },
    });
    if (!linked) throw new AppError('The Google account does not match this ElectroHub account.', 403, 'ACCOUNT_REAUTH_IDENTITY_MISMATCH');
    return createAccountDeletionProof(userId);
  }

  async deleteAccount(userId: string) {
    await prisma.$transaction(async (transaction) => {
      await transaction.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
      const user = await transaction.user.findFirst({
        where: { id: userId, isActive: true, role: { name: 'CUSTOMER' } },
        select: { id: true },
      });
      if (!user) throw new AppError('Account is unavailable.', 401, 'UNAUTHENTICATED');

      const deliveries = await transaction.emailDelivery.findMany({ where: { userId }, select: { id: true } });
      for (const delivery of deliveries) {
        await transaction.emailDelivery.update({
          where: { id: delivery.id },
          data: { recipient: `delivery-${delivery.id}@deleted.invalid`, failureReason: null },
        });
      }

      await transaction.refreshToken.deleteMany({ where: { userId } });
      await transaction.otpChallenge.deleteMany({ where: { userId } });
      await transaction.passwordResetToken.deleteMany({ where: { userId } });
      await transaction.oAuthAccount.deleteMany({ where: { userId } });
      await transaction.address.deleteMany({ where: { userId } });
      await transaction.cart.deleteMany({ where: { userId } });
      await transaction.wishlist.deleteMany({ where: { userId } });
      await transaction.securityEvent.deleteMany({ where: { userId } });
      // Task 04.4: the account is anonymized, not deleted, so FK cascades never fire for personal recommendation data.
      await transaction.productInteraction.deleteMany({ where: { userId } });
      await transaction.recentlyViewedProduct.deleteMany({ where: { userId } });
      await transaction.recommendationPreference.deleteMany({ where: { userId } });

      const orders = await transaction.order.findMany({
        where: { userId },
        select: { id: true, status: true, delivery: { select: { status: true } } },
      });
      // A cancelled order can never be fulfilled (delivery writes are refused once it is cancelled), even when its Delivery row still
      // says PREPARING or OUT_FOR_DELIVERY, so it is always final. A delivered order is final once its Delivery agrees.
      const completedOrderIds = orders
        .filter(order => order.status === 'CANCELLED' || (order.status === 'DELIVERED' && (!order.delivery || order.delivery.status === 'DELIVERED')))
        .map(order => order.id);
      // Historical courier positions and admin notes are not needed to finish an active delivery (only the current location is), so
      // they go for every order now. An active order keeps its shipping snapshot and current location; DeliveryService redacts them when
      // that order reaches DELIVERED for an anonymized owner.
      await transaction.deliveryEvent.updateMany({
        where: { delivery: { order: { userId } } },
        data: { latitude: null, longitude: null, note: null },
      });
      if (completedOrderIds.length > 0) {
        await transaction.order.updateMany({
          where: { id: { in: completedOrderIds } },
          data: { ...REDACTED_SHIPPING },
        });
        await transaction.delivery.updateMany({
          where: { orderId: { in: completedOrderIds } },
          data: { latitude: null, longitude: null, locationLabel: null, locationSource: null },
        });
      }

      await transaction.securityEvent.create({ data: { userId, type: SecurityEventType.ACCOUNT_DELETED } });
      await transaction.user.update({
        where: { id: userId },
        data: {
          email: `deleted-${userId}@deleted.invalid`,
          pendingEmail: null,
          passwordHash: null,
          firstName: 'Deleted',
          lastName: 'Customer',
          isActive: false,
          emailVerifiedAt: null,
        },
      });
    }, { maxWait: 10000, timeout: 30000 });
  }
}
