import { defineConfig } from 'vitest/config';

if (process.env.COMMERCE_EMAIL_PG_RUN !== '1') {
  throw new Error('Use node scripts/commerce-email-pg.cjs: it provisions the disposable PostgreSQL cluster this suite requires.');
}

// Exact selection; no shared setupEnv.ts (the runner supplies a complete, disposable-only environment).
export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    include: ['src/services/__tests__/commerce-email.postgres.integration.test.ts'],
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
