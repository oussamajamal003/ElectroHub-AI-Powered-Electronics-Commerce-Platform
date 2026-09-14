import app from './app.js';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';

const PORT = env.PORT;

const server = app.listen(PORT, () => {
  logger.info('Server started', {
    port: PORT,
    environment: env.NODE_ENV,
    event: 'server.started',
  });
  logger.info(`Swagger docs available at http://localhost:${PORT}/api/docs`);
});

const gracefulShutdown = (signal: string) => {
  logger.info(`${signal} signal received. Closing HTTP server.`, { event: 'server.stopping' });
  server.close(() => {
    logger.info('HTTP server closed. Exiting process.', { event: 'server.stopped' });
    process.exit(0);
  });

  // Force close after 10s
  setTimeout(() => {
    logger.error('Could not close connections in time, forcefully shutting down', { event: 'server.force_stopped' });
    process.exit(1);
  }, 10000).unref();
};

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
