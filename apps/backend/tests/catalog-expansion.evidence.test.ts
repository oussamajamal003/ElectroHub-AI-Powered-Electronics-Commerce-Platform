import { describe, expect, it } from 'vitest';
import { assertCatalogExpansionPreserved, assertCatalogExpansionUnchanged } from '../prisma/catalog-expansion-evidence.js';

describe('Catalog expansion preservation witness', () => {
  const before = { products: [{ id: 'existing', digest: 'original' }],
    orders: [{ id: 'order', digest: 'payment-state' }] };
  it('permits appended catalog rows while preserving original rows and unrelated tables', () => {
    expect(() => assertCatalogExpansionPreserved(before, { ...before,
      products: [...before.products, { id: 'new', digest: 'new-product' }] })).not.toThrow();
  });
  it('rejects changed or removed original catalog rows and unrelated inserts', () => {
    expect(() => assertCatalogExpansionPreserved(before, { ...before,
      products: [{ id: 'existing', digest: 'changed' }] })).toThrow(/preexisting row/);
    expect(() => assertCatalogExpansionPreserved(before, { ...before, products: [] })).toThrow(/preexisting row/);
    expect(() => assertCatalogExpansionPreserved(before, { ...before,
      orders: [...before.orders, { id: 'other-order', digest: 'new-order' }] })).toThrow(/unrelated table/);
  });
  it('requires exact table inventory and exact repeat snapshot equality', () => {
    expect(() => assertCatalogExpansionPreserved(before, { ...before, unexpected: [] })).toThrow(/table inventory/);
    expect(() => assertCatalogExpansionUnchanged(before, structuredClone(before))).not.toThrow();
    expect(() => assertCatalogExpansionUnchanged(before, { ...before, products: [] })).toThrow(/database changes/);
  });
  it('permits an explicitly managed product update while preserving its identity', () => {
    const after = { ...before, products: [{ id: 'existing', digest: 'updated' }] };
    expect(() => assertCatalogExpansionPreserved(before, after, { products: ['existing'] })).not.toThrow();
    expect(() => assertCatalogExpansionPreserved(before, after, { products: ['different'] })).toThrow(/preexisting row/);
    expect(() => assertCatalogExpansionPreserved(before, { ...before, products: [] }, { products: ['existing'] })).toThrow(/preexisting row/);
  });
});


