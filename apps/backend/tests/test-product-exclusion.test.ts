import { describe, expect, it } from 'vitest';
import { publicProductWhere } from '../src/services/product.service.js';
import { searchWhere } from '../src/services/search.sql.js';

describe('customer product fixture visibility', () => {
  it('uses the authoritative fixture marker in customer product queries', () => {
    expect(publicProductWhere).toMatchObject({ isTestFixture: false, storefrontVisible: true, status: 'ACTIVE', category: { isActive: true } });
  });

  it('filters search and category matches by the authoritative fixture marker', () => {
    const where = searchWhere({ q: 'Deletion test item', page: 1, pageSize: 20 });
    expect(where.text).toContain('p."isTestFixture" = false');
    expect(where.text).toContain('p."storefrontVisible" = true');
    expect(where.text).not.toContain('NOT IN');
    expect(where.text).not.toContain('p."price" <=');
  });
});
