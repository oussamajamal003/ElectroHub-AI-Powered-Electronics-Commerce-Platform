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
 * - Never logs secrets or sensitive data (enforced by convention)
 *
 * Usage:
 *   import { logger } from '@/utils/logger';
 *   logger.info('Server started', { port: 5000 });
 *   logger.error('Database connection failed', { error: 'connection refused' });
 */

const isProduction = env.NODE_ENV === 'production';

const devFormat = winston.format.combine(
  winston.format.colorize(),
  winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
  winston.format.printf(({ timestamp, level, message, ...meta }) => {
    const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
    return `${timestamp} [${level}]: ${message}${metaStr}`;
  })
);

const prodFormat = winston.format.combine(
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
