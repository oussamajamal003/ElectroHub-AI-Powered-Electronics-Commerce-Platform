import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Prisma } from '@prisma/client';
import { ProductService, projectAvailability } from '../product.service.js';
import { CategoryService } from '../category.service.js';
import { BrandService } from '../brand.service.js';
import { paginationSchema, normalizeSlug, pricingSchema } from '../../validators/product.validator.js';

const database = vi.hoisted(() => ({
  product: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn() },
  category: { findMany: vi.fn(), findFirst: vi.fn(), count: vi.fn() },
  brand: { findMany: vi.fn(), findUnique: vi.fn(), count: vi.fn() },
  $transaction: vi.fn(),
}));
vi.mock('../../lib/prisma.js', () => ({ prisma: database }));
const primary = { id: 'image-1', url: '/images/products/tablets/front.svg', altText: 'Demo tablet', sortOrder: 0, isPrimary: true };
const fixture = () => ({
  id: 'product-1', name: 'Tablet', slug: 'tablet', status: 'ACTIVE',
  price: new Prisma.Decimal('9999999999.99'), compareAtPrice: new Prisma.Decimal('9999999999.99'),
  category: { id: 'category-1', name: 'Tablets', slug: 'tablets' },
  brand: null, inventory: { quantity: 2 }, images: [primary],
  description: 'Demo', sku: 'TEST-1', modelNumber: null,
  specifications: [{ id: 'spec-1', group: 'Display', name: 'Resolution', value: '1920 x 1080', sortOrder: 0 }],
});

beforeEach(() => {
  vi.resetAllMocks();
  database.$transaction.mockImplementation((operations: Promise<unknown>[]) => Promise.all(operations));
});

describe('Product foundation services', () => {
  it('serializes exact money and nullable legacy brand without leaking internal fields', async () => {
    database.product.findMany.mockResolvedValue([fixture()]);
    database.product.count.mockResolvedValue(1);
    const response = await new ProductService().list({ page: 2, pageSize: 10 });
    expect(response.meta).toEqual({ page: 2, pageSize: 10, total: 1 });
    expect(response.data[0]).toMatchObject({ price: '9999999999.99', brand: null, availability: 'AVAILABLE', primaryImage: primary });
    expect(response.data[0]).not.toHaveProperty('inventory');
    expect(response.data[0]).not.toHaveProperty('specifications');
    expect(response.data[0]).not.toHaveProperty('description');
    expect(database.product.findMany).toHaveBeenCalledWith(expect.objectContaining({
      skip: 10, take: 10, where: { status: 'ACTIVE', category: { isActive: true } },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      select: expect.objectContaining({ images: expect.objectContaining({ where: { isPrimary: true }, take: 1 }) }),
    }));
  });

  it('returns null media and reference price for legacy records', async () => {
    database.product.findMany.mockResolvedValue([{ ...fixture(), images: [], compareAtPrice: null, inventory: null }]);
    database.product.count.mockResolvedValue(1);
    const response = await new ProductService().list({ page: 1, pageSize: 20 });
    expect(response.data[0]).toMatchObject({ primaryImage: null, compareAtPrice: null, availability: 'UNAVAILABLE' });
  });

  it('returns empty bounded pages', async () => {
    database.product.findMany.mockResolvedValue([]);
    database.product.count.mockResolvedValue(0);
    expect(await new ProductService().list({ page: 1, pageSize: 20 }))
      .toEqual({ data: [], meta: { page: 1, pageSize: 20, total: 0 } });
  });

  it('selects ordered gallery/specifications and maps detail fields', async () => {
    database.product.findFirst.mockResolvedValue(fixture());
    const detail = await new ProductService().detail('tablet');
    expect(detail).toMatchObject({ sku: 'TEST-1', modelNumber: null, images: [primary] });
    expect(detail.specifications).toHaveLength(1);
    expect(detail.specifications[0]).toEqual({ group: 'Display', items: fixture().specifications });
    expect(database.product.findFirst).toHaveBeenCalledWith(expect.objectContaining({
      where: { slug: 'tablet', status: 'ACTIVE', category: { isActive: true } },
      select: expect.objectContaining({
        images: expect.objectContaining({ orderBy: [{ isPrimary: 'desc' }, { sortOrder: 'asc' }, { id: 'asc' }] }),
        specifications: expect.objectContaining({ orderBy: [{ group: 'asc' }, { sortOrder: 'asc' }, { id: 'asc' }] }),
      }),
    }));
  });

  it('returns structured product not-found for hidden/missing records', async () => {
    database.product.findFirst.mockResolvedValue(null);
    await expect(new ProductService().detail('missing')).rejects.toMatchObject({ statusCode: 404, code: 'PRODUCT_NOT_FOUND' });
  });

  it.each([
    ['ACTIVE', 1, 'AVAILABLE'], ['ACTIVE', 0, 'UNAVAILABLE'],
    ['ACTIVE', -1, 'UNAVAILABLE'], ['INACTIVE', 10, 'UNAVAILABLE'],
    ['ACTIVE', null, 'UNAVAILABLE'],
  ] as const)('projects %s / %s to %s', (status, quantity, result) => {
    expect(projectAvailability(status, quantity)).toBe(result);
  });

  it('lists lightweight categories and brands with deterministic bounded ordering', async () => {
    database.category.findMany.mockResolvedValue([{ id: 'cat', name: 'Tablets', slug: 'tablets' }]);
    database.category.count.mockResolvedValue(1);
    database.brand.findMany.mockResolvedValue([{ id: 'brand', name: 'Apple', slug: 'apple' }]);
    database.brand.count.mockResolvedValue(1);
    expect((await new CategoryService().list({ page: 1, pageSize: 20 })).data).toHaveLength(1);
    expect((await new BrandService().list({ page: 1, pageSize: 20 })).data).toHaveLength(1);
    expect(database.category.findMany).toHaveBeenCalledWith(expect.objectContaining({
      where: { isActive: true }, take: 20, orderBy: [{ name: 'asc' }, { id: 'asc' }],
    }));
    expect(database.brand.findMany).toHaveBeenCalledWith(expect.objectContaining({ take: 20 }));
  });

  it('resolves category/brand details and structured not-found errors', async () => {
    database.category.findFirst.mockResolvedValue({ slug: 'tablets' });
    database.brand.findUnique.mockResolvedValue({ slug: 'apple' });
    expect(await new CategoryService().detail('tablets')).toEqual({ slug: 'tablets' });
    expect(await new BrandService().detail('apple')).toEqual({ slug: 'apple' });
    database.category.findFirst.mockResolvedValue(null);
    database.brand.findUnique.mockResolvedValue(null);
    await expect(new CategoryService().detail('missing')).rejects.toMatchObject({ code: 'CATEGORY_NOT_FOUND', statusCode: 404 });
    await expect(new BrandService().detail('missing')).rejects.toMatchObject({ code: 'BRAND_NOT_FOUND', statusCode: 404 });
  });
});

describe('Product validation', () => {
  it('defaults pagination and accepts maximum size', () => {
    expect(paginationSchema.parse({})).toEqual({ page: 1, pageSize: 20 });
    expect(paginationSchema.parse({ pageSize: '100' }).pageSize).toBe(100);
  });
  it.each([{ page: '0' }, { page: '-1' }, { page: '1.5' }, { pageSize: '101' },
    { pageSize: '' }, { page: '1000001' }, { page: ['1', '2'] }, { search: 'phone' },
    { page: '1e2' }, { page: '9007199254740992' }])('rejects invalid pagination %j', query => {
    expect(paginationSchema.safeParse(query).success).toBe(false);
  });
  it('normalizes URL-safe slugs without inventing collision suffixes', () => {
    expect(normalizeSlug('  Café Tablet 10! ')).toBe('cafe-tablet-10');
    expect(() => normalizeSlug('---')).toThrow();
  });
  it.each([
    { price: '0.00', compareAtPrice: null }, { price: '499.00', compareAtPrice: '599.00' },
  ])('accepts exact nonnegative money %j', value => expect(pricingSchema.safeParse(value).success).toBe(true));
  it.each([
    { price: '-1.00' }, { price: '0.001' }, { price: 12.99 },
    { price: '99999999999.99' }, { price: '10.00', compareAtPrice: '9.99' },
  ])('rejects invalid money %j', value => expect(pricingSchema.safeParse(value).success).toBe(false));
});
