import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import swaggerUi from 'swagger-ui-express';
import { swaggerSpec } from './docs/swagger/index.js';
import { requestLogger } from './middleware/requestLogger.js';
import { errorHandler } from './middleware/errorHandler.js';
import { requestId } from './middleware/requestId.js';
import { notFoundHandler } from './middleware/notFoundHandler.js';
import routes from './routes/index.js';

/**
 * Express application.
 *
 * Middleware order:
 * 1. Request ID
 * 2. Helmet (security headers)
 * 3. CORS
 * 4. JSON body parsing
 * 5. Cookie parsing
 * 6. Request logging
 * 7. Routes
 * 8. Swagger UI
 * 9. Not Found handler
 * 10. Error handler (must be last)
 */
const app = express();

// Trust reverse proxy (e.g. Nginx) to ensure correct client IP for rate limiting
app.set('trust proxy', 1);

// Request ID (should be very first to track everything)
app.use(requestId);

// Security headers
app.use(helmet());

// CORS — configured for development; restrict in production
app.use(
  cors({
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    credentials: true,
  })
);

// JSON body parsing with strict size limit
app.use(express.json({ limit: '10kb' }));

// URL-encoded body parsing with strict size limit
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// Cookie parsing
app.use(cookieParser());

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

// 404 Not Found handler
app.use(notFoundHandler);

// Global error handler (must be registered last)
app.use(errorHandler);

export default app;
