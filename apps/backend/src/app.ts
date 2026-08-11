import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './config/swagger.js';
import { requestLogger } from './middleware/requestLogger.js';
import { errorHandler } from './middleware/errorHandler.js';
import routes from './routes/index.js';

/**
 * Express application.
 *
 * Middleware order:
 * 1. Helmet (security headers)
 * 2. CORS
 * 3. JSON body parsing
 * 4. Request logging
 * 5. Routes
 * 6. Swagger UI
 * 7. Error handler (must be last)
 */
const app = express();

// Security headers
app.use(helmet());

// CORS — configured for development; restrict in production
app.use(
  cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  })
);

// JSON body parsing
app.use(express.json());

// URL-encoded body parsing
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use(requestLogger);

// API routes
app.use('/api', routes);

// Swagger UI
app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerSpec));

// Swagger JSON endpoint
app.get('/api/openapi.json', (_req, res) => {
  res.json(swaggerSpec);
});

// Global error handler (must be registered last)
app.use(errorHandler);

export default app;
