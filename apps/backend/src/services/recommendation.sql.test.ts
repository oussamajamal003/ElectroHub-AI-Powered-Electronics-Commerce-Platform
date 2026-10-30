import { beforeEach, describe, expect, it, vi } from 'vitest';
import { coPurchases } from './recommendation.sql.js';

const db = vi.hoisted(() => ({ $queryRaw: vi.fn() }));
vi.mock('../lib/prisma.js', () => ({ prisma: db }));

/** The SQL text of the single raw query, so the candidate rules are asserted on the statement that actually runs. */
function executedSql() {
  const [statement] = db.$queryRaw.mock.calls[0] as [{ sql: string }];
  return statement.sql.replace(/\s+/g, ' ');
}

describe('coPurchases candidate eligibility', () => {
  beforeEach(() => {
    db.$queryRaw.mockReset();
    db.$queryRaw.mockResolvedValue([]);
  });

  it('lets only storefront-visible, in-stock candidates compete for the result limit', async () => {
    await coPurchases(['00000000-0000-4000-8000-000000000001'], 2, 8);

    const sql = executedSql();
    // The LIMIT applies after the candidate pool is built, so an unavailable product must never take a slot.
    expect(sql).toContain('JOIN "inventory" inv ON inv."productId" = p."id" AND inv."quantity" > 0');
    expect(sql.indexOf('JOIN "inventory" inv')).toBeLessThan(sql.indexOf('WHERE NOT (l."productId"'));
    expect(sql).toContain('LIMIT');
  });

  it('keeps the qualifying-order and visibility rules unchanged', async () => {
    await coPurchases(['00000000-0000-4000-8000-000000000001'], 2, 8);

    const sql = executedSql();
    expect(sql).toContain(`pay."status" = 'SUCCEEDED' AND pay."refundedAt" IS NULL`);
    expect(sql).toContain(`p."status" = 'ACTIVE' AND p."isTestFixture" = false AND p."storefrontVisible" = true`);
    expect(sql).toContain('WHERE pairs.support >= ');
  });

  it('returns no rows without querying when there are no anchors', async () => {
    await expect(coPurchases([], 2, 8)).resolves.toEqual([]);
    expect(db.$queryRaw).not.toHaveBeenCalled();
  });
});
