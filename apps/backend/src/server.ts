import app from './app.js';
import { env } from './config/env.js';
import { logger } from './utils/logger.js';

const PORT = env.PORT;

app.listen(PORT, () => {
  logger.info('Server started', {
    port: PORT,
    environment: env.NODE_ENV,
    event: 'server.started',
  });
  logger.info(`Swagger docs available at http://localhost:${PORT}/api/docs`);
});
