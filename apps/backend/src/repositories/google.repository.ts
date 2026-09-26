import { prisma } from '../lib/prisma.js';
import { GoogleIdentity } from '../providers/google.provider.js';

export class GoogleRepository {
  findIdentity(sub: string) {
    return prisma.oAuthAccount.findUnique({ where: { provider_providerAccountId: { provider: 'GOOGLE', providerAccountId: sub } }, include: { user: { include: { role: true } } } });
  }

  findUser(email: string) {
    return prisma.user.findFirst({ where: { OR: [{ email }, { pendingEmail: email }] }, include: { role: true } });
  }

  createCustomer(identity: GoogleIdentity) {
    return prisma.$transaction(async transaction => {
      const role = await transaction.role.upsert({ where: { name: 'CUSTOMER' }, create: { name: 'CUSTOMER' }, update: {} });
      return transaction.user.create({
        data: {
          email: identity.email, passwordHash: null, firstName: identity.firstName, lastName: identity.lastName,
          emailVerifiedAt: new Date(), roleId: role.id,
          oauthAccounts: { create: { provider: 'GOOGLE', providerAccountId: identity.sub, providerEmail: identity.email } },
          securityEvents: { create: { type: 'GOOGLE_CONNECTED' } },
        }, include: { role: true },
      });
    }, { timeout: 15000 });
  }

  connect(userId: string, identity: GoogleIdentity, passwordHash: string) {
    return prisma.$transaction(async transaction => {
      const eligible = await transaction.user.findFirst({
        where: { id: userId, email: identity.email, passwordHash, isActive: true, emailVerifiedAt: { not: null }, role: { name: 'CUSTOMER' } },
      });
      if (!eligible) return false;
      await transaction.oAuthAccount.create({ data: { userId, provider: 'GOOGLE', providerAccountId: identity.sub, providerEmail: identity.email } });
      await transaction.securityEvent.create({ data: { userId, type: 'GOOGLE_CONNECTED' } });
      return true;
    }, { timeout: 15000 });
  }

  recordLogin(userId: string) {
    return prisma.securityEvent.create({ data: { userId, type: 'LOGIN_SUCCESS' } });
  }
}
