import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import type { PrismaClient } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { assertExpansionTarget, expansionCategoryCounts, expansionOwnedId, seedCatalogExpansion,
  expansionDigest, validateExpansionDataset, validateExpansionMedia, type ExpansionOptions } from '../prisma/catalog-expansion.js';

const qa = { NODE_ENV: 'test', DATABASE_URL: 'postgresql://test:test@127.0.0.1:55434/electrohub_disposable_catalog',
  DIRECT_URL: 'postgresql://test:test@127.0.0.1:55434/electrohub_disposable_catalog' };
const dev = { NODE_ENV: 'development', DATABASE_URL: 'postgresql://postgres:test@db.pzxekjybdiulzmssalfo.supabase.co:5432/postgres',
  DIRECT_URL: 'postgresql://postgres:test@db.pzxekjybdiulzmssalfo.supabase.co:5432/postgres' };

function fixture() {
  const categories = Object.keys(expansionCategoryCounts).map(slug => ({ slug, name: slug, description: 'Fixture category',
    imageUrl: `/images/catalog/expansion/category-${slug}.png` }));
  const products = Object.entries(expansionCategoryCounts).flatMap(([categorySlug, count]) => Array.from({ length: count }, () => categorySlug))
    .map((categorySlug, index) => ({ sku: `EH-CE-${String(index + 1).padStart(3, '0')}`, slug: `fixture-${index + 1}`,
      name: `Fixture model ${index + 1}`, modelNumber: null, brandSlug: 'fixture-brand', categorySlug,
      description: 'Synthetic unit-test product, never a catalog entry.', price: '199.00', compareAtPrice: null,
      status: 'ACTIVE', quantity: 20, sourceUrl: 'https://example.com/unit-test',
      images: [0, 1].map(sortOrder => ({ url: `/images/catalog/expansion/fixture-${index + 1}-${sortOrder}.png`,
        altText: `Fixture image ${index + 1} ${sortOrder}`, sortOrder, isPrimary: sortOrder === 0 })),
      specifications: Array.from({ length: 6 }, (_, order) => ({ group: 'Fixture', name: `Feature ${order}`, value: 'Test only', sortOrder: order })),
    }));
  return { categories, brands: [{ slug: 'fixture-brand', name: 'Fixture brand', description: null, logoUrl: null }], products };
}

// Generate genuine distinct PNG fixtures, including CRCs and compressed 600x600 RGB data.
function png(color: number) {
  const chunk = (type: string, bytes: Buffer) => {
    const content = Buffer.concat([Buffer.from(type), bytes]); let crc = 0xffffffff;
    for (const byte of content) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
    }
    const header = Buffer.alloc(4); header.writeUInt32BE(bytes.length);
    const trailer = Buffer.alloc(4); trailer.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
    return Buffer.concat([header, content, trailer]);
  };
  const header = Buffer.alloc(13); header.writeUInt32BE(600); header.writeUInt32BE(600, 4); header[8] = 8; header[9] = 2;
  const pixels = Buffer.alloc(600 * 1801, color);
  for (let row = 0; row < 600; row++) pixels[row * 1801] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(pixels)), chunk('IEND', Buffer.alloc(0))]);
}

type Row = Record<string, unknown> & { id: string };
function modelDb() {
  const tables = { category: new Map<string, Row>(), brand: new Map<string, Row>(), product: new Map<string, Row>(),
    productImage: new Map<string, Row>(), productSpecification: new Map<string, Row>(), inventory: new Map<string, Row>() };
  const mutation = vi.fn();
  const delegates = Object.fromEntries(Object.entries(tables).map(([table, rows]) => [table, {
    findMany: async ({ where }: { where: { OR?: Array<Record<string, { in: string[] }>>; id?: { in: string[] } } }) => [...rows.values()]
      .filter(row => where.id ? where.id.in.includes(row.id) : where.OR!.some(condition => Object.entries(condition).some(([key, value]) => value.in.includes(String(row[key])))))
      .map(row => table !== 'product' ? row : { ...row,
        images: [...tables.productImage.values()].filter(image => image.productId === row.id),
        specifications: [...tables.productSpecification.values()].filter(spec => spec.productId === row.id),
        inventory: [...tables.inventory.values()].find(inventory => inventory.productId === row.id) ?? null }),
    create: async ({ data }: { data: Row }) => { mutation(table, 'create'); const saved = { ...data, id: data.id ?? `${table}-${rows.size}` }; rows.set(saved.id, saved); return saved; },
    createMany: async ({ data }: { data: Row[] }) => {
      mutation(table, 'createMany', data.length);
      for (const value of data) { const saved = { ...value, id: value.id ?? `${table}-${rows.size}` }; rows.set(saved.id, saved); }
      return { count: data.length };
    },
    update: async ({ where, data }: { where: { id: string }; data: object }) => {
      mutation(table, 'update'); const saved = { ...rows.get(where.id), ...data, id: where.id }; rows.set(where.id, saved); return saved;
    },
    upsert: async ({ where, create, update }: { where: { id: string }; create: Row; update: object }) => {
      mutation(table, 'upsert'); const saved = rows.has(where.id) ? { ...rows.get(where.id), ...update, id: where.id } : create;
      rows.set(saved.id, saved); return saved;
    },
  }]));
  const transaction = vi.fn(async (fn: (tx: unknown) => Promise<unknown>, _settings: unknown) => fn(delegates));
  return { tables, mutation, transaction, client: { $transaction: transaction } as unknown as PrismaClient };
}

describe('Dedicated additive catalog expansion boundary', () => {
  let root: string;
  let dataset: ReturnType<typeof fixture>;
  let manifest: { version: number; assets: Array<Record<string, unknown>> };
  let options: ExpansionOptions;
  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'electrohub-expansion-unit-'));
    await mkdir(path.join(root, 'images/catalog/expansion'), { recursive: true });
    dataset = fixture();
    const references = [
      ...dataset.categories.map(category => ({ path: category.imageUrl, sku: null, categorySlug: category.slug, brandSlug: null })),
      ...dataset.products.flatMap(product => product.images.map(image => ({ path: image.url, sku: product.sku, categorySlug: product.categorySlug, brandSlug: product.brandSlug }))),
    ];
    const assets = [];
    for (const [index, reference] of references.entries()) {
      const bytes = png(index + 1); await writeFile(path.join(root, reference.path), bytes);
      assets.push({ ...reference, kind: 'ai-generated', source: 'synthetic unit-test PNG; no real catalog approval',
        commercialDisplayRights: 'approved', mlTrainingRights: 'not-assessed', redistributionRights: 'not-assessed',
        sha256: createHash('sha256').update(bytes).digest('hex'), width: 600, height: 600, view: String(index), reviewStatus: 'approved' });
    }
    manifest = { version: 1, assets };
    const mediaReview = { manifestSha256: expansionDigest(manifest), assets: assets.map(asset => ({ path: asset.path,
      sha256: asset.sha256, width: 600, height: 600, decoded: true, visuallyApproved: true })) };
    options = { dataset, manifest, mediaReview, publicRoot: root, target: 'qa', configuration: qa };
  });
  afterAll(async () => { if (root) await rm(root, { recursive: true, force: true }); });

  it('rejects production, mixed targets, unconfigured destinations and shared DEV used as QA', () => {
    expect(() => assertExpansionTarget(qa, 'qa')).not.toThrow();
    expect(() => assertExpansionTarget(dev, 'dev')).not.toThrow();
    expect(() => assertExpansionTarget(dev, 'qa')).toThrow(/isolated/);
    expect(() => assertExpansionTarget(qa, 'dev')).toThrow(/DEV/);
    expect(() => assertExpansionTarget({}, 'qa')).toThrow();
    expect(() => assertExpansionTarget({ ...dev, DIRECT_URL: qa.DIRECT_URL }, 'dev')).toThrow();
    expect(() => assertExpansionTarget({ ...dev, DATABASE_URL: dev.DATABASE_URL.replace('pzxekjybdiulzmssalfo', 'yepfgjehdstlxbpespun') }, 'dev')).toThrow();
    expect(() => assertExpansionTarget({ ...dev, NODE_ENV: 'test' }, 'dev')).toThrow();
  });
  it('requires all 79 approved identities, exact category distribution, active status and absent discount prices', () => {
    expect(validateExpansionDataset(dataset).products).toHaveLength(79);
    const bad = structuredClone(dataset); bad.products[0]!.sku = 'EH-CE-999';
    expect(() => validateExpansionDataset(bad)).toThrow(/explicit/);
    const discount = structuredClone(dataset); Reflect.set(discount.products[0]!, 'compareAtPrice', '200.00');
    expect(() => validateExpansionDataset(discount)).toThrow(/policy/);
    const count = structuredClone(dataset); count.products[0]!.categorySlug = 'smart-home';
    expect(() => validateExpansionDataset(count)).toThrow(/count/);
  });
  it('fails closed before contacting a database when provenance is unapproved or local media has changed', async () => {
    const db = modelDb(); const unapproved = structuredClone(manifest); unapproved.assets[0]!.reviewStatus = 'pending';
    await expect(seedCatalogExpansion(db.client, { ...options, manifest: unapproved, apply: true })).rejects.toThrow();
    expect(db.transaction).not.toHaveBeenCalled();
    const corrupt = structuredClone(manifest); corrupt.assets[0]!.sha256 = '0'.repeat(64);
    const corruptReview = { ...options.mediaReview as object, manifestSha256: expansionDigest(corrupt) };
    await expect(seedCatalogExpansion(db.client, { ...options, manifest: corrupt, mediaReview: corruptReview, apply: true })).rejects.toThrow(/checksum/);
    expect(db.transaction).not.toHaveBeenCalled();
    const missing = structuredClone(manifest); missing.assets[0]!.path = '/images/catalog/expansion/absent.png';
    const missingReview = { ...options.mediaReview as object, manifestSha256: expansionDigest(missing) };
    await expect(validateExpansionMedia(validateExpansionDataset(dataset), missing, root, missingReview)).rejects.toThrow(/provenance/);
    await expect(seedCatalogExpansion(db.client, { ...options, mediaReview: undefined })).rejects.toThrow();
  });
  it('defaults to read-only and reports all intended creations without any mutations', async () => {
    const db = modelDb(); const result = await seedCatalogExpansion(db.client, options);
    expect(result.mode).toBe('dry-run'); expect(result.products.created).toBe(79); expect(result.categories.created).toBe(8);
    expect(result.images.created).toBe(158); expect(db.mutation).not.toHaveBeenCalled();
    expect(db.transaction.mock.calls[0]?.[1]).toEqual({ isolationLevel: 'Serializable', maxWait: 5000, timeout: 120000 });
  });
  it('preserves unrelated catalog and commerce state, inventory changes, owned child IDs and zero-write repeat runs', async () => {
    const db = modelDb();
    db.tables.product.set('unrelated', { id: 'unrelated', sku: 'EH-025-001', slug: 'existing-product', price: '99.00' });
    db.tables.productImage.set('unrelated-image', { id: 'unrelated-image', productId: 'unrelated', url: '/existing.jpg' });
    const first = await seedCatalogExpansion(db.client, { ...options, apply: true });
    expect(first.products.created).toBe(79); expect(db.tables.product.size).toBe(80);
    expect(db.mutation.mock.calls.every(call => call[1] !== 'createMany' || Number(call[2]) <= 100)).toBe(true);
    const ownedId = expansionOwnedId('product/EH-CE-001');
    const inventory = [...db.tables.inventory.values()].find(row => row.productId === ownedId)!; inventory.quantity = 3;
    const before = JSON.stringify([...db.tables.productImage]); db.mutation.mockClear();
    const second = await seedCatalogExpansion(db.client, { ...options, apply: true });
    expect(second.products).toEqual({ created: 0, updated: 0, skipped: 79 });
    expect(second.inventories).toEqual({ created: 0, preserved: 79 });
    expect(db.mutation).not.toHaveBeenCalled(); expect(inventory.quantity).toBe(3);
    expect(JSON.stringify([...db.tables.productImage])).toBe(before);
    expect(db.tables.product.get('unrelated')).toEqual({ id: 'unrelated', sku: 'EH-025-001', slug: 'existing-product', price: '99.00' });
  });
  it('preflights every identity before the first mutation, including late product and name/slug collisions', async () => {
    const db = modelDb(); const last = dataset.products[78]!;
    db.tables.product.set('foreign', { id: 'foreign', sku: last.sku, slug: last.slug });
    await expect(seedCatalogExpansion(db.client, { ...options, apply: true })).rejects.toThrow(/ownership conflict/);
    expect(db.mutation).not.toHaveBeenCalled();
    db.tables.product.clear();
    db.tables.brand.set('other-brand', { id: 'other-brand', slug: 'other-brand', name: 'Fixture brand' });
    await expect(seedCatalogExpansion(db.client, { ...options, apply: true })).rejects.toThrow(/name\/slug conflict/);
    expect(db.mutation).not.toHaveBeenCalled();
  });
  it('refuses deterministic child-ID theft and inactive or mismatched category media before mutation', async () => {
    const db = modelDb(); const imageId = expansionOwnedId('image/EH-CE-079/1');
    db.tables.productImage.set(imageId, { id: imageId, productId: 'unrelated', url: '/unrelated.jpg' });
    await expect(seedCatalogExpansion(db.client, { ...options, apply: true })).rejects.toThrow(/child identity/);
    expect(db.mutation).not.toHaveBeenCalled(); db.tables.productImage.clear();
    db.tables.category.set('existing-category', { id: 'existing-category', ...dataset.categories[0]!, isActive: false });
    await expect(seedCatalogExpansion(db.client, { ...options, apply: true })).rejects.toThrow(/activity\/media conflict/);
    expect(db.mutation).not.toHaveBeenCalled();
  });
  it('requires dataset/media-bound isolated QA and explicit project approval before exported DEV apply', async () => {
    const db = modelDb(); const qaEvidence = { datasetSha256: expansionDigest(validateExpansionDataset(dataset)),
      manifestSha256: expansionDigest(manifest), targetIdentity: 'loopback:55434/electrohub_disposable_catalog',
      repeatVerified: true, unrelatedPreserved: true } as const;
    await expect(seedCatalogExpansion(db.client, { ...options, target: 'dev', configuration: dev, apply: true, qaEvidence })).rejects.toThrow(/explicit project approval/);
    expect(db.transaction).not.toHaveBeenCalled();
    const approved = { ...dev, CATALOG_EXPANSION_DEV_APPROVED: 'pzxekjybdiulzmssalfo' };
    await expect(seedCatalogExpansion(db.client, { ...options, target: 'dev', configuration: approved, apply: true,
      qaEvidence: { ...qaEvidence, datasetSha256: '0'.repeat(64) } })).rejects.toThrow(/isolated repeat/);
    expect(db.transaction).not.toHaveBeenCalled();
    const applied = await seedCatalogExpansion(db.client, { ...options, target: 'dev', configuration: approved, apply: true, qaEvidence });
    expect(applied.products.created).toBe(79);
  });
  it('refuses category reassignment and unrelated child media on managed products without deleting anything', async () => {
    const db = modelDb(); await seedCatalogExpansion(db.client, { ...options, apply: true }); db.mutation.mockClear();
    const owned = db.tables.product.get(expansionOwnedId('product/EH-CE-001'))!;
    const categoryId = owned.categoryId; owned.categoryId = 'foreign-category';
    await expect(seedCatalogExpansion(db.client, { ...options, apply: true })).rejects.toThrow(/category/);
    expect(db.mutation).not.toHaveBeenCalled(); owned.categoryId = categoryId;
    db.tables.productImage.set('manual-image', { id: 'manual-image', productId: owned.id, url: '/manual.jpg' });
    await expect(seedCatalogExpansion(db.client, { ...options, apply: true })).rejects.toThrow(/unrelated media/);
    expect(db.mutation).not.toHaveBeenCalled(); expect(db.tables.productImage.has('manual-image')).toBe(true);
  });
  it('updates an owned field and child in place without rewriting stock or stable image IDs', async () => {
    const db = modelDb(); await seedCatalogExpansion(db.client, { ...options, apply: true }); db.mutation.mockClear();
    db.tables.product.get(expansionOwnedId('product/EH-CE-001'))!.name = 'Old name';
    const imageId = expansionOwnedId('image/EH-CE-001/0'); db.tables.productImage.get(imageId)!.altText = 'Old alt';
    const result = await seedCatalogExpansion(db.client, { ...options, apply: true });
    expect(result.products.updated).toBe(1); expect(result.images.updated).toBe(1);
    expect(db.mutation.mock.calls).toEqual([['product', 'update'], ['productImage', 'update']]);
    expect(db.tables.productImage.get(imageId)!.altText).toBe(dataset.products[0]!.images[0]!.altText);
    const firstPath = String(manifest.assets[0]!.path); expect((await readFile(path.join(root, firstPath))).length).toBeGreaterThan(1000);
  });
});
