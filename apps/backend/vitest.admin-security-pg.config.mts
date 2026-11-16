import { defineConfig } from 'vitest/config';

if (process.env.ADMIN_SECURITY_PG_RUN !== '1') {
  throw new Error('Use node scripts/admin-security-pg.cjs: it provisions the disposable PostgreSQL cluster this suite requires.');
}

// Exact selection; no shared setupEnv.ts (the runner supplies a complete, disposable-only environment).
export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    include: ['src/**/*.admin-pg.integration.test.ts'],
    testTimeout: 60000,
    hookTimeout: 60000,
  },
});
