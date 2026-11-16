/** Read-only catalog acceptance against an explicitly selected local DEV/QA API. */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';
import { validateExpansionDataset } from '../prisma/catalog-expansion.js';

const image = z.object({ url: z.string(), isPrimary: z.boolean(), sortOrder: z.number() });
const summary = z.object({ slug: z.string(), price: z.string(), compareAtPrice: z.string().nullable(),
  category: z.object({ slug: z.string() }), brand: z.object({ slug: z.string() }).nullable(),
  availability: z.string(), primaryImage: image.nullable(), secondaryImage: image.nullable() });
const listing = z.object({ data: z.array(summary), meta: z.object({ total: z.number().int().nonnegative() }) });

async function main() {
  const args = process.argv.slice(2);
  const baseArgument = args.find(arg => arg.startsWith('--base-url='));
  if (!baseArgument || args.some(arg => !/^--(?:base-url|expected-visible|expected-categories)=/.test(arg))) {
    throw new Error('Usage: --base-url=http://127.0.0.1:PORT [--expected-visible=N] [--expected-categories=N]');
  }
  const base = new URL(baseArgument.slice('--base-url='.length));
  if (base.protocol !== 'http:' || !['localhost', '127.0.0.1'].includes(base.hostname) || base.username || base.password ||
      base.pathname !== '/' || base.search || base.hash) throw new Error('Select an explicit local DEV/QA API origin.');
  const get = async (route: string): Promise<unknown> => {
    const response = await fetch(new URL(route, base), { signal: AbortSignal.timeout(60_000) });
    if (response.status !== 200) throw new Error(`API acceptance failed: ${route} returned ${response.status}.`);
    return response.json();
  };
  const document = z.object({ dataset: z.unknown() }).passthrough().parse(JSON.parse(await readFile(
    path.resolve(__dirname, '../prisma/data/catalog-expansion.json'), 'utf8')));
  const data = validateExpansionDataset(document.dataset);
  const first = listing.parse(await get('/api/products?page=1&pageSize=100'));
  if (first.meta.total > 10_000) throw new Error('Unexpected catalog size.');
  const products = [...first.data];
  for (let page = 2; page <= Math.ceil(first.meta.total / 100); page++) {
    products.push(...listing.parse(await get(`/api/products?page=${page}&pageSize=100`)).data);
  }
  const categories = z.object({ data: z.array(z.object({ slug: z.string(), name: z.string(), imageUrl: z.string().nullable() })),
    meta: z.object({ total: z.number().int() }) }).parse(await get('/api/categories?pageSize=100'));
  for (const planned of data.products) {
    const actual = products.find(row => row.slug === planned.slug);
    if (!actual || actual.category.slug !== planned.categorySlug || actual.brand?.slug !== planned.brandSlug ||
        actual.price !== planned.price || actual.compareAtPrice !== null || actual.availability !== 'AVAILABLE' ||
        actual.primaryImage?.url !== planned.images.find(row => row.isPrimary)?.url ||
        actual.secondaryImage?.url !== planned.images.find(row => !row.isPrimary)?.url) {
      throw new Error(`Managed product API mismatch: ${planned.sku}.`);
    }
  }
  const detailPaths = [];
  for (const planned of data.categories) {
    const actual = categories.data.find(row => row.slug === planned.slug);
    if (!actual || actual.name !== planned.name || actual.imageUrl !== planned.imageUrl) {
      throw new Error(`Managed category API mismatch: ${planned.slug}.`);
    }
    const representative = data.products.find(row => row.categorySlug === planned.slug)!;
    const detail = z.object({ data: z.object({ sku: z.string(), modelNumber: z.string().nullable(), images: z.array(image),
      specifications: z.array(z.object({ items: z.array(z.unknown()) })) }) })
      .parse(await get(`/api/products/${representative.slug}`)).data;
    if (detail.sku !== representative.sku || detail.modelNumber !== representative.modelNumber || detail.images.length !== 2 ||
        detail.images.filter(row => row.isPrimary).length !== 1 || detail.specifications.flatMap(group => group.items).length < 6) {
      throw new Error(`Product detail API mismatch: ${representative.sku}.`);
    }
    detailPaths.push(`/products/${representative.slug}`);
  }
  for (const [flag, actual] of [['expected-visible', first.meta.total], ['expected-categories', categories.meta.total]] as const) {
    const expected = args.find(arg => arg.startsWith(`--${flag}=`))?.split('=')[1];
    if (expected !== undefined && (!/^\d+$/.test(expected) || Number(expected) !== actual)) throw new Error(`${flag} count mismatch.`);
  }
  console.log(JSON.stringify({ visibleProducts: first.meta.total, storefrontCategories: categories.meta.total,
    managedProductsVerified: data.products.length, managedCategoriesVerified: data.categories.length,
    representativeDetailPaths: detailPaths, mutations: 0 }, null, 2));
}

main().catch(error => { console.error(error instanceof z.ZodError ? 'Catalog API contract validation failed.' :
  error instanceof Error ? error.message : 'Catalog API acceptance failed.'); process.exitCode = 1; });
