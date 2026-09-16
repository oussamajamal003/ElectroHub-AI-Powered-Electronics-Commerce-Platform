import { describe, it, expect, vi } from 'vitest';
import { prisma } from '../src/lib/prisma';

describe('Database Foundation', () => {
  it('should export a valid Prisma Client instance', () => {
    expect(prisma).toBeDefined();
    expect(typeof prisma.$connect).toBe('function');
    expect(typeof prisma.$disconnect).toBe('function');
  });

  it('should include foundational models in the Prisma Client', () => {
    // 14 required models from TASK 02.2
    expect(prisma.role).toBeDefined();
    expect(prisma.user).toBeDefined();
    expect(prisma.address).toBeDefined();
    expect(prisma.category).toBeDefined();
    expect(prisma.product).toBeDefined();
    expect(prisma.productImage).toBeDefined();
    expect(prisma.inventory).toBeDefined();
    expect(prisma.cart).toBeDefined();
    expect(prisma.cartItem).toBeDefined();
    expect(prisma.wishlist).toBeDefined();
    expect(prisma.wishlistItem).toBeDefined();
    expect(prisma.order).toBeDefined();
    expect(prisma.orderItem).toBeDefined();
    expect(prisma.payment).toBeDefined();
    expect(prisma.delivery).toBeDefined();
  });
});
