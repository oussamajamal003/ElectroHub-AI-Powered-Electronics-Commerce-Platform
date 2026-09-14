import winston from 'winston';
import { env } from '../config/env.js';

/**
 * Centralized, structured logger for the ElectroHub backend.
 *
 * Features:
 * - Supports debug, info, warn, error levels
 * - JSON format in production for structured log analysis
 * - Human-readable format in development
 * - Includes timestamp in all log entries
 * - Redacts sensitive data from log metadata (e.g. passwords, tokens)
 *
 * Usage:
 *   import { logger } from '@/utils/logger';
 *   logger.info('Server started', { port: 5000 });
 *   logger.error('Database connection failed', { error: 'connection refused' });
 */

const isProduction = env.NODE_ENV === 'production';

const sensitiveKeys = [
  'password',
  'token',
  'jwt',
  'authorization',
  'cookie',
  'set-cookie',
  'api_key',
  'apikey',
  'stripe_secret',
  'secret',
];

const redactSensitiveData = winston.format((info) => {
  const result = { ...info };
  
  const redact = (obj: unknown): unknown => {
    if (!obj || typeof obj !== 'object') return obj;
    const newObj = { ...(obj as Record<string, unknown>) };
    for (const key of Object.keys(newObj)) {
      if (sensitiveKeys.some((sk) => key.toLowerCase().includes(sk))) {
        newObj[key] = '[REDACTED]';
      } else if (typeof newObj[key] === 'object' && newObj[key] !== null) {
        newObj[key] = redact(newObj[key]);
      }
    }
    return newObj;
  };

  // We loop over all keys in info to redact potential metadata
  for (const key of Object.keys(result)) {
    // skip internal winston symbols and standard fields
    if (typeof key === 'symbol' || ['level', 'message', 'timestamp'].includes(key)) {
      continue;
    }
    if (sensitiveKeys.some((sk) => key.toLowerCase().includes(sk))) {
      result[key] = '[REDACTED]';
    } else {
      result[key] = redact(result[key]);
    }
  }

  return result;
});

const devFormat = winston.format.combine(
  redactSensitiveData(),
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `${timestamp} [${level}]: ${message}${metaStr}`;
  })
);

const prodFormat = winston.format.combine(
  redactSensitiveData(),
  winston.format.timestamp(),
  winston.format.json()
);

export const logger = winston.createLogger({
  level: isProduction ? 'info' : 'debug',
  format: isProduction ? prodFormat : devFormat,
  transports: [new winston.transports.Console()],
  // Prevent winston from exiting on uncaught exceptions during normal operation
  exitOnError: false,
});
