import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { reviewSummary } from '../review.service.js';

const database = vi.hoisted(() => ({
  review: { aggregate: vi.fn(), groupBy: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock('../../lib/prisma.js', () => ({ prisma: database }));

/** Task 06.2 WP C: the Customer Reviews distribution comes from stored ratings only, in one consistent snapshot. */
describe('reviewSummary', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    database.$transaction.mockImplementation((operations: Promise<unknown>[]) => Promise.all(operations));
  });

  it('counts reviews per star value from the same snapshot as the average', async () => {
    database.review.aggregate.mockResolvedValue({ _avg: { rating: 4.333 }, _count: { _all: 6 } });
    database.review.groupBy.mockResolvedValue([{ rating: 5, _count: { _all: 3 } }, { rating: 4, _count: { _all: 2 } }, { rating: 2, _count: { _all: 1 } }]);
    const summary = await reviewSummary('product-1');
    expect(summary).toEqual({ averageRating: '4.3', reviewCount: 6, distribution: [
      { rating: 5, count: 3 }, { rating: 4, count: 2 }, { rating: 3, count: 0 }, { rating: 2, count: 1 }, { rating: 1, count: 0 }] });
    expect(summary.distribution.reduce((sum, row) => sum + row.count, 0)).toBe(summary.reviewCount);
    expect(database.$transaction).toHaveBeenCalledWith(expect.any(Array), { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    expect(database.review.groupBy).toHaveBeenCalledWith(expect.objectContaining({ by: ['rating'], where: { productId: 'product-1' } }));
  });

  it('reports an unrated product as zero counts, never as invented ratings', async () => {
    database.review.aggregate.mockResolvedValue({ _avg: { rating: null }, _count: { _all: 0 } });
    database.review.groupBy.mockResolvedValue([]);
    expect(await reviewSummary('product-2')).toEqual({ averageRating: null, reviewCount: 0,
      distribution: [5, 4, 3, 2, 1].map(rating => ({ rating, count: 0 })) });
  });
});
