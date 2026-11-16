import { describe, expect, it, vi } from 'vitest';
import {
  listProductMediaTreeBounded,
  reconcileProductMedia,
  storagePathFromPublicUrl,
} from './product-media.reconciliation.js';
import type { ProductMediaStorageEntry } from './product-media.storage.js';

const product = '8f2813b4-a388-44d3-b51e-5d4c40386677';
const image = '1c5bb1a2-5f0e-4f7a-9d4e-2b8d1f0a9c11';
const revision = '2d6cc2b3-6a1f-4a8b-8e5f-3c9e2a1b0d22';
const object = (path: string, kind: ProductMediaStorageEntry['kind'] = 'file'): ProductMediaStorageEntry => ({
  path, kind, byteSize: kind === 'file' ? 4096 : null, contentType: kind === 'file' ? 'image/webp' : null, updatedAt: null,
});
const current = `products/${product}/${image}/${revision}/original.webp`;
const retired = `products/${product}/${image}/${'3e7dd4c4-7b2f-4b9c-8f6e-4d0f3b2c1e33'}/original.webp`;
const historical = `products/${product}/${'4f8ee5d5-813e-4c42-a963-d63a98377d03'}/${'5a9ff6e6-924f-4d53-a074-e74b94888e14'}/original.webp`;
const base = new URL('https://testproject.supabase.co');

describe('storagePathFromPublicUrl', () => {
  it('extracts only canonical public objects from the configured project and bucket', () => {
    expect(storagePathFromPublicUrl(`${base}storage/v1/object/public/product-media/${current}`, base, 'product-media')).toBe(current);
    expect(storagePathFromPublicUrl(`https://other.supabase.co/storage/v1/object/public/product-media/${current}`, base, 'product-media')).toBeNull();
    expect(storagePathFromPublicUrl(`${base}storage/v1/object/public/other/${current}`, base, 'product-media')).toBeNull();
    expect(storagePathFromPublicUrl(`${base}storage/v1/object/public/product-media/products%2f${product}`, base, 'product-media')).toBeNull();
    expect(storagePathFromPublicUrl(`${base}storage/v1/object/public/product-media/${current}?token=secret`, base, 'product-media')).toBeNull();
  });
});

describe('reconcileProductMedia', () => {
  it('reports current misses, retained references and unreferenced objects without deleting anything', () => {
    const report = reconcileProductMedia({
      objects: [object(current), object(retired), object(historical), object('products/8f2813b4-a388-44d3-b51e-5d4c40386677', 'folder')],
      currentReferences: [current, `products/${product}/${image}/${'6b0aa7f7-a35e-4f64-8e5a-f85c0a997f25'}/original.webp`],
      retiredReferences: [retired],
      historicalOrderImageUrls: [`${base}storage/v1/object/public/product-media/${historical}`, 'https://legacy-cdn.example/image.jpg'],
      supabaseUrl: base,
      bucket: 'product-media',
    });
    expect(report).toEqual({
      listedFiles: 3, listedFolders: 1,
      missingCurrentReferences: [`products/${product}/${image}/6b0aa7f7-a35e-4f64-8e5a-f85c0a997f25/original.webp`],
      missingRetainedReferences: [],
      retainedObjects: [
        { path: retired, reasons: ['RETIRED'] },
        { path: historical, reasons: ['HISTORICAL_ORDER'] },
      ],
      orphanCandidates: [],
    });
  });

  it('labels unreferenced files only as candidates and never performs mutations', () => {
    const report = reconcileProductMedia({
      objects: [object(current), object(retired)], currentReferences: [current], retiredReferences: [],
      historicalOrderImageUrls: [], supabaseUrl: base, bucket: 'product-media',
    });
    expect(report.orphanCandidates).toEqual([retired]);
  });
});

describe('listProductMediaTreeBounded', () => {
  it('walks only the fixed product/image/revision hierarchy with bounded pages', async () => {
    const listPage = vi.fn(async (prefix: string): Promise<ProductMediaStorageEntry[]> => {
      if (prefix === 'products') return [object(`products/${product}`, 'folder')];
      if (prefix === `products/${product}`) return [object(`products/${product}/${image}`, 'folder')];
      if (prefix === `products/${product}/${image}`) return [object(`products/${product}/${image}/${revision}`, 'folder')];
      if (prefix === `products/${product}/${image}/${revision}`) return [object(current)];
      return [];
    });
    const result = await listProductMediaTreeBounded(listPage, { pageSize: 10, maxEntries: 10 });
    expect(result.map(entry => entry.path)).toContain(current);
    expect(listPage).toHaveBeenCalledWith('products', 10, 0);
    expect(listPage).toHaveBeenCalledTimes(4);
  });

  it('fails closed when listing exceeds the caller entry budget', async () => {
    await expect(listProductMediaTreeBounded(async () => [object(current), object(retired)], { pageSize: 5, maxEntries: 1 }))
      .rejects.toThrow('configured entry limit');
  });

  it('propagates transient Storage listing failures instead of reporting confirmed missing objects', async () => {
    const unavailable = new Error('Storage list temporarily unavailable');
    await expect(listProductMediaTreeBounded(async () => { throw unavailable; }))
      .rejects.toBe(unavailable);
  });
});
