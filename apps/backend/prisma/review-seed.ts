import type { PrismaClient } from '@prisma/client';
import { assertDevSeedTarget, productDataset } from './product-seed.js';

export const reviewCounts = [1, 3, ...Array.from({ length: 13 }, () => 24), 4];

export async function seedReviewDataset(client: PrismaClient, customerRoleId: string, configuration = process.env) {
  assertDevSeedTarget(configuration);
  return client.$transaction(async transaction => {
    const reviewers: string[] = [];
    for (let index = 0; index < 24; index++) {
      const number = String(index + 1).padStart(2, '0');
      const reviewer = await transaction.user.upsert({
        where: { email: `catalog-reviewer-${number}@electrohub.invalid` },
        update: { isActive: false, passwordHash: null, roleId: customerRoleId },
        create: { email: `catalog-reviewer-${number}@electrohub.invalid`, firstName: 'Catalog',
          lastName: `Reviewer ${number}`, isActive: false, passwordHash: null, roleId: customerRoleId },
        select: { id: true },
      });
      reviewers.push(reviewer.id);
    }
    let count = 0;
    for (const [productIndex, amount] of reviewCounts.entries()) {
      const source = productDataset.products[productIndex];
      const product = await transaction.product.findUniqueOrThrow({ where: { sku: source.sku }, select: { id: true } });
      for (let reviewerIndex = 0; reviewerIndex < amount; reviewerIndex++) {
        const rating = ((productIndex + reviewerIndex) % 5) + 1;
        const body = `Development catalog review for ${source.name}. Rating: ${rating} out of 5.`;
        const identity = { productId: product.id, userId: reviewers[reviewerIndex] };
        await transaction.review.upsert({ where: { productId_userId: identity },
          create: { ...identity, rating, body }, update: { rating, body } });
        count++;
      }
    }
    return { reviewers: reviewers.length, reviews: count, ratedProducts: reviewCounts.length };
  }, { maxWait: 30000, timeout: 900000 });
}
