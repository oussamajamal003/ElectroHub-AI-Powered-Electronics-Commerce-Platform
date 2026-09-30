import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { reviewCounts, seedReviewDataset } from '../prisma/review-seed.js';

describe('Synthetic review seed', () => {
  it('has 320 reviews with one, few, many and unrated product cases', () => {
    expect(reviewCounts.reduce((total, count) => total + count, 0)).toBe(320);
    expect(reviewCounts).toContain(1);
    expect(reviewCounts).toContain(3);
    expect(reviewCounts).toContain(24);
    expect(reviewCounts).toHaveLength(16);
  });
  it('upserts stable inactive users and reviews twice without changing scoped counts', async () => {
    const users = new Map<string, string>();
    const reviews = new Set<string>();
    const transaction = {
      user: { upsert: vi.fn(async ({ where, create }: { where: { email: string }; create: { isActive: boolean; passwordHash: null } }) => {
        expect(where.email).toMatch(/@electrohub\.invalid$/);
        expect(create.isActive).toBe(false);
        expect(create.passwordHash).toBeNull();
        users.set(where.email, where.email);
        return { id: where.email };
      }) },
      product: { findUniqueOrThrow: vi.fn(async ({ where }: { where: { sku: string } }) => ({ id: where.sku })) },
      review: { upsert: vi.fn(async ({ where }: { where: { productId_userId: { productId: string; userId: string } } }) => {
        const identity = where.productId_userId;
        reviews.add(`${identity.productId}/${identity.userId}`);
      }) },
    };
    const client = { $transaction: vi.fn((callback: (value: typeof transaction) => Promise<unknown>) => callback(transaction)) };
    const dev = 'postgresql://postgres:example@db.pzxekjybdiulzmssalfo.supabase.co/postgres';
    const configuration = { NODE_ENV: 'test', DATABASE_URL: dev, DIRECT_URL: dev };
    const first = await seedReviewDataset(client as unknown as PrismaClient, 'customer-role', configuration);
    expect(await seedReviewDataset(client as unknown as PrismaClient, 'customer-role', configuration)).toEqual(first);
    expect(first).toEqual({ reviewers: 24, reviews: 320, ratedProducts: 16 });
    expect(users.size).toBe(24);
    expect(reviews.size).toBe(320);
  });
});
