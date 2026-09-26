/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  // @ts-expect-error test property is from vitest
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    globals: true,
    testTimeout: 60000,
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
  },
  server: {
    port: Number(process.env.E2E_FRONTEND_PORT ?? 3000),
    proxy: {
      '/api': {
        target: process.env.E2E_API_PROXY_TARGET ?? 'http://localhost:5000',
        changeOrigin: true,
      },
    },
  },
});
