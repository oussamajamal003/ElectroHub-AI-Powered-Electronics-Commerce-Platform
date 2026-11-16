import { defineConfig } from 'vitest/config';

if (process.env.RECOMMENDATION_FBT_PG_RUN !== '1') {
  throw new Error('Use node scripts/recommendation-fbt-pg.cjs: it provisions the disposable PostgreSQL cluster this suite requires.');
}

// Exact selection; no shared setupEnv.ts (the runner supplies a complete, disposable-only environment).
export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    include: ['src/services/recommendation.coPurchases.postgres.integration.test.ts'],
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
