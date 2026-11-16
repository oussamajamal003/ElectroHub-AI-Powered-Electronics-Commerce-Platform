import { defineConfig } from 'vitest/config';

process.env.NODE_ENV = 'test';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['tests/setupEnv.ts'],
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    maxWorkers: process.env.CI ? 1 : undefined,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/server.ts'],
    },
  },
});
