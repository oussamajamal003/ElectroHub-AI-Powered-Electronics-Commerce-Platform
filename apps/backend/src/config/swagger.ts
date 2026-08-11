import swaggerJsdoc from 'swagger-jsdoc';

/**
 * Swagger/OpenAPI configuration.
 *
 * Provides API documentation with:
 * - API title and version
 * - API description
 * - Health endpoint documentation
 * - Bearer auth security scheme for future authenticated APIs
 */
const swaggerOptions: swaggerJsdoc.Options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'ElectroHub API',
      version: '0.1.0',
      description:
        'ElectroHub — AI-Powered Electronics Commerce Platform API. Provides REST endpoints for product management, authentication, orders, payments, and AI-powered features.',
    },
    servers: [
      {
        url: '/api',
        description: 'API server',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT authentication token',
        },
      },
    },
  },
  apis: ['./src/routes/*.ts'],
};

export const swaggerSpec = swaggerJsdoc(swaggerOptions);
