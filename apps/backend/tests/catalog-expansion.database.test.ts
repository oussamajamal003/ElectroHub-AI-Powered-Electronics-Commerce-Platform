import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { assertExpansionTarget, expansionOwnedId, seedCatalogExpansion, validateExpansionDataset } from '../prisma/catalog-expansion.js';
import { captureCatalogExpansionSnapshot, assertCatalogExpansionPreserved, assertCatalogExpansionUnchanged } from '../prisma/catalog-expansion-evidence.js';

/**
 * Explicit opt-in only: this test inserts the approved expansion into an existing disposable
 * database and retains its rows for API QA. It never initializes/resets a database or fabricates
 * production image approval. Export both verified isolated URLs and their trusted CA first.
 */
const enabled = process.env.CATALOG_EXPANSION_DATABASE_TEST === '1';

describe.skipIf(!enabled)('Catalog expansion: real isolated PostgreSQL preservation', () => {
  it('preflights without writes, preserves preexisting rows, and replays without changes', async () => {
    // This assertion precedes importing the application Prisma singleton or making a connection.
    assertExpansionTarget(process.env, 'qa');
    const manifestFile = process.env.CATALOG_EXPANSION_MANIFEST;
    const reviewFile = process.env.CATALOG_EXPANSION_MEDIA_REVIEW;
    if (!manifestFile || !reviewFile) {
      throw new Error('Real QA requires CATALOG_EXPANSION_MANIFEST and CATALOG_EXPANSION_MEDIA_REVIEW approved artifact paths.');
    }
    const document = JSON.parse(await readFile(path.resolve('prisma/data/catalog-expansion.json'), 'utf8')) as { dataset: unknown };
    const dataset = validateExpansionDataset(document.dataset);
    const manifest: unknown = JSON.parse(await readFile(manifestFile, 'utf8'));
    const mediaReview: unknown = JSON.parse(await readFile(reviewFile, 'utf8'));
    const { prisma } = await import('../src/lib/prisma.js');
    try {
      const before = await captureCatalogExpansionSnapshot(prisma);
      const options = { dataset, manifest, mediaReview, target: 'qa' as const,
        configuration: process.env, publicRoot: path.resolve('../frontend/public') };
      const dryRun = await seedCatalogExpansion(prisma, options);
      expect(dryRun.mode).toBe('dry-run');
      assertCatalogExpansionUnchanged(before, await captureCatalogExpansionSnapshot(prisma));
      const first = await seedCatalogExpansion(prisma, { ...options, apply: true });
      expect(first.products.created + first.products.updated + first.products.skipped).toBe(79);
      const afterFirst = await captureCatalogExpansionSnapshot(prisma);
      assertCatalogExpansionPreserved(before, afterFirst, {
        products: dataset.products.map(row => expansionOwnedId(`product/${row.sku}`)),
        product_images: dataset.products.flatMap(row => row.images.map(image => expansionOwnedId(`image/${row.sku}/${image.sortOrder}`))),
        product_specifications: dataset.products.flatMap(row => row.specifications.map(spec => expansionOwnedId(`spec/${row.sku}/${spec.group}/${spec.name}`))),
      });
      const second = await seedCatalogExpansion(prisma, { ...options, apply: true });
      expect(second.categories.created).toBe(0);
      expect(second.brands.created).toBe(0);
      expect(second.products).toEqual({ created: 0, updated: 0, skipped: 79 });
      expect(second.images).toEqual({ created: 0, updated: 0 });
      expect(second.specifications).toEqual({ created: 0, updated: 0 });
      expect(second.inventories.created).toBe(0);
      assertCatalogExpansionUnchanged(afterFirst, await captureCatalogExpansionSnapshot(prisma));
      expect(await prisma.product.count({ where: { sku: { in: dataset.products.map(row => row.sku) },
        status: 'ACTIVE', storefrontVisible: true, isTestFixture: false } })).toBe(79);
    } finally {
      await prisma.$disconnect();
    }
  }, 300_000);
});

