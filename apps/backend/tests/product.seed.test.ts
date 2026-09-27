import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { assertDevSeedTarget, productDataset, validateProductDataset, seedProductDataset } from '../prisma/product-seed.js';

describe('Curated product dataset and seed safety', () => {
  it('contains 24 factual products across eight categories and ten represented brands', () => {
    expect(productDataset.products).toHaveLength(24);
    expect(productDataset.categories).toHaveLength(8);
    expect(productDataset.brands).toHaveLength(10);
    expect(new Set(productDataset.products.map(product => product.brandSlug)).size).toBe(10);
    expect(productDataset.brands.map(brand => brand.name).join(' ')).not.toMatch(/Unknown|Unspecified|Fallback/i);
  });
  it('has valid local media, accessible neutral illustrations and official source evidence', () => {
    const publicRoot = path.resolve('..', 'frontend', 'public');
    for (const product of productDataset.products) {
      expect(product.sourceUrl).toMatch(/^https:\/\//);
      expect(product.specifications.length).toBeGreaterThanOrEqual(6);
      expect(product.images.filter(image => image.isPrimary)).toHaveLength(1);
      for (const image of product.images) {
        const file = path.join(publicRoot, image.url);
        expect(existsSync(file)).toBe(true);
        const markup = readFileSync(file, 'utf8');
        expect(markup).toContain('<title');
        expect(markup).toContain('Generic demo illustration');
        expect(markup).not.toMatch(/<script|(?:href|src)=["']https?:\/\//);
      }
    }
    for (const category of productDataset.categories) expect(existsSync(path.join(publicRoot, category.imageUrl))).toBe(true);
  });
  it('rejects missing factual brands, duplicate identities and invalid reference prices', () => {
    const absentBrand = structuredClone(productDataset);
    absentBrand.products[0].brandSlug = 'unknown';
    expect(() => validateProductDataset(absentBrand)).toThrow();
    const duplicate = structuredClone(productDataset);
    duplicate.products[1].sku = duplicate.products[0].sku;
    expect(() => validateProductDataset(duplicate)).toThrow();
    const pricing = structuredClone(productDataset);
    pricing.products[0].compareAtPrice = '0.00';
    expect(() => validateProductDataset(pricing)).toThrow();
  });
  it('allows only explicitly selected DEV destinations and never production', () => {
    const dev = 'postgresql://postgres:example@db.pzxekjybdiulzmssalfo.supabase.co/postgres';
    expect(() => assertDevSeedTarget({ NODE_ENV: 'development', DATABASE_URL: dev, DIRECT_URL: dev })).not.toThrow();
    expect(() => assertDevSeedTarget({ NODE_ENV: 'production', DATABASE_URL: dev, DIRECT_URL: dev })).toThrow();
    expect(() => assertDevSeedTarget({ NODE_ENV: 'test', DATABASE_URL: dev, DIRECT_URL: 'postgresql://postgres:example@db.yepfgjehdstlxbpespun.supabase.co/postgres' })).toThrow();
    expect(() => assertDevSeedTarget({ NODE_ENV: 'test', DATABASE_URL: 'postgresql://postgres:example@localhost/postgres', DIRECT_URL: dev })).toThrow();
    expect(() => assertDevSeedTarget({})).toThrow();
  });
  it('reconciles stable curated identities twice without touching a legacy product', async () => {
    const legacy = { id: 'legacy', sku: 'LEGACY', slug: 'legacy', name: 'Unresolved', brandId: null };
    const saved = new Map<string, Record<string, unknown>>([['LEGACY', legacy]]);
    const metadata = ({ where }: { where: { slug: string } }) => Promise.resolve({ id: where.slug });
    const transaction = {
      category: { upsert: vi.fn(metadata) }, brand: { upsert: vi.fn(metadata) },
      product: {
        findFirst: vi.fn(({ where }: { where: { OR: [{ sku: string }, { slug: string }] } }) =>
          Promise.resolve([...saved.values()].find(product => product.sku === where.OR[0].sku || product.slug === where.OR[1].slug) ?? null)),
        upsert: vi.fn(({ where, create }: { where: { sku: string }; create: Record<string, unknown> }) => {
          const product = { id: where.sku, ...create };
          saved.set(where.sku, product);
          return Promise.resolve(product);
        }),
      },
      productImage: { deleteMany: vi.fn(), createMany: vi.fn() },
      productSpecification: { deleteMany: vi.fn(), createMany: vi.fn() },
      inventory: { upsert: vi.fn() },
    };
    const client = { $transaction: vi.fn((callback: (value: typeof transaction) => Promise<unknown>) => callback(transaction)) };
    const dev = 'postgresql://postgres:example@db.pzxekjybdiulzmssalfo.supabase.co/postgres';
    const configuration = { NODE_ENV: 'test', DATABASE_URL: dev, DIRECT_URL: dev };
    const first = await seedProductDataset(client as unknown as PrismaClient, configuration);
    expect(await seedProductDataset(client as unknown as PrismaClient, configuration)).toEqual(first);
    expect(first).toEqual({ products: 24, categories: 8, brands: 10, images: 48, specifications: 146 });
    expect(saved.size).toBe(25);
    expect(saved.get('LEGACY')).toBe(legacy);
    expect(transaction.productImage.deleteMany.mock.calls.every(([args]) => args.where.productId !== 'legacy')).toBe(true);
    expect([...saved.values()].filter(product => product.sku !== 'LEGACY').every(product => product.brandId != null)).toBe(true);
  });
});
