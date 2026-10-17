import { defineConfig } from 'vitest/config';

if (process.env.ELECTROHUB_DB_RELIABILITY_RUN !== '1') {
  throw new Error('Use node scripts/database-reliability-tests.cjs for isolated database reliability tests.');
}

// Exact selection, no shared .env/setupEnv.ts and no commerce/integration suite globs.
export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    include: ['src/lib/prisma.test.ts', 'src/lib/database-adapter.test.ts',
      ...(process.env.ELECTROHUB_DB_RELIABILITY_POSTGRES === '1' ? ['verification/database-reliability.postgres.ts'] : [])],
    testTimeout: 15000,
    hookTimeout: 15000,
  },
});
