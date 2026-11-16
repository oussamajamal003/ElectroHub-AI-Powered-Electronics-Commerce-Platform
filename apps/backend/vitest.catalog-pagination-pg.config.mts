import { defineConfig } from 'vitest/config';

if (process.env.CATALOG_PAGINATION_PG_RUN !== '1') {
  throw new Error('Use node scripts/catalog-pagination-pg.cjs: it provisions the disposable PostgreSQL cluster this suite requires.');
}

// Exact selection; no shared setupEnv.ts (the runner supplies a complete, disposable-only environment).
export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    include: ['src/services/catalog-pagination.postgres.integration.test.ts'],
    testTimeout: 600000,
    hookTimeout: 600000,
  },
});
