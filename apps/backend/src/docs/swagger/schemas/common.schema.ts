/**
 * Common OpenAPI Schemas.
 */
export const commonSchemas = {
  ErrorResponse: {
    type: 'object',
    required: ['error'],
    properties: {
      error: {
        type: 'string',
        description: 'Error message describing the failure',
      },
      details: {
        type: 'array',
        items: {
          type: 'object',
        },
        description: 'Detailed validation errors if applicable',
      },
    },
  },
  MessageResponse: {
    type: 'object',
    required: ['message'],
    properties: {
      message: {
        type: 'string',
        description: 'Success or informative status message',
      },
    },
  },
};
