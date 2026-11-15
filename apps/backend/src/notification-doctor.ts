import { runNotificationDoctorWithCleanup } from './notification-doctor.diagnostics.js';

interface DoctorConfiguration {
  prisma: typeof import('./lib/prisma.js').prisma;
  email: ReturnType<typeof import('./services/commerce-email.config.js').commerceEmailConfig>;
  target: ReturnType<typeof import('./payment-isolation.js').resolvePaymentIsolation>;
  push: ReturnType<typeof import('./services/customer-push.config.js').pushConfig>;
  describeEmail(): ReturnType<typeof import('./services/commerce-email.runtime.js').describeCommerceEmailRuntime>;
  dispatchPermission: typeof import('./services/commerce-email.config.js').dispatchPermission;
  commerceEmailHealth: typeof import('./services/commerce-email.dispatcher.js').commerceEmailHealth;
  pushDispatchAllowed: typeof import('./services/customer-push.dispatcher.js').pushDispatchAllowed;
}

/** Read-only, operator CLI. No recipients, endpoints, payloads, credentials, or provider messages. */
async function main() {
  let prisma: DoctorConfiguration['prisma'] | undefined;
  const lifecycle = await runNotificationDoctorWithCleanup<DoctorConfiguration, unknown, unknown, unknown>({
      async loadConfiguration() {
        await import('./config/env.js');
        const prismaModule = await import('./lib/prisma.js');
        prisma = prismaModule.prisma;
        const [emailConfig, emailRuntime, emailDispatcher, paymentIsolation, pushConfigModule, pushDispatcher] = await Promise.all([
          import('./services/commerce-email.config.js'),
          import('./services/commerce-email.runtime.js'),
          import('./services/commerce-email.dispatcher.js'),
          import('./payment-isolation.js'),
          import('./services/customer-push.config.js'),
          import('./services/customer-push.dispatcher.js'),
        ]);
        return {
          prisma,
          email: emailConfig.commerceEmailConfig(),
          target: paymentIsolation.resolvePaymentIsolation(),
          push: pushConfigModule.pushConfig(),
          describeEmail: emailRuntime.describeCommerceEmailRuntime,
          dispatchPermission: emailConfig.dispatchPermission,
          commerceEmailHealth: emailDispatcher.commerceEmailHealth,
          pushDispatchAllowed: pushDispatcher.pushDispatchAllowed,
        };
      },
      async querySchema(configuration) {
        return configuration.prisma.$queryRaw<{ notifications: boolean; push: boolean; welcome: boolean }[]>`
          SELECT to_regclass('public.customer_notifications') IS NOT NULL AS notifications,
            to_regclass('public.customer_push_deliveries') IS NOT NULL AS push,
            EXISTS(SELECT 1 FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid WHERE t.typname='CommerceEmailType' AND e.enumlabel='CUSTOMER_WELCOME') AS welcome`;
      },
      async checkCommerceEmailHealth(configuration) {
        return configuration.commerceEmailHealth(configuration.prisma,
          configuration.email.sendMode === 'allowlist' ? configuration.email.allowedRecipients : []);
      },
      checkNotifications(configuration, schema, health) {
        const target = { kind: configuration.target.target, identity: configuration.target.identity };
        return {
          email: configuration.describeEmail(),
          workerPermission: configuration.dispatchPermission(configuration.email, target),
          schema: (schema as Array<unknown>)[0],
          emailQueue: health,
          push: { enabled: configuration.push.enabled, configured: configuration.push.configured,
            workerAllowed: configuration.pushDispatchAllowed(target) },
          workerRunning: 'NOT_PROVEN_BY_CONFIGURATION: verify recent email_worker_ready/email_worker_heartbeat logs',
          nextStep: 'Run npm run email:worker in the same explicitly approved environment. API dev alone does not start this worker. Never replay UNCERTAIN rows.',
        };
      },
    }, async () => { await prisma?.$disconnect(); });
    if (!lifecycle.ok) {
      console.error(JSON.stringify({ ok: false,
        ...(lifecycle.result.ok ? { result: lifecycle.result.value } : { diagnostic: lifecycle.result.diagnostic }),
        ...(lifecycle.cleanupDiagnostic ? { cleanupDiagnostic: lifecycle.cleanupDiagnostic } : {}),
      }, null, 2));
      process.exitCode = 1;
      return;
    }
  if (lifecycle.result.ok) console.log(JSON.stringify(lifecycle.result.value, null, 2));
}

void main().catch(() => {
  // Keep an unexpected CLI-level failure nonzero without printing raw exception data.
  console.error(JSON.stringify({ ok: false, diagnostic: { stage: 'notification_doctor_cli', errorClass: 'Error', errorCode: null,
    prismaErrorCode: null, failureKind: 'unknown', retryable: null, causeChain: [] } }, null, 2));
  process.exitCode = 1;
});
