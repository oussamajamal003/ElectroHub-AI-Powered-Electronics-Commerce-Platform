import { describe, expect, it, beforeEach, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { reviewCreateSchema, reviewPaginationSchema, reviewUpdateSchema } from '../src/validators/review.validator.js';
import { ReviewService } from '../src/services/review.service.js';

const database = vi.hoisted(() => ({
  product: { findFirst: vi.fn() },
  review: { findMany: vi.fn(), count: vi.fn(), findUnique: vi.fn(), create: vi.fn(), update: vi.fn(), deleteMany: vi.fn(), aggregate: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock('../src/lib/prisma.js', () => ({ prisma: database }));
const review = { id: 'review-1', rating: 5, body: 'Excellent', createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'), user: { firstName: 'Sample', lastName: 'Reviewer', isActive: true,
    email: 'hidden@example.invalid', passwordHash: 'hidden' } };

beforeEach(() => {
  vi.resetAllMocks();
  database.product.findFirst.mockResolvedValue({ id: 'product-1' });
  database.review.aggregate.mockResolvedValue({ _avg: { rating: 4.5 }, _count: { _all: 2 } });
  database.$transaction.mockImplementation(async (queries: Promise<unknown>[]) => Promise.all(queries));
});

describe('Review validation and privacy', () => {
  it('returns only the authenticated customer’s bounded review history with Product context', async () => {
    database.review.findMany.mockResolvedValue([{ ...review, product: { slug: 'phone', name: 'Phone', images: [{ id: 'image-1', url: '/images/catalog/smartphones.jpg', altText: 'Phone' }] } }]);
    database.review.count.mockResolvedValue(1);
    const result = await new ReviewService().listMine('user-1', { page: 1, pageSize: 20 });
    expect(result.data[0]).toMatchObject({ product: { slug: 'phone', name: 'Phone', primaryImage: { id: 'image-1' } } });
    expect(result.meta).toEqual({ page: 1, pageSize: 20, total: 1, totalPages: 1 });
    expect(database.review.findMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'user-1', product: { status: 'ACTIVE', category: { isActive: true } } }, take: 20 }));
    expect(JSON.stringify(result)).not.toMatch(/email|passwordHash/);
  });
  it('bounds pagination and rejects repeated or unsupported values', () => {
    expect(reviewPaginationSchema.parse({})).toEqual({ page: 1, pageSize: 10 });
    expect(reviewPaginationSchema.safeParse({ pageSize: '51' }).success).toBe(false);
    expect(reviewPaginationSchema.safeParse({ page: ['1', '2'] }).success).toBe(false);
    expect(reviewPaginationSchema.safeParse({ sort: 'newest' }).success).toBe(false);
  });
  it('requires integer 1–5 rating and 1–2000 trimmed body', () => {
    expect(reviewCreateSchema.parse({ rating: 5, body: '  Great  ' })).toEqual({ rating: 5, body: 'Great' });
    for (const input of [{ rating: 0, body: 'ok' }, { rating: 6, body: 'ok' },
      { rating: 2.5, body: 'ok' }, { rating: 3, body: '  ' }, { rating: 3, body: 'x'.repeat(2001) }]) {
      expect(reviewCreateSchema.safeParse(input).success).toBe(false);
    }
    expect(reviewUpdateSchema.safeParse({}).success).toBe(false);
  });
  it('returns paged reviews with display name only, without private User fields', async () => {
    database.review.findMany.mockResolvedValue([review]); database.review.count.mockResolvedValue(1);
    const result = await new ReviewService().list('product-slug', { page: 1, pageSize: 10 });
    expect(result.meta).toEqual({ page: 1, pageSize: 10, total: 1, totalPages: 1 });
    expect(result.summary).toEqual({ averageRating: '4.5', reviewCount: 2 });
    expect(result.data[0].author).toEqual({ displayName: 'Sample Reviewer' });
    expect(JSON.stringify(result)).not.toMatch(/email|passwordHash|hidden/);
    expect(database.review.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { productId: 'product-1' }, skip: 0, take: 10,
    }));
  });
  it('uses anonymized display for deletion tombstones but not inactive synthetic reviewers', async () => {
    database.review.findUnique.mockResolvedValueOnce({ ...review, user: { ...review.user, firstName: 'Deleted', lastName: 'Customer', isActive: false } });
    expect((await new ReviewService().mine('product-slug', 'user-1'))?.author.displayName).toBe('Deleted Customer');
    database.review.findUnique.mockResolvedValueOnce({ ...review, user: { ...review.user, firstName: 'Catalog', lastName: 'Reviewer 01', isActive: false } });
    expect((await new ReviewService().mine('product-slug', 'user-1'))?.author.displayName).toBe('Catalog Reviewer 01');
  });
  it('enforces authenticated identity in unique ownership lookups', async () => {
    database.review.findUnique.mockResolvedValue(null);
    expect(await new ReviewService().mine('product-slug', 'user-1')).toBeNull();
    expect(database.review.findUnique).toHaveBeenCalledWith(expect.objectContaining({
      where: { productId_userId: { productId: 'product-1', userId: 'user-1' } },
    }));
  });
  it('maps duplicate creation and missing own update to stable errors', async () => {
    database.review.create.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('duplicate', { code: 'P2002', clientVersion: '6.12.0' }));
    await expect(new ReviewService().create('product-slug', 'user-1', { rating: 5, body: 'Great' }))
      .rejects.toMatchObject({ statusCode: 409, code: 'REVIEW_EXISTS' });
    database.review.update.mockRejectedValue(new Prisma.PrismaClientKnownRequestError('missing', { code: 'P2025', clientVersion: '6.12.0' }));
    await expect(new ReviewService().update('product-slug', 'user-1', { rating: 4 }))
      .rejects.toMatchObject({ statusCode: 404, code: 'REVIEW_NOT_FOUND' });
  });
  it('returns a fresh aggregate after the authenticated review is created', async () => {
    database.review.create.mockResolvedValue(review);
    await expect(new ReviewService().create('product-slug', 'user-1', { rating: 5, body: 'Excellent' }))
      .resolves.toMatchObject({ review: { id: 'review-1' }, summary: { averageRating: '4.5', reviewCount: 2 } });
  });
  it('deletes only own review and treats repeats as missing', async () => {
    database.review.deleteMany.mockResolvedValueOnce({ count: 1 }).mockResolvedValueOnce({ count: 0 });
    await new ReviewService().remove('product-slug', 'user-1');
    expect(database.review.deleteMany).toHaveBeenCalledWith({ where: { productId: 'product-1', userId: 'user-1' } });
    await expect(new ReviewService().remove('product-slug', 'user-1'))
      .rejects.toMatchObject({ statusCode: 404, code: 'REVIEW_NOT_FOUND' });
  });
});
