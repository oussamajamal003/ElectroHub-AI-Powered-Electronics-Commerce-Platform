/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { getViteServerConfig } from './src/config/viteServerConfig';

export default defineConfig(({ command }) => {
  const server = getViteServerConfig(command, process.env, process.argv);
  return {
    plugins: [react()],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, './src'),
      },
    },
    // Keep generated Storybook output in this package from being scanned as a second app entry.
    optimizeDeps: { entries: ['index.html'] },
    test: {
      environment: 'jsdom',
      setupFiles: ['./src/test/setup.ts'],
      globals: true,
      testTimeout: 60000,
      include: ['src/**/*.{test,spec}.{ts,tsx}'],
    },
    ...(server ? { server } : {}),
  };
});
