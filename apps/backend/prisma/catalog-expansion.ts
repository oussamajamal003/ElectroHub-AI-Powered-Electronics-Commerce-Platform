import { createHash } from 'node:crypto';
import { readFile, realpath } from 'node:fs/promises';
import path from 'node:path';
import { Prisma, type PrismaClient } from '@prisma/client';
import { z } from 'zod';
import { assertDevSeedTarget, validateProductDataset } from './product-seed.js';
import { resolveDatabaseTargets } from '../src/lib/database-target.js';

export const expansionCategoryCounts = {
  'cameras-photography': 8, 'speakers-audio': 12, 'storage-ssds': 10,
  'computer-components': 15, 'networking-wifi': 8, 'smart-home': 10,
  'keyboards-mice': 10, 'printers-scanners': 6,
} as const;
export const expansionSkus = Array.from({ length: 79 }, (_, index) => `EH-CE-${String(index + 1).padStart(3, '0')}`);
export const expansionDigest = (value: unknown): string => createHash('sha256').update(JSON.stringify(value)).digest('hex');

/** Stable IDs are the ownership marker, not a broad SKU-prefix claim over existing rows. */
export function expansionOwnedId(key: string): string {
  const bytes = createHash('sha256').update(`electrohub/catalog-expansion/v1/${key}`).digest().subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export function validateExpansionDataset(input: unknown) {
  const data = validateProductDataset(input);
  if (data.categories.length !== 8 || data.products.length !== 79 ||
      expansionSkus.some(sku => !data.products.some(product => product.sku === sku))) {
    throw new Error('Expansion requires exactly eight categories and the 79 explicit EH-CE-001..079 identities.');
  }
  for (const [slug, count] of Object.entries(expansionCategoryCounts)) {
    if (!data.categories.some(category => category.slug === slug) ||
        data.products.filter(product => product.categorySlug === slug).length !== count) {
      throw new Error(`Expansion category count mismatch: ${slug}.`);
    }
  }
  for (const product of data.products) {
    if (product.status !== 'ACTIVE' || product.compareAtPrice !== null || !product.sourceUrl.startsWith('https://') ||
        product.images.length !== 2 || product.images.some(image => !image.url.startsWith('/images/catalog/expansion/'))) {
      throw new Error(`Expansion product policy invalid: ${product.sku}.`);
    }
  }
  const productMedia = data.products.flatMap(product => product.images.map(image => image.url));
  if (new Set(productMedia).size !== 158) throw new Error('Expansion requires distinct product-specific image paths.');
  return data;
}

export const expansionManifestSchema = z.object({
  version: z.literal(1),
  assets: z.array(z.object({
    path: z.string().regex(/^\/images\/catalog\/expansion\/[a-z0-9/-]+\.(?:webp|jpg|png)$/),
    sku: z.string().nullable(), categorySlug: z.string(), brandSlug: z.string().nullable(),
    kind: z.enum(['ai-generated', 'manufacturer-photo', 'licensed-photo']), source: z.string().min(1),
    commercialDisplayRights: z.literal('approved'), mlTrainingRights: z.string().min(1),
    redistributionRights: z.string().min(1), sha256: z.string().regex(/^[a-f0-9]{64}$/),
    width: z.number().int().min(600).max(8192), height: z.number().int().min(600).max(8192),
    view: z.string().min(1), reviewStatus: z.literal('approved'),
  }).passthrough()).length(166),
}).passthrough();

/** File hashing precedes every transaction; approval covers actual decoded/visually reviewed bytes. */
export const expansionMediaReviewSchema = z.object({
  manifestSha256: z.string().regex(/^[a-f0-9]{64}$/),
  assets: z.array(z.object({
    path: z.string(), sha256: z.string().regex(/^[a-f0-9]{64}$/),
    width: z.number().int().positive(), height: z.number().int().positive(),
    decoded: z.literal(true), visuallyApproved: z.literal(true),
  }).strict()).length(166),
}).strict();

export async function validateExpansionMedia(data: ReturnType<typeof validateExpansionDataset>, input: unknown, publicRoot: string, reviewInput: unknown) {
  const manifest = expansionManifestSchema.parse(input);
  // The external decoder/visual reviewer must attest to these exact bytes. This module performs
  // no image decoding itself and must never upgrade a planned manifest into reviewed artwork.
  const review = expansionMediaReviewSchema.parse(reviewInput);
  if (review.manifestSha256 !== expansionDigest(manifest) || new Set(review.assets.map(asset => asset.path)).size !== 166) {
    throw new Error('Expansion media review does not match the approved manifest.');
  }
  const expected = [
    ...data.categories.map(category => ({ path: category.imageUrl, sku: null, categorySlug: category.slug, brandSlug: null })),
    ...data.products.flatMap(product => product.images.map(image => ({ path: image.url, sku: product.sku,
      categorySlug: product.categorySlug, brandSlug: product.brandSlug }))),
  ];
  if (new Set(manifest.assets.map(asset => asset.path)).size !== 166 || new Set(expected.map(asset => asset.path)).size !== 166) {
    throw new Error('Expansion manifest paths must be unique.');
  }
  const root = await realpath(publicRoot);
  const checksums = new Set<string>();
  for (const required of expected) {
    const asset = manifest.assets.find(candidate => candidate.path === required.path);
    if (!asset || asset.sku !== required.sku || asset.brandSlug !== required.brandSlug || asset.categorySlug !== required.categorySlug) {
      throw new Error(`Expansion media provenance mismatch: ${required.path}.`);
    }
    const filename = await realpath(path.join(root, asset.path));
    const relative = path.relative(root, filename);
    if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error('Expansion media escapes public directory.');
    const bytes = await readFile(filename);
    const digest = createHash('sha256').update(bytes).digest('hex');
    if (digest !== asset.sha256 || checksums.has(digest)) throw new Error(`Expansion media checksum mismatch or duplicate: ${asset.path}.`);
    const decoded = review.assets.find(entry => entry.path === asset.path);
    if (!decoded || decoded.sha256 !== digest || decoded.width !== asset.width || decoded.height !== asset.height) {
      throw new Error(`Expansion decoded/visual review mismatch: ${asset.path}.`);
    }
    checksums.add(digest);
    const validHeader = asset.path.endsWith('.webp') ? bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP'
      : asset.path.endsWith('.png') ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[bytes.length - 2] === 0xff && bytes[bytes.length - 1] === 0xd9;
    if (!validHeader || bytes.length < 1000) throw new Error(`Expansion media is not an approved raster file: ${asset.path}.`);
  }
  return manifest;
}

export function assertExpansionTarget(configuration: NodeJS.ProcessEnv, target: 'qa' | 'dev') {
  if (target !== 'qa' && target !== 'dev') throw new Error('Expansion requires an explicit QA or DEV target.');
  assertDevSeedTarget(configuration);
  const resolved = resolveDatabaseTargets(configuration);
  if (target === 'qa' && resolved.runtime.category !== 'disposable') throw new Error('Expansion QA requires an isolated disposable database.');
  if (target === 'dev' && resolved.runtime.category !== 'dev') throw new Error('Expansion DEV requires the approved shared DEV project.');
  return resolved.runtime.identity;
}

export interface ExpansionOptions {
  dataset: unknown;
  manifest: unknown;
  mediaReview: unknown;
  publicRoot: string;
  target: 'qa' | 'dev';
  configuration?: NodeJS.ProcessEnv;
  /** Read-only by default. DEV apply also requires project approval and exact-data isolated QA evidence. */
  apply?: boolean;
  qaEvidence?: {
    datasetSha256: string; manifestSha256: string; targetIdentity: string;
    repeatVerified: true; unrelatedPreserved: true;
  };
}

const same = (actual: unknown, expected: unknown) => String(actual ?? '') === String(expected ?? '');
const differs = (actual: object, expected: object) => Object.entries(expected).some(([key, value]) => !same(Reflect.get(actual, key), value));

export async function seedCatalogExpansion(client: PrismaClient, options: ExpansionOptions) {
  const identity = assertExpansionTarget(options.configuration ?? process.env, options.target);
  const data = validateExpansionDataset(options.dataset);
  const manifest = await validateExpansionMedia(data, options.manifest, options.publicRoot, options.mediaReview);
  if (options.apply && options.target === 'dev') {
    const evidence = options.qaEvidence;
    if ((options.configuration ?? process.env).CATALOG_EXPANSION_DEV_APPROVED !== 'pzxekjybdiulzmssalfo' ||
        !evidence || evidence.datasetSha256 !== expansionDigest(data) || evidence.manifestSha256 !== expansionDigest(manifest) ||
        !/^loopback:\d+\/electrohub_(?:disposable|ci)[a-z0-9_]*$/.test(evidence.targetIdentity) ||
        evidence.repeatVerified !== true || evidence.unrelatedPreserved !== true) {
      throw new Error('Expansion DEV apply requires explicit project approval and matching successful isolated repeat/preservation evidence.');
    }
  }
  return client.$transaction(async tx => {
    // Preflight every natural key and owned child before the first mutation. Serializable isolation
    // plus unique constraints abort racing writers; callers must review failures, not auto-retry.
    const imageOwners = new Map(data.products.flatMap(product => product.images.map(image => [expansionOwnedId(`image/${product.sku}/${image.sortOrder}`), expansionOwnedId(`product/${product.sku}`)])));
    const specOwners = new Map(data.products.flatMap(product => product.specifications.map(spec => [expansionOwnedId(`spec/${product.sku}/${spec.group}/${spec.name}`), expansionOwnedId(`product/${product.sku}`)])));
    const [categories, brands, products, images, specs] = await Promise.all([
      tx.category.findMany({ where: { OR: [{ slug: { in: data.categories.map(row => row.slug) } }, { name: { in: data.categories.map(row => row.name) } },
        { id: { in: data.categories.map(row => expansionOwnedId(`category/${row.slug}`)) } }] } }),
      tx.brand.findMany({ where: { OR: [{ slug: { in: data.brands.map(row => row.slug) } }, { name: { in: data.brands.map(row => row.name) } },
        { id: { in: data.brands.map(row => expansionOwnedId(`brand/${row.slug}`)) } }] } }),
      tx.product.findMany({ where: { OR: [{ sku: { in: expansionSkus } }, { slug: { in: data.products.map(row => row.slug) } },
        { id: { in: expansionSkus.map(sku => expansionOwnedId(`product/${sku}`)) } }] },
      include: { images: true, specifications: true, inventory: true } }),
      tx.productImage.findMany({ where: { id: { in: [...imageOwners.keys()] } } }),
      tx.productSpecification.findMany({ where: { id: { in: [...specOwners.keys()] } } }),
    ]);
    if (images.some(image => image.productId !== imageOwners.get(image.id)) || specs.some(spec => spec.productId !== specOwners.get(spec.id))) {
      throw new Error('Expansion child identity belongs to an unrelated product.');
    }
    for (const [planned, existing, label] of [[data.categories, categories, 'category'], [data.brands, brands, 'brand']] as const) {
      for (const row of planned) {
        if (existing.some(found => (found.slug === row.slug || found.name === row.name || found.id === expansionOwnedId(`${label}/${row.slug}`)) &&
            (found.slug !== row.slug || found.name !== row.name))) {
          throw new Error(`Expansion ${label} name/slug conflict: ${row.slug}.`);
        }
      }
    }
    for (const category of data.categories) {
      const existing = categories.find(row => row.slug === category.slug);
      if (existing && (!existing.isActive || existing.imageUrl !== category.imageUrl)) {
        throw new Error(`Expansion category activity/media conflict: ${category.slug}.`);
      }
    }
    for (const product of data.products) {
      const matches = products.filter(row => row.sku === product.sku || row.slug === product.slug || row.id === expansionOwnedId(`product/${product.sku}`));
      const existing = matches[0];
      if (matches.length > 1 || existing && (existing.id !== expansionOwnedId(`product/${product.sku}`) || existing.sku !== product.sku || existing.slug !== product.slug ||
          existing.categoryId !== categories.find(row => row.slug === product.categorySlug)?.id ||
          existing.brandId !== brands.find(row => row.slug === product.brandSlug)?.id || existing.isTestFixture)) {
        throw new Error(`Expansion product identity/category/brand ownership conflict: ${product.sku}.`);
      }
      if (existing) {
        const managedImages = product.images.map(image => expansionOwnedId(`image/${product.sku}/${image.sortOrder}`));
        const managedSpecs = product.specifications.map(spec => expansionOwnedId(`spec/${product.sku}/${spec.group}/${spec.name}`));
        if (existing.images.some(image => !managedImages.includes(image.id)) || existing.specifications.some(spec => !managedSpecs.includes(spec.id))) {
          throw new Error(`Expansion managed product contains unrelated media/specifications: ${product.sku}.`);
        }
      }
    }
    const summary = { mode: options.apply ? 'apply' : 'dry-run', identity,
      categories: { created: 0, skipped: categories.length }, brands: { created: 0, skipped: brands.length },
      products: { created: 0, updated: 0, skipped: 0 }, images: { created: 0, updated: 0 }, specifications: { created: 0, updated: 0 },
      inventories: { created: 0, preserved: 0 } };
    const categoryIds = new Map(categories.map(row => [row.slug, row.id]));
    const brandIds = new Map(brands.map(row => [row.slug, row.id]));
    const newCategories: Prisma.CategoryCreateManyInput[] = [];
    const newBrands: Prisma.BrandCreateManyInput[] = [];
    const newProducts: Prisma.ProductCreateManyInput[] = [];
    const newImages: Prisma.ProductImageCreateManyInput[] = [];
    const newSpecs: Prisma.ProductSpecificationCreateManyInput[] = [];
    const newInventories: Prisma.InventoryCreateManyInput[] = [];
    for (const category of data.categories) {
      if (categoryIds.has(category.slug)) continue;
      const id = expansionOwnedId(`category/${category.slug}`);
      categoryIds.set(category.slug, id); summary.categories.created++;
      newCategories.push({ ...category, id, isActive: true });
    }
    for (const brand of data.brands) {
      if (brandIds.has(brand.slug)) continue;
      const id = expansionOwnedId(`brand/${brand.slug}`);
      brandIds.set(brand.slug, id); summary.brands.created++;
      newBrands.push({ ...brand, id });
    }
    for (const product of data.products) {
      const id = expansionOwnedId(`product/${product.sku}`);
      const existing = products.find(row => row.id === id);
      const fields = { sku: product.sku, slug: product.slug, name: product.name, description: product.description,
        modelNumber: product.modelNumber, categoryId: categoryIds.get(product.categorySlug)!, brandId: brandIds.get(product.brandSlug)!,
        price: new Prisma.Decimal(product.price), compareAtPrice: null, status: 'ACTIVE' as const, storefrontVisible: true, isTestFixture: false };
      if (!existing) {
        summary.products.created++;
        newProducts.push({ id, ...fields });
      } else if (differs(existing, fields)) {
        summary.products.updated++;
        if (options.apply) await tx.product.update({ where: { id }, data: fields });
      } else summary.products.skipped++;
      for (const image of product.images) {
        const imageId = expansionOwnedId(`image/${product.sku}/${image.sortOrder}`);
        const previous = existing?.images.find(row => row.id === imageId);
        if (previous && !differs(previous, image)) continue;
        summary.images[previous ? 'updated' : 'created']++;
        if (!previous) newImages.push({ id: imageId, productId: id, ...image });
        else if (options.apply) await tx.productImage.update({ where: { id: imageId }, data: image });
      }
      for (const spec of product.specifications) {
        const specId = expansionOwnedId(`spec/${product.sku}/${spec.group}/${spec.name}`);
        const previous = existing?.specifications.find(row => row.id === specId);
        if (previous && !differs(previous, spec)) continue;
        summary.specifications[previous ? 'updated' : 'created']++;
        if (!previous) newSpecs.push({ id: specId, productId: id, ...spec });
        else if (options.apply) await tx.productSpecification.update({ where: { id: specId }, data: spec });
      }
      if (existing?.inventory) summary.inventories.preserved++;
      else {
        summary.inventories.created++;
        newInventories.push({ productId: id, quantity: product.quantity, lowStockAt: 5,
          status: product.quantity === 0 ? 'OUT_OF_STOCK' : product.quantity <= 5 ? 'LOW_STOCK' : 'IN_STOCK' });
      }
    }
    if (options.apply) {
      // Bound inserts to 100 rows per statement while retaining one atomic, finite transaction.
      // New IDs are known before insertion, so no per-record remote round trip is necessary.
      for (let offset = 0; offset < newCategories.length; offset += 100) await tx.category.createMany({ data: newCategories.slice(offset, offset + 100) });
      for (let offset = 0; offset < newBrands.length; offset += 100) await tx.brand.createMany({ data: newBrands.slice(offset, offset + 100) });
      for (let offset = 0; offset < newProducts.length; offset += 100) await tx.product.createMany({ data: newProducts.slice(offset, offset + 100) });
      for (let offset = 0; offset < newImages.length; offset += 100) await tx.productImage.createMany({ data: newImages.slice(offset, offset + 100) });
      for (let offset = 0; offset < newSpecs.length; offset += 100) await tx.productSpecification.createMany({ data: newSpecs.slice(offset, offset + 100) });
      for (let offset = 0; offset < newInventories.length; offset += 100) await tx.inventory.createMany({ data: newInventories.slice(offset, offset + 100) });
    }
    return summary;
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 120000 });
}
