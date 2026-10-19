/**
 * Task 03.8 startup diagnostic. Every process that can finalize a payment (API, payment worker) or send commerce email (email worker)
 * reports the same credential-free email state once at startup, with actionable warnings for inconsistent combinations, so a purchase
 * can never silently produce no email while the application appears to offer them. Reads configuration only: no query, no network.
 */
import { commerceEmailConfig } from './commerce-email.config.js';
import { logSafely } from '../utils/logger.js';

export interface CommerceEmailRuntimeReport {
  producerEnabled: boolean; dispatchEnabled: boolean; sendMode: string; allowlistSize: number; originConfigured: boolean;
  configValid: boolean; warnings: string[];
}

export function describeCommerceEmailRuntime(environment: NodeJS.ProcessEnv = process.env): CommerceEmailRuntimeReport {
  let config;
  try { config = commerceEmailConfig(environment); }
  catch {
    return { producerEnabled: false, dispatchEnabled: false, sendMode: 'invalid', allowlistSize: 0, originConfigured: false, configValid: false,
      warnings: ['COMMERCE_EMAIL_CONFIG_INVALID: a COMMERCE_EMAIL_* value is malformed; the producer will fail closed. Fix it before enabling emails.'] };
  }
  const warnings: string[] = [];
  const sends = config.dispatchEnabled && config.sendMode !== 'disabled';
  if (config.enqueueEnabled && !sends) warnings.push('EVENTS_QUEUE_BUT_NOTHING_SENDS: the producer is on but dispatch is off or the send mode is disabled; start the email worker with COMMERCE_EMAIL_DISPATCH_ENABLED=true and a send mode.');
  if (!config.enqueueEnabled && sends) warnings.push('WORKER_BUT_NO_EVENTS: sending is configured but the producer is off in this process; purchases create no email events (set COMMERCE_EMAIL_ENQUEUE_ENABLED=true in every payment-finalizing process).');
  if (!config.enqueueEnabled && !sends) warnings.push('COMMERCE_EMAILS_OFF: no commerce emails will be created or sent (the safe default).');
  if (config.sendMode === 'allowlist' && !config.allowedRecipients.length) warnings.push('ALLOWLIST_EMPTY: allowlist mode with no recipients sends nothing.');
  if ((config.enqueueEnabled || sends) && !config.origin) warnings.push('ORIGIN_MISSING: set COMMERCE_EMAIL_ORIGIN (or FRONTEND_URL) to the trusted https frontend origin; emails link to it.');
  return { producerEnabled: config.enqueueEnabled, dispatchEnabled: config.dispatchEnabled, sendMode: config.sendMode,
    allowlistSize: config.allowedRecipients.length, originConfigured: Boolean(config.origin), configValid: true, warnings };
}

/**
 * Logs one `email_runtime` line per process; warnings are logged at warn level and carry stable codes only. Best effort: a diagnostic must
 * never be able to stop the API or a worker from starting.
 */
export function logCommerceEmailRuntime(processName: 'api' | 'payment-worker' | 'email-worker', environment: NodeJS.ProcessEnv = process.env) {
  const report = describeCommerceEmailRuntime(environment);
  try {
    logSafely(report.warnings.some(warning => !warning.startsWith('COMMERCE_EMAILS_OFF')) ? 'warn' : 'info', 'Commerce email runtime', {
      event: 'email_runtime', process: processName, producerEnabled: report.producerEnabled, dispatchEnabled: report.dispatchEnabled,
      sendMode: report.sendMode, allowlistSize: report.allowlistSize, originConfigured: report.originConfigured, configValid: report.configValid,
      warnings: report.warnings.map(warning => warning.split(':')[0]) });
  } catch { /* logging unavailable: startup continues */ }
  return report;
}
