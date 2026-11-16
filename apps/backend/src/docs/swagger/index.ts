import swaggerJsdoc from 'swagger-jsdoc';
import path from 'node:path';
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
    path.resolve(__dirname, '../../routes/*.{ts,js}').replace(/\\/g, '/'),
    path.resolve(__dirname, 'paths/*.{ts,js}').replace(/\\/g, '/'),
  ],
};

export const swaggerSpec = swaggerJsdoc(swaggerOptions);
