'use strict';
// Vite HMR remains independent of the compiled financial backend. Parent IPC
// loss closes Vite even on Windows, where SIGTERM would terminate immediately.
const path = require('node:path');
let server;
let stopping = false;
async function stop() { stopping = true; await server?.close(); }
process.on('disconnect', () => { void stop(); });
process.on('SIGINT', () => { void stop(); });
process.on('SIGTERM', () => { void stop(); });
async function main() {
  const { createServer } = await import('vite');
  server = await createServer({ root: path.resolve(__dirname, '../apps/frontend'),
    configFile: path.resolve(__dirname, '../apps/frontend/vite.config.ts') });
  if (stopping) return stop();
  await server.listen();
  if (stopping) return stop();
  process.send?.({ event: 'dev-stack.vite-ready', port: 3000 });
  server.printUrls();
}
main().catch(() => { console.error('Vite startup failed; inspect frontend configuration.'); process.exitCode = 1; process.disconnect?.(); });
