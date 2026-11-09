import { Prisma, PrismaClient } from '@prisma/client';
import type { z } from 'zod';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { logSafely } from '../utils/logger.js';
import { DeliveryPublisher } from '../sockets/delivery.publisher.js';
import { paymentState } from './admin-order.service.js';
import type { customerListSchema } from '../validators/admin.validator.js';

/**
 * Task 05.1 customer administration. CUSTOMER accounts only (administrators never appear here and no role can be changed); an
 * allowlisted projection (no password/OTP/token/pending-email data). Aggregates come from grouped queries for the page's ids.
 * "Paid spend" is the total of stored SUCCEEDED payments, per currency; pending, failed and refunded payments are excluded.
 */
type CustomerList = z.infer<typeof customerListSchema>;
const TX = { maxWait: 10_000, timeout: 20_000 };
const iso = (value: Date | null | undefined) => value ? value.toISOString() : null;
/** Account deletion anonymizes rather than deletes (AccountDeletionService); such accounts can never be reactivated. */
export const isDeletedAccount = (email: string) => email.endsWith('@deleted.invalid');
const customerWhere: Prisma.UserWhereInput = { role: { name: 'CUSTOMER' } };

type Aggregate = { orderCount: number; lastOrderAt: string | null; paidSpend: { currency: string; amount: string }[] };

export class AdminCustomerService {
  constructor(private readonly db: PrismaClient = prisma) {}

  private async aggregates(userIds: string[]): Promise<Map<string, Aggregate>> {
    const result = new Map<string, Aggregate>(userIds.map(id => [id, { orderCount: 0, lastOrderAt: null, paidSpend: [] }]));
    if (!userIds.length) return result;
    const [orders, spend] = await Promise.all([
      this.db.order.groupBy({ by: ['userId'], where: { userId: { in: userIds } }, _count: { _all: true }, _max: { createdAt: true } }),
      this.db.$queryRaw<{ userId: string; currency: string; amount: Prisma.Decimal }[]>(Prisma.sql`
        SELECT o."userId", p."currency", SUM(p."amount") AS amount FROM "payments" p JOIN "orders" o ON o."id" = p."orderId"
        WHERE p."status" = 'SUCCEEDED' AND o."userId" IN (${Prisma.join(userIds.map(id => Prisma.sql`${id}::uuid`))})
        GROUP BY o."userId", p."currency" ORDER BY p."currency"`),
    ]);
    for (const row of orders) Object.assign(result.get(row.userId)!, { orderCount: row._count._all, lastOrderAt: iso(row._max.createdAt) });
    for (const row of spend) result.get(row.userId)!.paidSpend.push({ currency: row.currency, amount: new Prisma.Decimal(row.amount).toFixed(2) });
    return result;
  }

  private project(user: { id: string; email: string; firstName: string; lastName: string; isActive: boolean; emailVerifiedAt: Date | null;
    createdAt: Date; updatedAt: Date }, aggregate: Aggregate) {
    const deleted = isDeletedAccount(user.email);
    return { id: user.id, name: deleted ? null : [user.firstName, user.lastName].filter(Boolean).join(' ') || null,
      email: deleted ? null : user.email, status: deleted ? 'DELETED' as const : user.isActive ? 'ACTIVE' as const : 'INACTIVE' as const,
      emailVerified: Boolean(user.emailVerifiedAt), createdAt: user.createdAt.toISOString(), updatedAt: user.updatedAt.toISOString(), ...aggregate };
  }

  private static readonly select = { id: true, email: true, firstName: true, lastName: true, isActive: true, emailVerifiedAt: true,
    createdAt: true, updatedAt: true } satisfies Prisma.UserSelect;

  async summary() {
    const [total, active, spend] = await Promise.all([
      this.db.user.count({ where: { ...customerWhere, NOT: { email: { endsWith: '@deleted.invalid' } } } }),
      this.db.user.count({ where: { ...customerWhere, isActive: true } }),
      this.db.$queryRaw<{ currency: string; amount: Prisma.Decimal }[]>(Prisma.sql`
        SELECT p."currency", SUM(p."amount") AS amount FROM "payments" p JOIN "orders" o ON o."id" = p."orderId"
        JOIN "users" u ON u."id" = o."userId" JOIN "roles" r ON r."id" = u."roleId"
        WHERE p."status" = 'SUCCEEDED' AND r."name" = 'CUSTOMER' GROUP BY p."currency" ORDER BY p."currency"`),
    ]);
    return { total, active, paidRevenue: spend.map(row => ({ currency: row.currency, amount: new Prisma.Decimal(row.amount).toFixed(2) })) };
  }

  async list(query: CustomerList) {
    const and: Prisma.UserWhereInput[] = [customerWhere];
    if (query.q) and.push({ OR: [{ email: { contains: query.q, mode: 'insensitive' } }, { firstName: { contains: query.q, mode: 'insensitive' } },
      { lastName: { contains: query.q, mode: 'insensitive' } }] });
    // Deleted accounts have their own filter; ordinary Active/Deactivated filters exclude them.
    if (query.status === 'DELETED') and.push({ email: { endsWith: '@deleted.invalid' } });
    else if (query.status) and.push({ isActive: query.status === 'ACTIVE', NOT: { email: { endsWith: '@deleted.invalid' } } });
    const where: Prisma.UserWhereInput = { AND: and };
    const orderBy: Prisma.UserOrderByWithRelationInput[] = query.sort === 'name'
      ? [{ firstName: query.order }, { lastName: query.order }, { id: 'asc' }] : [{ [query.sort]: query.order }, { id: 'asc' }];
    const [users, total, summary] = await Promise.all([
      this.db.user.findMany({ where, orderBy, skip: (query.page - 1) * query.pageSize, take: query.pageSize, select: AdminCustomerService.select }),
      this.db.user.count({ where }),
      this.summary(),
    ]);
    const aggregates = await this.aggregates(users.map(user => user.id));
    return { data: users.map(user => this.project(user, aggregates.get(user.id)!)),
      meta: { page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize), summary } };
  }

  async detail(userId: string) {
    const user = await this.db.user.findFirst({ where: { id: userId, ...customerWhere }, select: AdminCustomerService.select });
    if (!user) throw new AppError('Customer not found.', 404, 'CUSTOMER_NOT_FOUND');
    const [aggregates, recent, defaultAddress] = await Promise.all([
      this.aggregates([user.id]),
      this.db.order.findMany({ where: { userId }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 10,
        select: { id: true, status: true, total: true, currency: true, createdAt: true, payment: { select: { status: true } },
          items: { select: { quantity: true } } } }),
      // City/country only: enough to orient support, without exposing a full street address on a list-adjacent screen.
      this.db.address.findFirst({ where: { userId, isDefault: true }, select: { city: true, country: true } }),
    ]);
    return { ...this.project(user, aggregates.get(user.id)!), region: isDeletedAccount(user.email) ? null : defaultAddress,
      recentOrders: recent.map(order => ({ orderReference: `ORD-${order.id.toUpperCase()}`, status: order.status,
        paymentState: paymentState(order.payment?.status), total: order.total.toFixed(2), currency: order.currency,
        createdAt: order.createdAt.toISOString(), itemCount: order.items.reduce((sum, item) => sum + item.quantity, 0) })) };
  }

  /**
   * Deactivation uses the same per-user token-lifecycle lock as login/refresh/deletion, flips isActive and revokes every refresh token in
   * one transaction (requireAuth already rejects an inactive account on its next request), then closes realtime sockets after commit.
   * Order history is untouched. Reactivation never revives an anonymized (deleted) account.
   */
  async setStatus(actorId: string, userId: string, isActive: boolean, expected: string) {
    if (actorId === userId) throw new AppError('You cannot change your own account status.', 409, 'CUSTOMER_SELF_CHANGE');
    const changed = await this.db.$transaction(async tx => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('user_token_lifecycle'), hashtext(${userId}))`;
      await tx.$queryRaw`SELECT id FROM users WHERE id = ${userId}::uuid FOR UPDATE`;
      const user = await tx.user.findFirst({ where: { id: userId, ...customerWhere }, select: { email: true, isActive: true, updatedAt: true } });
      if (!user) throw new AppError('Customer not found.', 404, 'CUSTOMER_NOT_FOUND');
      if (isDeletedAccount(user.email)) throw new AppError('This account was deleted by its owner and cannot be changed.', 409, 'CUSTOMER_DELETED');
      if (user.updatedAt.toISOString() !== new Date(expected).toISOString()) {
        throw new AppError('This account changed since you opened it. Reload and try again.', 409, 'CUSTOMER_CONFLICT');
      }
      if (user.isActive === isActive) return false;
      await tx.user.update({ where: { id: userId }, data: { isActive } });
      if (!isActive) await tx.refreshToken.updateMany({ where: { userId, isRevoked: false }, data: { isRevoked: true, expiresAt: new Date(0) } });
      return true;
    }, TX);
    if (changed && !isActive) DeliveryPublisher.disconnectUser(userId, 'ACCOUNT_DEACTIVATED');
    if (changed) logSafely('info', 'Admin account change', { event: isActive ? 'admin.customer.reactivated' : 'admin.customer.deactivated', actorId, userId });
    return this.detail(userId);
  }
}
