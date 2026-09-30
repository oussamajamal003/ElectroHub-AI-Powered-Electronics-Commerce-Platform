import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import type { PrismaClient } from '@prisma/client';
import { assertDevSeedTarget, productDataset, validateProductDataset, seedProductDataset } from '../prisma/product-seed.js';

describe('Curated product dataset and seed safety', () => {
  it('contains 128 source-backed configurations across eight categories and ten represented brands', () => {
    expect(productDataset.products).toHaveLength(128);
    expect(productDataset.categories).toHaveLength(8);
    expect(productDataset.brands).toHaveLength(10);
    expect(new Set(productDataset.products.map(product => product.brandSlug)).size).toBe(10);
    expect(productDataset.brands.map(brand => brand.name).join(' ')).not.toMatch(/Unknown|Unspecified|Fallback/i);
    expect(productDataset.products.every(product => product.brandSlug && product.sourceUrl.startsWith('https://'))).toBe(true);
    expect(new Set(productDataset.products.map(product => product.sku)).size).toBe(128);
    expect(productDataset.products.some(product => product.quantity === 0)).toBe(true);
    expect(productDataset.products.some(product => product.compareAtPrice !== null)).toBe(true);
  });
  it('has valid local representative media and official product source evidence', () => {
    const publicRoot = path.resolve('..', 'frontend', 'public');
    for (const product of productDataset.products) {
      expect(product.sourceUrl).toMatch(/^https:\/\//);
      expect(product.specifications.length).toBeGreaterThanOrEqual(6);
      expect(product.images.filter(image => image.isPrimary)).toHaveLength(1);
      expect(product.images.length).toBeGreaterThanOrEqual(2);
      expect(product.images.some(image => !image.isPrimary)).toBe(true);
      expect(new Set(product.images.map(image => image.url)).size).toBe(product.images.length);
      if (product.categorySlug === 'smartphones' && product.brandSlug === 'apple') {
        const model = product.name.includes('iPhone 15') ? 'iphone15' : 'iphone16';
        const finish = (product.name.split(' — ')[1] ?? 'Black').toLowerCase();
        for (const image of product.images) {
          expect(image.url).toMatch(new RegExp(`^/images/catalog/variety/${model}-${finish}-[1-3]\\.jpg$`));
        }
      }
      if (product.categorySlug === 'smartphones' && product.brandSlug === 'samsung') {
        expect(product.images[0]?.url).toMatch(/^\/images\/catalog\/(variety\/smartphones-samsung-0[1-3]\.jpg|smartphones\.jpg)$/);
      }
      const variantFamilies = [
        ['apple-macbook-air-13-m3', 'macbook13', 'Silver'],
        ['apple-macbook-air-15-m3', 'macbook15', 'Silver'],
        ['apple-ipad-air-11-m2-128gb', 'ipadair', 'Blue'],
        ['apple-ipad-10-64gb', 'ipad10', 'Silver'],
        ['samsung-galaxy-tab-s9-128gb', 'galaxytab', 'Graphite'],
        ['apple-watch-se-2-40mm-gps', 'watchse', 'Midnight'],
        ['apple-watch-series-9-41mm-gps', 'watchseries9', 'Pink'],
      ] as const;
      const family = variantFamilies.find(([slug]) => product.slug.startsWith(slug));
      if (family) {
        const finish = (product.name.split(' — ')[1] ?? family[2]).toLowerCase().replace(/\s+/g, '');
        for (const image of product.images) {
          expect(image.url).toMatch(new RegExp(`^/images/catalog/variety/${family[1]}-${finish}-[1-6]\\.jpg$`));
        }
      }
      const deviceMedia = new Map([
        ['lenovo-thinkpad-x1-carbon-gen-12', 'thinkpad'],
        ['sony-wh-1000xm5', 'sonyheadphones'],
        ['jbl-tune-770nc', 'jblheadphones'],
        ['samsung-galaxy-buds2-pro', 'galaxybuds'],
        ['samsung-galaxy-watch6-40mm', 'galaxywatch'],
        ['sony-playstation-5-launch-disc', 'playstation5'],
        ['asus-rog-ally-z1-extreme', 'rogally'],
        ['acer-predator-cestus-330', 'acermouse'],
        ['lg-27ul500-w', 'monitor-lg'],
        ['dell-p2422h', 'monitor-dell'],
        ['asus-tuf-gaming-vg249q1a', 'monitor-asus'],
        ['hp-975-dual-mode-wireless-keyboard', 'accessory-hp-keyboard'],
        ['lenovo-go-usb-c-wireless-mouse', 'accessory-lenovo-mouse'],
        ['sony-dualsense-wireless-controller', 'accessory-sony-controller'],
      ]);
      const devicePrefix = deviceMedia.get(product.slug);
      if (devicePrefix) {
        for (const image of product.images) {
          expect(image.url).toMatch(new RegExp(`^/images/catalog/variety/${devicePrefix}-0[1-2]\\.jpg$`));
        }
      }
      for (const image of product.images) {
        const file = path.join(publicRoot, image.url.replace(/^\//, ''));
        expect(existsSync(file)).toBe(true);
        const media = readFileSync(file);
        if (image.url.endsWith('.svg')) {
          const markup = media.toString('utf8');
          expect(markup).toContain('<title');
          expect(markup).toContain('Generic demo illustration');
          expect(markup).not.toMatch(/<script|(?:href|src)=["']https?:\/\//);
        } else {
          expect(image.url).toMatch(/^\/images\/catalog\/(?:variety\/[a-z0-9-]+|[a-z]+(?:-detail)?)\.jpg$/);
          expect([...media.subarray(0, 3)]).toEqual([255, 216, 255]);
        }
      }
    }
    for (const category of productDataset.categories) {
      const generatedMediaNames = category.slug === 'smartphones'
        ? ['smartphones-apple-01.jpg', 'smartphones-apple-02.jpg', 'smartphones-apple-03.jpg', 'smartphones-samsung-01.jpg', 'smartphones-samsung-02.jpg', 'smartphones-samsung-03.jpg']
        : ['01', '02', '03'].map(imageNumber => `${category.slug}-${imageNumber}.jpg`);
      for (const imageName of generatedMediaNames) {
        expect(existsSync(path.join(publicRoot, 'images', 'catalog', 'variety', imageName))).toBe(true);
      }
    }
    for (const category of productDataset.categories) expect(existsSync(path.join(publicRoot, category.imageUrl.replace(/^\//, '')))).toBe(true);
  });
  it('limits primary and alternate image reuse to two products', () => {
    const primaryUsage = new Map<string, number>();
    const imageUsage = new Map<string, number>();
    for (const product of productDataset.products) {
      for (const image of product.images) {
        imageUsage.set(image.url, (imageUsage.get(image.url) ?? 0) + 1);
        if (image.isPrimary) primaryUsage.set(image.url, (primaryUsage.get(image.url) ?? 0) + 1);
      }
    }
    expect(Math.max(...primaryUsage.values())).toBeLessThanOrEqual(2);
    expect(Math.max(...imageUsage.values())).toBeLessThanOrEqual(2);
  });
  it('does not assign the same ordered image pair to different Products', () => {
    const pairs = productDataset.products.map(product => product.images.map(image => image.url).join('|'));
    expect(new Set(pairs).size).toBe(pairs.length);
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
    expect(first).toEqual({ products: 128, categories: 8, brands: 10, images: 256, specifications: 897 });
    expect(saved.size).toBe(129);
    expect(saved.get('LEGACY')).toBe(legacy);
    expect(transaction.productImage.deleteMany.mock.calls.every(([args]) => args.where.productId !== 'legacy')).toBe(true);
    expect([...saved.values()].filter(product => product.sku !== 'LEGACY').every(product => product.brandId != null)).toBe(true);
  });
});
