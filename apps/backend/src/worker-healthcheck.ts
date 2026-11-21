import { readFileSync } from 'node:fs';
import { isWorkerHealthFresh } from './utils/worker-health.js';

const target = process.env.ELECTROHUB_WORKER_HEALTH_FILE;
try {
  if (!target || !isWorkerHealthFresh(JSON.parse(readFileSync(target, 'utf8')))) process.exitCode = 1;
} catch {
  process.exitCode = 1;
}
