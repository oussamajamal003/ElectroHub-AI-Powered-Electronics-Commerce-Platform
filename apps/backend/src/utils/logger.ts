import winston from 'winston';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { logContext } from './logContext.js';
import { DurableLogTransport, LOG_POLICIES } from './logTransport.js';
export { logContext } from './logContext.js';
const sensitive = /password|token|jwt|authorization|cookie|api.?key|secret|otp|credential|email|phone|address|firstName|lastName|fullName|givenName|familyName|surname|username|userId|customer|card|cvc|iban|body|headers|params|query|database.?url|recipient|billing|shipping|postal|birth|fingerprint|^name$|^ip$|^raw$|^payload$|^data$|^config$|^error$|^cause$|^sql$|^statement$|^meta$|^response$|^request$|^message$/i;
function writeStderrBestEffort(line: string): void {
  try { process.stderr.write(line); } catch { /* A failed fallback sink must not escape into request handling. */ }
}
function safeErrorIdentifier(value: unknown, fallback: string): string {
  return typeof value === 'string' && /^[A-Za-z0-9_$.-]{1,100}$/.test(value) ? value : fallback;
}
interface SerializedError { errorType: string; message: string; stack: string; code?: unknown; type?: unknown; cause?: unknown }
function isSerializedError(value: unknown): value is SerializedError {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record.errorType === 'string' && safeErrorIdentifier(record.errorType, '') === record.errorType &&
    typeof record.stack === 'string' &&
    (record.message === `${record.errorType}: operation failed` || record.message === 'Request JSON parsing failed' && record.type === 'entity.parse.failed') &&
    Object.keys(record).every(key => ['errorType', 'message', 'stack', 'code', 'type', 'cause'].includes(key));
}
export function sanitize(value: unknown, seen = new WeakSet<object>(), depth = 0): unknown {
  if (typeof value === 'string') return value
    .replace(/\b(?:postgres(?:ql)?|mysql):\/\/[^\s]+/gi, '[REDACTED_DATABASE_URL]')
    .replace(/\b(?:Bearer\s+\S+|eyJ[\w-]+\.[\w-]+\.[\w-]+|(?:sk|pk|rk)_(?:live|test)_[\w]+|pi_[\w]+_secret_[\w]+)/gi, '[REDACTED_TOKEN]')
    .replace(/\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi, '[REDACTED_EMAIL]')
    .replace(/([\\/](?:Users|home)[\\/])[^\\/\s]+/gi, '$1[REDACTED_USER]')
    .replace(/((?:password|token|secret|otp|api[_-]?key|cookie|authorization)\s*[=:]\s*)[^\s,;]+/gi, '$1[REDACTED]')
    .replace(/\b(?:\d[ -]?){13,19}\b/g, '[REDACTED_NUMBER]').slice(0, 8192);
  if (!value || typeof value !== 'object') return typeof value === 'bigint' ? String(value) : value;
  if (seen.has(value) || depth > 8) return '[TRUNCATED]';
  seen.add(value);
  if (value instanceof Error || isSerializedError(value)) {
    const errorType = safeErrorIdentifier(value instanceof Error ? value.name : value.errorType, 'Error');
    const rawCode = 'code' in value ? value.code : 'errorCode' in value ? value.errorCode : undefined;
    const code = safeErrorIdentifier(rawCode, '');
    const rawType = 'type' in value ? value.type : undefined;
    const type = safeErrorIdentifier(rawType, '');
    // Exception messages can contain SQL, request data, provider payloads or secrets.
    // Keep classification and stack frames, but never retain the raw message.
    const message = rawType === 'entity.parse.failed' ? 'Request JSON parsing failed' : `${errorType}: operation failed`;
    const stack = [message, ...(value.stack?.split('\n').filter(line => /^\s*at\s/.test(line)) ?? [])].join('\n');
    const cause = 'cause' in value && (value.cause instanceof Error || isSerializedError(value.cause)) ? sanitize(value.cause, seen, depth + 1) : undefined;
    return { errorType: sanitize(errorType), message: sanitize(message), ...(code ? { code: sanitize(code) } : {}), ...(type ? { type: sanitize(type) } : {}),
      stack: sanitize(stack, seen, depth + 1), ...(cause ? { cause } : {}) };
  }
  if (Array.isArray(value)) return value.slice(0, 100).map(item => sanitize(item, seen, depth + 1));
  const record = value as Record<string, unknown>;
  const winstonInfo = typeof record.level === 'string' && 'message' in record;
  return Object.fromEntries(Object.entries(value).slice(0, 100).map(([key, item]) => {
    const isSafeError = (key === 'error' || key === 'cause') && (item instanceof Error || isSerializedError(item));
    const isGenericErrorText = key === 'error' && typeof item === 'string' && /^[A-Za-z][A-Za-z ._-]{0,79}$/.test(item) &&
      !/\b(?:select|insert|update|delete|from|where|constraint|relation|column|table|database|sql|secret|token|password)\b/i.test(item);
    const isSafeRequestId = key === 'requestId' || key === 'correlationId';
    const redact = sensitive.test(key) && !(winstonInfo && key === 'message') && !isSafeError && !isGenericErrorText && !isSafeRequestId;
    return [key, redact ? '[REDACTED]' : sanitize(item, seen, depth + 1)];
  }));
}
const instanceId = randomUUID();
export function createApplicationLogger(directory = process.env.ELECTROHUB_LOG_DIR || path.resolve(__dirname, '../../logs'), policies = LOG_POLICIES, now?: () => Date) {
  const transport = new DurableLogTransport(directory, policies, now, line => {
    try { return JSON.stringify(sanitize(JSON.parse(line))); }
    catch { return JSON.stringify({ operation: 'logging.legacy', message: sanitize(line) }); }
  });
  const result = winston.createLogger({
    level: process.env.NODE_ENV === 'production' ? 'info' : 'debug',
    format: winston.format.combine(winston.format((info) => {
      const level = info.level;
      // Prioritize required fields, then replace the original record entirely so
      // truncated metadata and original symbol payloads cannot bypass redaction.
      const clean = sanitize(Object.assign({ level, message: info.message }, info)) as Record<string, unknown>;
      const requestId = sanitize(logContext.getStore()?.requestId ?? clean.requestId);
      return { ...clean, level, message: clean.message, [Symbol.for('level')]: level,
        timestamp: new Date().toISOString(), severity: level, pid: process.pid, instanceId,
        requestId,
        correlationId: requestId ?? sanitize(clean.correlationId) ?? instanceId,
        eventId: randomUUID(),
        operation: clean.operation ?? clean.event ?? String(clean.message).toLowerCase().replace(/[^a-z0-9]+/g, '.').slice(0, 100) };
    })(), winston.format.json()),
    transports: [transport, ...(process.env.NODE_ENV === 'production' ? [new winston.transports.Console({ stderrLevels: ['error', 'warn'] })] : [])], exitOnError: false,
  });
  result.on('error', () => writeStderrBestEffort('ElectroHub logger failure; check log storage.\n'));
  return { logger: result, flush: () => transport.flush(), health: () => transport.getHealth() };
}
const applicationLogger = createApplicationLogger();
export const logger = applicationLogger.logger;
export const flushLogs = applicationLogger.flush;
let observerLoggerFailures = 0;
let lastObserverFailureCode = 'LOGGER_SYNC_FAILURE';
export const loggingHealth = () => {
  const health = applicationLogger.health();
  return observerLoggerFailures === 0 ? health : {
    ...health,
    status: 'warning' as const,
    failures: health.failures + observerLoggerFailures,
    lastCode: lastObserverFailureCode,
  };
};
/** Bound lifecycle flushing without rejecting into application error handling. */
export async function flushLogsWithDeadline(timeoutMs = 2000): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined;
  const report = (code: string) => {
    observerLoggerFailures++; lastObserverFailureCode = code;
    writeStderrBestEffort(JSON.stringify({ timestamp: new Date().toISOString(), severity: 'error', operation: 'logging.flush_failed', code, pid: process.pid }) + '\n');
  };
  try {
    return await Promise.race([
      flushLogs().then(() => true),
      new Promise<boolean>(resolve => { timer = setTimeout(() => { report('LOG_FLUSH_TIMEOUT'); resolve(false); }, timeoutMs); }),
    ]);
  } catch { report('LOG_FLUSH_FAILED'); return false; }
  finally { clearTimeout(timer); }
}
/** Logging is an observer: a synchronous transport fault must not replace an HTTP or payment result. */
export function logSafely(level: 'error' | 'warn' | 'info', message: string, fields: Record<string, unknown> = {}): void {
  try { logger[level](message, fields); }
  catch {
    observerLoggerFailures++; lastObserverFailureCode = 'LOGGER_SYNC_FAILURE';
    try {
      writeStderrBestEffort(`${JSON.stringify(sanitize({ timestamp: new Date().toISOString(), severity: level,
        operation: 'logging.synchronous_failure', requestId: logContext.getStore()?.requestId ?? null,
        message, fields }))}\n`)} catch { /* A broken diagnostics sink cannot change the request outcome. */ }
  }
}
let fatalLoggingInstalled = false;
export function installFatalLogging(): void {
  if (fatalLoggingInstalled) return;
  fatalLoggingInstalled = true;
  const stop = () => {
    void flushLogsWithDeadline().then(() => process.exit(1));
  };
  process.on('uncaughtException', error => {
    writeStderrBestEffort(JSON.stringify({ timestamp: new Date().toISOString(), severity: 'error', operation: 'process.uncaughtException', error: sanitize(error) }) + '\n');
    logSafely('error', 'Uncaught exception', { operation: 'process.uncaughtException', error });
    stop();
  });
  process.on('unhandledRejection', error => {
    writeStderrBestEffort(JSON.stringify({ timestamp: new Date().toISOString(), severity: 'error', operation: 'process.unhandledRejection', error: sanitize(error) }) + '\n');
    logSafely('error', 'Unhandled rejection', { operation: 'process.unhandledRejection', error });
    stop();
  });
}
