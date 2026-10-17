import { defineConfig } from 'vitest/config';

if (process.env.ELECTROHUB_LOGGING_OFFLINE !== '1') throw new Error('Use npm run test:logging for isolated logging verification.');

// No general setupEnv.ts or .env loading. Selection is an allowlist, never a glob.
export default defineConfig({
  test: {
    environment: 'node',
    fileParallelism: false,
    include: [
      'tests/logger.test.ts', 'tests/requestId.test.ts', 'tests/logging-continuity.test.ts', 'tests/logging-http.test.ts',
      'tests/logging-final-acceptance.test.ts', 'tests/logging-startup-deadline.test.ts',
      'src/middleware/__tests__/errorHandler.test.ts', 'src/middleware/__tests__/errorHandler.logging-failure.test.ts',
    ],
  },
});
