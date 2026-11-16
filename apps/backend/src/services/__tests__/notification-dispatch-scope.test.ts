import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { CommerceEmailDispatcher } from '../commerce-email.dispatcher.js';
import { CustomerPushDispatcher } from '../customer-push.dispatcher.js';

const orderId = '4510e012-e03d-4939-bb3d-52746df0db4a';

describe('one-order notification dispatch scope', () => {
  it('limits email claims and expired-lease recovery to fresh OOD events for the exact order', async () => {
    const queries: { sql: string; values: unknown[] }[] = [];
    const query = vi.fn(async (statement: { sql: string; values: unknown[] }) => { queries.push(statement); return []; });
    const tx = { $queryRaw: query, commerceEmailAttempt: { findFirst: vi.fn() }, $executeRaw: vi.fn() };
    const transaction = vi.fn(async (operation: (client: typeof tx) => Promise<unknown>) => operation(tx));
    const db = { $queryRaw: query, $transaction: transaction };
    const dispatcher = new CommerceEmailDispatcher(db as unknown as PrismaClient, { name: 'BREVO', send: vi.fn() }, vi.fn(), {
      sendMode: 'live', allowedRecipients: [], origin: 'http://localhost:3000', batchSize: 10, concurrency: 1, leaseMs: 60_000,
    }, 'worker-test', Date.now, orderId);

    await dispatcher.claim();
    await dispatcher.recoverExpired();

    expect(queries).toHaveLength(2);
    for (const statement of queries) {
      expect(statement.sql).toContain('"orderId" =');
      expect(statement.sql).toContain("'ORDER_OUT_FOR_DELIVERY'");
      expect(statement.values).toContain(orderId);
    }
  });

  it('limits push claims and exhausted-lease handling and skips global subscription cleanup', async () => {
    const queries: { sql: string; values: unknown[] }[] = [];
    const db = {
      $queryRaw: vi.fn(async (statement: TemplateStringsArray | string[], ...values: unknown[]) => {
        queries.push({ sql: Array.from(statement).join('?'), values }); return [];
      }),
      $executeRaw: vi.fn(),
      customerPushDelivery: { updateMany: vi.fn().mockResolvedValue({ count: 0 }) },
    };
    const dispatcher = new CustomerPushDispatcher(db as unknown as PrismaClient, { send: vi.fn() }, orderId);
    await dispatcher.runBatch();

    expect(db.$executeRaw).not.toHaveBeenCalled();
    expect(queries).toHaveLength(1);
    expect(queries[0]!.sql).toContain('"orderId"=');
    expect(queries[0]!.sql).toContain("'ORDER_OUT_FOR_DELIVERY'");
    expect(queries[0]!.values).toContain(orderId);
    expect(db.customerPushDelivery.updateMany).toHaveBeenCalledWith(expect.objectContaining({
      where: expect.objectContaining({ notification: { orderId, type: 'ORDER_OUT_FOR_DELIVERY' } }),
    }));
  });
});
