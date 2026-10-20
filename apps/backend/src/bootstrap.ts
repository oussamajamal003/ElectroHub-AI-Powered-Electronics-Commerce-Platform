import { logSafely, flushLogsWithDeadline, installFatalLogging } from './utils/logger.js';

// Initialize observation before configuration, route or worker imports can fail.
installFatalLogging();
logSafely('info', 'Runtime starting', { operation: 'runtime.starting' });
async function startRuntime() {
  // Load configuration once, then complete a supervisor handshake before any payment-capable module is imported.
  await import('./config/env.js');
  const { initializeDevSupervisor } = await import('./lib/dev-supervisor.js');
  await initializeDevSupervisor();
  await import(process.argv.includes('--payment-worker') ? './payment-runner.js'
    : process.argv.includes('--commerce-email-worker') ? './commerce-email-runner.js' : './server.js');
}
void startRuntime().catch(async error => {
  logSafely('error', 'Runtime initialization failed', { operation: 'runtime.startup_failed', error });
  if (process.connected) process.disconnect();
  process.exitCode = 1;
  if (!await flushLogsWithDeadline()) process.exit(1);
});
