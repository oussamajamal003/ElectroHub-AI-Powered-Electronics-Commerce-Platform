import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { publicProductWhere } from './product.service.js';
import type { Pagination } from './product.service.js';
import type { z } from 'zod';
import type { reviewCreateSchema, reviewUpdateSchema } from '../validators/review.validator.js';

const select = {
  id: true, rating: true, body: true, createdAt: true, updatedAt: true,
  user: { select: { firstName: true, lastName: true } },
} satisfies Prisma.ReviewSelect;
type PublicReview = Prisma.ReviewGetPayload<{ select: typeof select }>;
const accountSelect = {
  ...select,
  product: { select: { slug: true, name: true, images: { where: { isPrimary: true }, take: 1,
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], select: { id: true, url: true, altText: true } } } },
} satisfies Prisma.ReviewSelect;

function mapReview(review: PublicReview) {
  const name = review.user.firstName === 'Deleted' && review.user.lastName === 'Customer'
    ? 'Deleted Customer'
    : `${review.user.firstName.trim()} ${review.user.lastName.trim()}`.trim();
  return { id: review.id, rating: review.rating, body: review.body,
    author: { displayName: name || 'Customer' },
    createdAt: review.createdAt, updatedAt: review.updatedAt };
}

export const RATING_VALUES = [5, 4, 3, 2, 1] as const;

/**
 * Rating summary computed from stored reviews only. `distribution` (Task 06.2, additive) counts reviews per star value,
 * always listing 5..1 so clients never infer a bar from missing data; it is derived from the same rows as the average.
 */
export async function reviewSummary(productId: string) {
  const [aggregate, groups] = await prisma.$transaction([
    prisma.review.aggregate({ where: { productId }, _avg: { rating: true }, _count: { _all: true } }),
    prisma.review.groupBy({ by: ['rating'], where: { productId }, orderBy: { rating: 'desc' }, _count: { _all: true } }),
  ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
  const counts = new Map(groups.map(group => [group.rating, typeof group._count === 'object' && group._count ? group._count._all ?? 0 : 0]));
  return {
    averageRating: aggregate._avg.rating?.toFixed(1) ?? null,
    reviewCount: aggregate._count._all,
    distribution: RATING_VALUES.map(rating => ({ rating, count: counts.get(rating) ?? 0 })),
  };
}

async function findProduct(slug: string) {
  const product = await prisma.product.findFirst({
    where: { ...publicProductWhere, slug }, select: { id: true },
  });
  if (!product) throw new AppError('Product not found.', 404, 'PRODUCT_NOT_FOUND');
  return product;
}

export class ReviewService {
  async listMine(userId: string, { page, pageSize }: Pagination) {
    const where = { userId, product: publicProductWhere };
    const [reviews, total] = await prisma.$transaction([
      prisma.review.findMany({ where, select: accountSelect,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: (page - 1) * pageSize, take: pageSize }),
      prisma.review.count({ where }),
    ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    return { data: reviews.map(review => ({
      ...mapReview(review), product: { ...review.product, primaryImage: review.product.images[0] ?? null },
    })), meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
  }

  async list(slug: string, { page, pageSize }: Pagination) {
    const product = await findProduct(slug);
    const [reviews, total] = await prisma.$transaction([
      prisma.review.findMany({ where: { productId: product.id }, select,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: (page - 1) * pageSize, take: pageSize }),
      prisma.review.count({ where: { productId: product.id } }),
    ], { isolationLevel: Prisma.TransactionIsolationLevel.RepeatableRead });
    return { data: reviews.map(mapReview), summary: await reviewSummary(product.id),
      meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize) } };
  }

  async mine(slug: string, userId: string) {
    const product = await findProduct(slug);
    const review = await prisma.review.findUnique({
      where: { productId_userId: { productId: product.id, userId } }, select,
    });
    return review ? mapReview(review) : null;
  }

  async create(slug: string, userId: string, input: z.infer<typeof reviewCreateSchema>) {
    const product = await findProduct(slug);
    try {
      const review = mapReview(await prisma.review.create({
        data: { productId: product.id, userId, ...input }, select,
      }));
      return { review, summary: await reviewSummary(product.id) };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new AppError('You have already reviewed this product.', 409, 'REVIEW_EXISTS');
      }
      throw error;
    }
  }

  async update(slug: string, userId: string, input: z.infer<typeof reviewUpdateSchema>) {
    const product = await findProduct(slug);
    try {
      const review = mapReview(await prisma.review.update({
        where: { productId_userId: { productId: product.id, userId } }, data: input, select,
      }));
      return { review, summary: await reviewSummary(product.id) };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        throw new AppError('Review not found.', 404, 'REVIEW_NOT_FOUND');
      }
      throw error;
    }
  }

  async remove(slug: string, userId: string) {
    const product = await findProduct(slug);
    const deleted = await prisma.review.deleteMany({ where: { productId: product.id, userId } });
    if (deleted.count === 0) throw new AppError('Review not found.', 404, 'REVIEW_NOT_FOUND');
  }
}
