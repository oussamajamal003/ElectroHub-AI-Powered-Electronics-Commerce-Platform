const parameter = (name: string, schema: object, required = false) => ({ name, in: 'query', required, schema });
const error = { description: 'Structured sanitized error.', content: { 'application/json': { schema: { $ref: '#/components/schemas/ProductError' } } } };
export const searchSchemas = {
  SearchSuggestion: { type: 'object', required: ['id', 'type', 'label', 'slug'], properties: {
    id: { type: 'string', format: 'uuid' }, type: { type: 'string', enum: ['PRODUCT', 'CATEGORY', 'BRAND'] },
    label: { type: 'string' }, slug: { type: 'string' },
  } },
};
export const searchPaths = {
  '/search/products': { get: {
    tags: ['Search'], summary: 'Search public products',
    description: 'Every query token matches an approved field; filters combine with AND. A blank query returns one bounded newest-first page of the public catalog (used by /products); the dedicated /search page remains empty until the customer searches or filters. Relevance ranks exact, prefix, contains, model/SKU, brand/category, description, cross-field matches. Decimal prices are strings; inactive products/categories are hidden. Rate limit: 120 per minute per IP.',
    parameters: [
      parameter('q', { type: 'string', maxLength: 120 }),
      ...['category', 'brand'].map(name => parameter(name, { type: 'string', maxLength: 120, pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' })),
      parameter('availability', { type: 'string', enum: ['available', 'unavailable'] }),
      ...['minPrice', 'maxPrice'].map(name => parameter(name, { type: 'string', pattern: '^(0|[1-9][0-9]{0,9})(\\.[0-9]{1,2})?$' })),
      parameter('sort', { type: 'string', enum: ['relevance', 'price-asc', 'price-desc', 'newest', 'name-asc'] }),
      parameter('page', { type: 'integer', minimum: 1, maximum: 1000, default: 1 }),
      parameter('pageSize', { type: 'integer', minimum: 1, maximum: 100, default: 20 }),
    ], responses: {
      '200': { description: 'Bounded summaries. Default sort: relevance with query, newest without query. Stable ID tie-breakers.', content: { 'application/json': { schema: {
        type: 'object', required: ['data', 'meta'], properties: {
          data: { type: 'array', items: { $ref: '#/components/schemas/ProductSummary' } },
          meta: { allOf: [{ $ref: '#/components/schemas/ProductPagination' }, { type: 'object', required: ['totalPages'], properties: { totalPages: { type: 'integer', minimum: 0 } } }] },
        },
      } } } }, '400': error, '429': error, '500': error,
    },
  } },
  '/search/suggestions': { get: {
    tags: ['Search'], summary: 'Suggest products, brands and active categories', description: 'Product exact/prefix/contains precedes brand and category; deterministic label/ID ties. Rate limit: 240 per minute per IP.',
    parameters: [parameter('q', { type: 'string', minLength: 2, maxLength: 120 }, true), parameter('limit', { type: 'integer', minimum: 1, maximum: 10, default: 8 })],
    responses: { '200': { description: 'Minimal suggestions.', content: { 'application/json': { schema: { type: 'object', required: ['data'], properties: { data: { type: 'array', items: { $ref: '#/components/schemas/SearchSuggestion' } } } } } } }, '400': error, '429': error, '500': error },
  } },
};
