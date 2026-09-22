import { schemas } from './schemas/index.js';

/**
 * OpenAPI 3.0.0 Specification Definition.
 *
 * Defines the core metadata, servers, security schemes, and reusable component schemas
 * for the ElectroHub REST API.
 */
export const openapiDefinition = {
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
  tags: [
    {
      name: 'Authentication',
      description: 'User authentication, registration, and session management',
    },
    {
      name: 'Health',
      description: 'Service health and status monitoring',
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
    schemas,
  },
};
