import './config/env.js';
import { prisma } from './lib/prisma.js';
import { describeCommerceEmailRuntime } from './services/commerce-email.runtime.js';
import { commerceEmailConfig, dispatchPermission } from './services/commerce-email.config.js';
import { commerceEmailHealth } from './services/commerce-email.dispatcher.js';
import { resolvePaymentIsolation } from './payment-isolation.js';
import { pushConfig } from './services/customer-push.config.js';
import { pushDispatchAllowed } from './services/customer-push.dispatcher.js';

/** Read-only, operator CLI. No recipients, endpoints, payloads, credentials, or provider messages. */
async function main() {
  const email = commerceEmailConfig(); const target = resolvePaymentIsolation(); const push = pushConfig();
  const schema = await prisma.$queryRaw<{ notifications: boolean; push: boolean; welcome: boolean }[]>`
    SELECT to_regclass('public.customer_notifications') IS NOT NULL AS notifications,
      to_regclass('public.customer_push_deliveries') IS NOT NULL AS push,
      EXISTS(SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='CommerceEmailType' AND e.enumlabel='CUSTOMER_WELCOME') AS welcome`;
  const health = await commerceEmailHealth(prisma, email.sendMode === 'allowlist' ? email.allowedRecipients : []);
  console.log(JSON.stringify({ email: describeCommerceEmailRuntime(),
    workerPermission: dispatchPermission(email, { kind: target.target, identity: target.identity }),
    schema: schema[0], emailQueue: health, push: { enabled: push.enabled, configured: push.configured,
      workerAllowed: pushDispatchAllowed({ kind: target.target, identity: target.identity }) },
    workerRunning: 'NOT_PROVEN_BY_CONFIGURATION: verify recent email_worker_ready/email_worker_heartbeat logs',
    nextStep: 'Run npm run email:worker in the same explicitly approved environment. API dev alone does not start this worker. Never replay UNCERTAIN rows.' }, null, 2));
}
void main().catch(() => { console.error('Notification diagnostics unavailable: check database reachability, migration status and redacted runtime logs.'); process.exitCode = 1; }).finally(() => prisma.$disconnect());
