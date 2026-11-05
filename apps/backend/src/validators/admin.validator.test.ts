import { describe, expect, it, vi } from 'vitest';
import { MAX_BULK_PRODUCTS, bulkStatusSchema } from './admin.validator.js';

vi.mock('../lib/prisma.js', () => ({ prisma: {} }));

const A = '1c5bb1a2-5f0e-4f7a-9d4e-2b8d1f0a9c11';
const B = '2d6cc2b3-6a1f-4b8e-8e5f-3c9e2a1b0d22';
const stamp = '2026-11-01T10:00:00.000Z';
const item = (id: string) => ({ id, expectedUpdatedAt: stamp });

describe('bulkStatusSchema', () => {
  it('accepts a bounded batch of ACTIVE or INACTIVE changes with a version per item', () => {
    expect(bulkStatusSchema.safeParse({ status: 'INACTIVE', items: [item(A), item(B)] }).success).toBe(true);
    expect(bulkStatusSchema.safeParse({ status: 'ACTIVE', items: [item(A)] }).success).toBe(true);
  });

  it('rejects an empty batch and a batch above the cap', () => {
    expect(bulkStatusSchema.safeParse({ status: 'INACTIVE', items: [] }).success).toBe(false);
    const many = Array.from({ length: MAX_BULK_PRODUCTS + 1 }, (_, index) => item(`00000000-0000-4000-8000-${String(index).padStart(12, '0')}`));
    expect(bulkStatusSchema.safeParse({ status: 'INACTIVE', items: many }).success).toBe(false);
    expect(bulkStatusSchema.safeParse({ status: 'INACTIVE', items: many.slice(0, MAX_BULK_PRODUCTS) }).success).toBe(true);
  });

  it('rejects duplicate ids, including case-only differences, with the offending field', () => {
    const result = bulkStatusSchema.safeParse({ status: 'INACTIVE', items: [item(A), item(B), item(A.toUpperCase())] });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['items', 2, 'id']);
  });

  it('lower-cases ids so the same product cannot be submitted twice under two spellings', () => {
    const result = bulkStatusSchema.safeParse({ status: 'ACTIVE', items: [item(A.toUpperCase())] });
    expect(result.success && result.data.items[0]!.id).toBe(A);
  });

  it('rejects unknown statuses, malformed ids, missing versions and extra fields', () => {
    expect(bulkStatusSchema.safeParse({ status: 'DELETED', items: [item(A)] }).success).toBe(false);
    expect(bulkStatusSchema.safeParse({ status: 'INACTIVE', items: [{ id: 'not-a-uuid', expectedUpdatedAt: stamp }] }).success).toBe(false);
    expect(bulkStatusSchema.safeParse({ status: 'INACTIVE', items: [{ id: A }] }).success).toBe(false);
    expect(bulkStatusSchema.safeParse({ status: 'INACTIVE', items: [{ id: A, expectedUpdatedAt: 'yesterday' }] }).success).toBe(false);
    expect(bulkStatusSchema.safeParse({ status: 'INACTIVE', items: [item(A)], all: true }).success).toBe(false);
    expect(bulkStatusSchema.safeParse({ status: 'INACTIVE', items: [{ ...item(A), price: '1.00' }] }).success).toBe(false);
  });
});
