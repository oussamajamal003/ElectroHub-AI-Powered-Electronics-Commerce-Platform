import { stockAlerts } from './stock-alert.service.js';
import { logSafely } from '../utils/logger.js';

const INTERVAL_MS = 30_000;

/** Bounded in-process recovery for the inventory outbox; processing is idempotent and delivery rows carry the retry state. */
export function startStockAlertRecoveryRunner() {
  let running = false;
  const run = () => {
    if (running) return;
    running = true;
    void stockAlerts.recover().catch(error => logSafely('warn', 'Stock alert recovery failed', {
      event: 'admin.stock_alert.recovery_failed', errorName: error instanceof Error ? error.name : 'Unknown',
    })).finally(() => { running = false; });
  };
  run();
  const timer = setInterval(run, INTERVAL_MS);
  timer.unref();
  return () => clearInterval(timer);
}
