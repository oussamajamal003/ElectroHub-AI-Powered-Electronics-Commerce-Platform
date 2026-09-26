import swaggerJsdoc from 'swagger-jsdoc';
import { openapiDefinition } from './openapi.js';

/**
 * Swagger/OpenAPI Configuration and Specification Generator.
 *
 * Scans routes for JSDoc @swagger annotations and merges them with
 * the base OpenAPI definition.
 */
const swaggerOptions: swaggerJsdoc.Options = {
  definition: openapiDefinition,
  apis: [
    './src/routes/*.ts',
    './apps/backend/src/routes/*.ts',
    './src/docs/swagger/paths/*.ts',
  ],
};

export const swaggerSpec = swaggerJsdoc(swaggerOptions);
