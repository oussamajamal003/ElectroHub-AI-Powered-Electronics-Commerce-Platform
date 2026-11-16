import { databaseFailure } from './lib/database-adapter.js';

export type NotificationDoctorStage =
  | 'configuration_loading'
  | 'initial_database_schema_query'
  | 'commerce_email_health'
  | 'notification_checks'
  | 'prisma_cleanup';

export interface NotificationDoctorDependencies<TConfiguration, TSchema, THealth, TResult> {
  loadConfiguration(): Promise<TConfiguration> | TConfiguration;
  querySchema(configuration: TConfiguration): Promise<TSchema>;
  checkCommerceEmailHealth(configuration: TConfiguration): Promise<THealth>;
  checkNotifications(configuration: TConfiguration, schema: TSchema, health: THealth): Promise<TResult> | TResult;
}

export type NotificationDoctorResult<TResult> =
  | { ok: true; value: TResult }
  | { ok: false; diagnostic: ReturnType<typeof notificationDoctorError> };

export interface NotificationDoctorLifecycleResult<TResult> {
  ok: boolean;
  result: NotificationDoctorResult<TResult>;
  cleanupDiagnostic?: ReturnType<typeof notificationDoctorError>;
}

const prismaCodePattern = /^P\d{4}$/;
const retryableKinds = new Set(['network', 'dns', 'connection_timeout', 'connection_terminated', 'connection_capacity', 'pool_acquisition_timeout']);
const nonRetryableKinds = new Set(['authentication', 'tls', 'query_cancelled', 'idle_transaction_timeout']);

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' ? value as Record<string, unknown> : undefined;
}

function safeErrorClass(value: unknown): string {
  const name = asRecord(value)?.name;
  return typeof name === 'string' && /^[A-Za-z][A-Za-z0-9_.]{0,79}$/.test(name) ? name : 'Error';
}

function safeCodes(value: unknown): { errorCode: string | null; prismaErrorCode: string | null } {
  let prismaErrorCode: string | null = null;
  const seen = new Set<object>();
  const visit = (current: unknown, depth = 0): void => {
    const record = asRecord(current);
    if (!record || depth > 4 || seen.has(record)) return;
    seen.add(record);
    const code = typeof record.code === 'string' ? record.code : '';
    if (!prismaErrorCode && prismaCodePattern.test(code)) prismaErrorCode = code;
    visit(record.cause, depth + 1);
    if (Array.isArray(record.errors)) record.errors.slice(0, 8).forEach(item => visit(item, depth + 1));
  };
  visit(value);
  const classification = databaseFailure(value);
  return { errorCode: classification.driverCode ?? classification.sqlState, prismaErrorCode };
}

export function notificationDoctorError(stage: NotificationDoctorStage, error: unknown) {
  const classification = databaseFailure(error);
  const { errorCode: nestedErrorCode, prismaErrorCode } = safeCodes(error);
  const errorCode = classification.driverCode ?? classification.sqlState ?? nestedErrorCode;
  const causeChain: Array<{ errorClass: string; errorCode: string | null; prismaErrorCode: string | null }> = [];
  const seen = new Set<object>();
  const visit = (current: unknown, depth = 0): void => {
    const record = asRecord(current);
    if (!record || depth > 4 || seen.has(record)) return;
    seen.add(record);
    const codes = safeCodes(current);
    causeChain.push({ errorClass: safeErrorClass(current), errorCode: codes.errorCode, prismaErrorCode: codes.prismaErrorCode });
    visit(record.cause, depth + 1);
    if (Array.isArray(record.errors)) record.errors.slice(0, 8).forEach(item => visit(item, depth + 1));
  };
  visit(error);
  const retryable = retryableKinds.has(classification.failureKind)
    ? true
    : nonRetryableKinds.has(classification.failureKind) ? false : null;
  return {
    stage,
    errorClass: safeErrorClass(error),
    errorCode,
    prismaErrorCode,
    failureKind: classification.failureKind,
    retryable,
    causeChain,
  };
}

export async function runNotificationDoctor<TConfiguration, TSchema, THealth, TResult>(
  dependencies: NotificationDoctorDependencies<TConfiguration, TSchema, THealth, TResult>,
): Promise<NotificationDoctorResult<TResult>> {
  let configuration: TConfiguration;
  try {
    configuration = await dependencies.loadConfiguration();
  } catch (error) {
    return { ok: false, diagnostic: notificationDoctorError('configuration_loading', error) };
  }

  let schema: TSchema;
  try {
    schema = await dependencies.querySchema(configuration);
  } catch (error) {
    return { ok: false, diagnostic: notificationDoctorError('initial_database_schema_query', error) };
  }

  let health: THealth;
  try {
    health = await dependencies.checkCommerceEmailHealth(configuration);
  } catch (error) {
    return { ok: false, diagnostic: notificationDoctorError('commerce_email_health', error) };
  }

  try {
    return { ok: true, value: await dependencies.checkNotifications(configuration, schema, health) };
  } catch (error) {
    return { ok: false, diagnostic: notificationDoctorError('notification_checks', error) };
  }
}

export async function runNotificationDoctorWithCleanup<TConfiguration, TSchema, THealth, TResult>(
  dependencies: NotificationDoctorDependencies<TConfiguration, TSchema, THealth, TResult>,
  cleanup: () => Promise<void>,
): Promise<NotificationDoctorLifecycleResult<TResult>> {
  const result = await runNotificationDoctor(dependencies);
  let cleanupDiagnostic: ReturnType<typeof notificationDoctorError> | undefined;
  try {
    await cleanup();
  } catch (error) {
    cleanupDiagnostic = notificationDoctorError('prisma_cleanup', error);
  }
  return { ok: result.ok && !cleanupDiagnostic, result, ...(cleanupDiagnostic ? { cleanupDiagnostic } : {}) };
}
