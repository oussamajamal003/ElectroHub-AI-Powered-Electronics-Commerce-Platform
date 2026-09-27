import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { beforeAll, afterAll, describe, expect, it } from 'vitest';
import { prisma } from '../src/lib/prisma.js';
import { assertDevSeedTarget } from '../prisma/product-seed.js';

const enabled = process.env.RUN_PRODUCT_DB_INTEGRATION === 'true';
describe.skipIf(!enabled)('Product foundation DEV database constraints (explicit opt-in)', () => {
  const marker = `025-${randomUUID()}`;
  let categoryId: string;
  let brandId: string;
  beforeAll(async () => {
    assertDevSeedTarget(process.env);
    categoryId = (await prisma.category.create({ data: { name: marker, slug: marker } })).id;
    brandId = (await prisma.brand.create({ data: { name: marker, slug: marker } })).id;
  }, 60000);
  afterAll(async () => {
    if (categoryId) {
      await prisma.product.deleteMany({ where: { categoryId } });
      await prisma.category.delete({ where: { id: categoryId } });
    }
    if (brandId) await prisma.brand.delete({ where: { id: brandId } });
    await prisma.$disconnect();
  }, 60000);
  it('preserves nullable legacy brands, Decimal precision, restrictive FKs and dependent cascades', async () => {
    const product = await prisma.product.create({ data: {
      name: marker, slug: marker, sku: marker, categoryId,
      price: new Prisma.Decimal('9999999999.99'),
      images: { create: { url: '/images/products/tablets/front.svg', sortOrder: 7 } },
      specifications: { create: { group: 'Test', name: 'Test', value: 'Test' } },
      inventory: { create: { quantity: 1 } },
    } });
    expect(product.brandId).toBeNull();
    expect(product.price.toFixed(2)).toBe('9999999999.99');
    await prisma.product.update({ where: { id: product.id }, data: { brandId } });
    await expect(prisma.brand.delete({ where: { id: brandId } })).rejects.toMatchObject({ code: 'P2003' });
    await expect(prisma.category.delete({ where: { id: categoryId } })).rejects.toMatchObject({ code: 'P2003' });
    await expect(prisma.product.create({ data: { name: marker, slug: marker, sku: marker, categoryId, price: 1 } })).rejects.toMatchObject({ code: 'P2002' });
    await expect(prisma.brand.create({ data: { name: `${marker}-other`, slug: marker } })).rejects.toMatchObject({ code: 'P2002' });
    await expect(prisma.category.create({ data: { name: `${marker}-other`, slug: marker } })).rejects.toMatchObject({ code: 'P2002' });
    expect((await prisma.productImage.findFirstOrThrow({ where: { productId: product.id } })).sortOrder).toBe(7);
    await prisma.product.delete({ where: { id: product.id } });
    expect(await prisma.productImage.count({ where: { productId: product.id } })).toBe(0);
    expect(await prisma.productSpecification.count({ where: { productId: product.id } })).toBe(0);
    expect(await prisma.inventory.count({ where: { productId: product.id } })).toBe(0);
  }, 60000);
  it('rolls back a failed transaction without leaving product rows', async () => {
    await expect(prisma.$transaction(async transaction => {
      await transaction.product.create({ data: { name: marker, slug: `${marker}-rollback`, sku: `${marker}-rollback`, categoryId, price: 1 } });
      throw new Error('Expected rollback');
    })).rejects.toThrow('Expected rollback');
    expect(await prisma.product.count({ where: { sku: `${marker}-rollback` } })).toBe(0);
  }, 60000);
});
