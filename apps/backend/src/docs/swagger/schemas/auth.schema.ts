/**
 * Authentication OpenAPI Schemas.
 */
export const authSchemas = {
  User: {
    type: 'object',
    properties: {
      id: {
        type: 'string',
        format: 'uuid',
        description: 'Unique user identifier',
      },
      email: {
        type: 'string',
        format: 'email',
        description: 'User email address',
      },
      firstName: {
        type: 'string',
        description: 'User first name',
      },
      lastName: {
        type: 'string',
        description: 'User last name',
      },
      role: {
        type: 'string',
        enum: ['CUSTOMER', 'ADMIN'],
        description: 'Assigned platform role',
      },
    },
  },
  RegisterRequest: {
    type: 'object',
    required: ['email', 'password', 'firstName', 'lastName'],
    properties: {
      email: {
        type: 'string',
        format: 'email',
        description: 'Valid customer email address',
      },
      password: {
        type: 'string',
        minLength: 8,
        description: 'Password (minimum 8 characters)',
      },
      firstName: {
        type: 'string',
        description: 'First name',
      },
      lastName: {
        type: 'string',
        description: 'Last name',
      },
    },
  },
  LoginRequest: {
    type: 'object',
    required: ['email', 'password'],
    properties: {
      email: {
        type: 'string',
        format: 'email',
        description: 'Registered user email',
      },
      password: {
        type: 'string',
        description: 'User password',
      },
    },
  },
  LoginResponse: {
    type: 'object',
    required: ['accessToken', 'user'],
    properties: {
      accessToken: {
        type: 'string',
        description: 'Short-lived JWT Bearer token (15m validity)',
      },
      user: {
        $ref: '#/components/schemas/User',
      },
    },
  },
  ForgotPasswordRequest: {
    type: 'object',
    required: ['email'],
    properties: {
      email: {
        type: 'string',
        format: 'email',
        description: 'Account email address for password reset',
      },
    },
  },
  ResetPasswordRequest: {
    type: 'object',
    required: ['token', 'newPassword'],
    properties: {
      token: {
        type: 'string',
        description: 'Password reset token',
      },
      newPassword: {
        type: 'string',
        minLength: 8,
        description: 'New password (minimum 8 characters)',
      },
    },
  },
};
