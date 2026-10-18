import { logSafely, flushLogsWithDeadline, installFatalLogging } from './utils/logger.js';

// Initialize observation before configuration, route or worker imports can fail.
installFatalLogging();
logSafely('info', 'Runtime starting', { operation: 'runtime.starting' });
void import(process.argv.includes('--payment-worker') ? './payment-runner.js'
  : process.argv.includes('--commerce-email-worker') ? './commerce-email-runner.js' : './server.js').catch(async error => {
  logSafely('error', 'Runtime initialization failed', { operation: 'runtime.startup_failed', error });
  process.exitCode = 1;
  if (!await flushLogsWithDeadline()) process.exit(1);
});
