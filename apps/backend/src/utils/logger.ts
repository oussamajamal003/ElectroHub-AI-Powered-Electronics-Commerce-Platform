import winston from 'winston';
import path from 'path';
import fs from 'fs';
import { env } from '../config/env.js';

/**
 * Centralized, structured logger for the ElectroHub backend.
 *
 * Features:
 * - Supports debug, info, warn, error levels
 * - Writes all application events to apps/backend/logs/app.log
 * - Writes error events to apps/backend/logs/error.log
 * - Console transport for local development and container runtime
 * - Auto-creates logs/ directory if not present
 * - Includes timestamp in all log entries
 * - Redacts sensitive data from log metadata (e.g. passwords, tokens, cookies, secrets)
 *
 * Usage:
 *   import { logger } from '@/utils/logger';
 *   logger.info('Server started', { port: 5000 });
 *   logger.error('Database connection failed', { error: 'connection refused' });
 */

const isProduction = env.NODE_ENV === 'production';

// Resolve logs directory path: apps/backend/logs
const logsDir = path.resolve(__dirname, '../../logs');

// Ensure the logs directory exists
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

const sensitiveKeys = [
  'password',
  'passwordhash',
  'token',
  'jwt',
  'authorization',
  'cookie',
  'set-cookie',
  'api_key',
  'apikey',
  'stripe_secret',
  'secret',
  'refreshtoken',
  'accesstoken',
  'resettoken',
  'otp',
  'bearer',
  'credential',
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

const fileFormat = winston.format.combine(
  redactSensitiveData(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `${timestamp} [${level.toUpperCase()}]: ${message}${metaStr}`;
  })
);

export const logger = winston.createLogger({
  level: isProduction ? 'info' : 'debug',
  format: isProduction ? prodFormat : devFormat,
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({
      filename: path.join(logsDir, 'app.log'),
      level: isProduction ? 'info' : 'debug',
      format: fileFormat,
    }),
    new winston.transports.File({
      filename: path.join(logsDir, 'error.log'),
      level: 'error',
      format: fileFormat,
    }),
  ],
  // Prevent winston from exiting on uncaught exceptions during normal operation
  exitOnError: false,
});

