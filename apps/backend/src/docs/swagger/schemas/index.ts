import { commonSchemas } from './common.schema.js';
import { authSchemas } from './auth.schema.js';

/**
 * Aggregated OpenAPI Component Schemas.
 */
export const schemas = {
  ...commonSchemas,
  ...authSchemas,
};
