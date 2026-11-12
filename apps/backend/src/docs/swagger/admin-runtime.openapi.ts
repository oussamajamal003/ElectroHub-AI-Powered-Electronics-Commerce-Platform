/** Read contracts for the settings page and header; authorization chains intentionally differ. */
const error = (description: string) => ({ description, content: { 'application/json': { schema: {
  type: 'object', required: ['error'], properties: { error: { type: 'object', required: ['code', 'message'],
    properties: { code: { type: 'string' }, message: { type: 'string' } } } },
} } } });
const nullableText = { type: 'string', nullable: true };
const storeProperties = {
  storeName: { type: 'string' }, supportEmail: { ...nullableText, format: 'email' }, supportPhone: nullableText,
  addressLine1: nullableText, addressLine2: nullableText, city: nullableText, region: nullableText,
  postalCode: nullableText, country: nullableText, timezone: { type: 'string', example: 'UTC' },
  currency: { type: 'string', enum: ['USD'] }, version: { type: 'integer', minimum: 0 },
  updatedAt: { ...nullableText, format: 'date-time' },
};
const count = { type: 'integer', minimum: 0 };
const alertsProperties = { lowStock: count, outOfStock: count, awaitingFulfillment: count, preparing: count,
  outForDelivery: count, generatedAt: { type: 'string', format: 'date-time' } };
const item = (properties: object) => ({ description: 'Private, no-store response.', content: { 'application/json': {
  schema: { type: 'object', required: ['data'], properties: { data: { type: 'object', required: Object.keys(properties), properties } } },
} } });
export const adminRuntimePaths = {
  '/admin/settings/store': { get: {
    tags: ['Admin'], summary: 'Read the store profile',
    description: 'Requires a live MFA-assured administrator session. Owners and authorized non-Owners may read; editing is Owner-only. An absent row returns the default profile at version zero. Missing schema or database failures remain errors.',
    security: [{ bearerAuth: [] }], responses: { '200': item(storeProperties),
      '401': error('Missing, expired or invalid session.'), '403': error('Administrator role or MFA assurance required.'),
      '500': error('Safe INTERNAL_SERVER_ERROR; database details are server-side only.') },
  } },
  '/admin/dashboard/alerts': { get: {
    tags: ['Admin'], summary: 'Read live operational counts',
    description: 'Requires an authenticated ADMIN. Counts derive from inventory and paid fulfillment orders; reading does not acknowledge alerts or change business state. Zero is a successful empty state. The console refreshes every minute.',
    security: [{ bearerAuth: [] }], responses: { '200': item(alertsProperties), '401': error('Authentication required.'),
      '403': error('Administrator role required.'), '500': error('Safe INTERNAL_SERVER_ERROR; counts are never fabricated on failure.') },
  } },
};
