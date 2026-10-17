import { createApplicationLogger, installFatalLogging, flushLogs } from '../../src/utils/logger.js';
import { lock } from 'proper-lockfile';
const target = process.argv[2];
if (target === 'streams') {
  const runtime = createApplicationLogger(process.argv[3]);
  runtime.logger.info('Deployment info fixture', { operation: 'deployment.info' });
  runtime.logger.error('Deployment error fixture', { operation: 'deployment.error' });
  void runtime.flush().then(() => runtime.logger.close());
} else if (target === 'hold') {
  void flushLogs().then(async () => {
    await lock(process.argv[3], { lockfilePath: `${process.argv[3]}/.logging.lock`, stale: 5000, update: 1000,
      retries: { retries: 80, factor: 1, minTimeout: 100, maxTimeout: 100 }, onCompromised: () => {} });
    process.stdout.write('READY\n'); setInterval(() => {}, 1000);
  });
} else if (target === 'startup') {
  void import('../../src/bootstrap.js');
} else if (target === 'fatal') {
  installFatalLogging();
  setImmediate(() => { throw new Error('fatal fixture password=private'); });
} else if (target === 'rejection') {
  installFatalLogging();
  void Promise.reject(new Error('rejection fixture token=private'));
} else {
  const runtime = createApplicationLogger(target, { app: { maxBytes: 1500, days: 14, archiveBytes: 5000000 }, error: { maxBytes: 1500, days: 30, archiveBytes: 5000000 } });
  for (let index = 0; index < 30; index++) runtime.logger.error('Concurrent fixture', { operation: 'fixture.write', worker: process.argv[3], index });
  void runtime.flush().then(() => { runtime.logger.close(); });
}
