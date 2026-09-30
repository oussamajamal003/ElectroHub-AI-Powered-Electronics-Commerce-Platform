const reference = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const nullableString = { type: 'string', nullable: true };
const money = { type: 'string', pattern: '^(0|[1-9][0-9]{0,9})\\.[0-9]{2}$', example: '499.00' };
const summary = {
  type: 'object', required: ['id', 'name', 'slug'],
  properties: { id: { type: 'string', format: 'uuid' }, name: { type: 'string' }, slug: { type: 'string' } },
};
const productProperties = {
  id: { type: 'string', format: 'uuid' }, name: { type: 'string' }, slug: { type: 'string' },
  description: nullableString,
  price: money, compareAtPrice: { ...money, nullable: true }, currency: { type: 'string', enum: ['USD'] },
  availability: { type: 'string', enum: ['AVAILABLE', 'UNAVAILABLE'] },
  category: reference('ProductRelationSummary'),
  brand: { ...summary, nullable: true, description: 'Null for unresolved legacy products only.' },
  averageRating: { type: 'string', nullable: true, pattern: '^[1-5]\\.[0-9]$', example: '4.5' },
  reviewCount: { type: 'integer', minimum: 0 },
  discountPercent: { type: 'integer', nullable: true, minimum: 1, maximum: 100 },
};

export const productSchemas = {
  ProductError: {
    type: 'object', required: ['error'],
    properties: { error: { type: 'object', required: ['code', 'message'],
      properties: { code: { type: 'string' }, message: { type: 'string' } } } },
  },
  ProductRelationSummary: summary,
  ProductImage: {
    type: 'object', required: ['id', 'url', 'altText', 'sortOrder', 'isPrimary'],
    properties: {
      id: { type: 'string', format: 'uuid' }, url: { type: 'string', maxLength: 2048 },
      altText: nullableString, sortOrder: { type: 'integer' }, isPrimary: { type: 'boolean' },
    },
  },
  ProductSpecification: {
    type: 'object', required: ['id', 'group', 'name', 'value', 'sortOrder'],
    properties: { id: { type: 'string', format: 'uuid' }, group: { type: 'string' },
      name: { type: 'string' }, value: { type: 'string' }, sortOrder: { type: 'integer' } },
  },
  ProductSummary: {
    type: 'object', required: [...Object.keys(productProperties), 'primaryImage', 'secondaryImage'],
    properties: { ...productProperties, primaryImage: { ...reference('ProductImage'), nullable: true },
      secondaryImage: { ...reference('ProductImage'), nullable: true } },
  },
  ProductDetail: {
    type: 'object', required: [...Object.keys(productProperties), 'description', 'sku', 'modelNumber', 'images', 'specifications'],
    properties: { ...productProperties, description: nullableString, sku: { type: 'string' },
      modelNumber: nullableString, images: { type: 'array', items: reference('ProductImage') },
      specifications: { type: 'array', items: { type: 'object', required: ['group', 'items'], properties: {
        group: { type: 'string' }, items: { type: 'array', items: reference('ProductSpecification') },
      } } } },
  },
  CategoryMetadata: {
    ...summary, required: ['id', 'name', 'slug', 'description', 'imageUrl', 'productCount'],
    properties: { ...summary.properties, description: nullableString, imageUrl: nullableString,
      productCount: { type: 'integer', minimum: 0 } },
  },
  BrandMetadata: {
    ...summary, required: ['id', 'name', 'slug', 'description', 'logoUrl'],
    properties: { ...summary.properties, description: nullableString, logoUrl: nullableString },
  },
  ProductPagination: {
    type: 'object', required: ['page', 'pageSize', 'total'],
    properties: { page: { type: 'integer', minimum: 1, maximum: 1000 },
      pageSize: { type: 'integer', minimum: 1, maximum: 100 }, total: { type: 'integer', minimum: 0 } },
  },
  Review: {
    type: 'object', required: ['id', 'rating', 'body', 'author', 'createdAt', 'updatedAt'],
    properties: { id: { type: 'string', format: 'uuid' }, rating: { type: 'integer', minimum: 1, maximum: 5 },
      body: { type: 'string', minLength: 1, maxLength: 2000 },
      author: { type: 'object', properties: { displayName: { type: 'string' } } },
      createdAt: { type: 'string', format: 'date-time' }, updatedAt: { type: 'string', format: 'date-time' } },
  },
  ReviewSummary: {
    type: 'object', required: ['averageRating', 'reviewCount'],
    properties: { averageRating: { type: 'string', nullable: true, pattern: '^\\d+\\.\\d$' }, reviewCount: { type: 'integer', minimum: 0 } },
  },
};

const errorResponse = (description: string) => ({
  description, content: { 'application/json': { schema: reference('ProductError') } },
});
const collectionOperation = (schema: string, description: string) => ({
  tags: ['Products'], description,
  parameters: [
    { name: 'page', in: 'query', schema: { type: 'integer', default: 1, minimum: 1, maximum: 1000 } },
    { name: 'pageSize', in: 'query', schema: { type: 'integer', default: 20, minimum: 1, maximum: 100 } },
  ],
  responses: {
    '200': { description: 'Paginated metadata. Monetary values are exact decimal strings in USD.',
      content: { 'application/json': { schema: { type: 'object', required: ['data', 'meta'], properties: {
        data: { type: 'array', items: reference(schema) }, meta: reference('ProductPagination'),
      } } } } },
    '400': errorResponse('Invalid or unsupported query parameters.'),
    '500': errorResponse('Unexpected failure; sanitized response.'),
  },
});
const detailOperation = (schema: string, maxLength: number, description: string) => ({
  tags: ['Products'], description,
  parameters: [{ name: 'slug', in: 'path', required: true,
    schema: { type: 'string', maxLength, pattern: '^[a-z0-9]+(?:-[a-z0-9]+)*$' } }],
  responses: {
    '200': { description: 'Resource metadata.',
      content: { 'application/json': { schema: { type: 'object', required: ['data'],
        properties: { data: reference(schema) } } } } },
    '400': errorResponse('Invalid slug or unsupported query parameters.'),
    '404': errorResponse('Resource not found or not publicly available.'),
    '500': errorResponse('Unexpected failure; sanitized response.'),
  },
});

export const productPaths = {
  '/reviews/me': { get: { tags: ['Reviews'], security: [{ bearerAuth: [] }], summary: 'List the authenticated customer’s reviews with Product context',
    parameters: [{ name: 'page', in: 'query', schema: { type: 'integer', default: 1, maximum: 1000 } },
      { name: 'pageSize', in: 'query', schema: { type: 'integer', default: 10, maximum: 50 } }],
    responses: { '200': { description: 'Bounded reviews belonging only to the authenticated customer, with public Product summaries.' },
      '400': errorResponse('Invalid pagination.'), '401': errorResponse('Authentication required.'),
      '403': errorResponse('Customer role required.') } } },
  '/products': { get: collectionOperation('ProductSummary', 'Active products in active categories. Created time descending, then ID ascending. Includes primary and secondary list-preview images; no search/filter/sort.') },
  '/products/deals': { get: collectionOperation('ProductSummary', 'Bounded active products with compare-at price greater than current price; newest first.') },
  '/products/{slug}': { get: detailOperation('ProductDetail', 280, 'Active product details. Images: primary first, sortOrder then ID. Specifications: group, sortOrder then ID.') },
  '/categories': { get: collectionOperation('CategoryMetadata', 'Active categories ordered by name then ID. No product arrays.') },
  '/categories/{slug}': { get: detailOperation('CategoryMetadata', 120, 'Active category metadata.') },
  '/brands': { get: collectionOperation('BrandMetadata', 'Brands ordered by name then ID. No product arrays.') },
  '/brands/{slug}': { get: detailOperation('BrandMetadata', 120, 'Brand metadata.') },
  '/products/{slug}/reviews': {
    get: { tags: ['Reviews'], summary: 'List public reviews, newest first',
      parameters: [{ name: 'slug', in: 'path', required: true, schema: { type: 'string' } },
        { name: 'page', in: 'query', schema: { type: 'integer', default: 1, maximum: 1000 } },
        { name: 'pageSize', in: 'query', schema: { type: 'integer', default: 10, maximum: 50 } }],
      responses: { '200': { description: 'Paginated public reviews and current rating summary; author display only, no email or User fields.' },
        '400': errorResponse('Invalid pagination.'), '404': errorResponse('Product not found.') } },
    post: { tags: ['Reviews'], summary: 'Create one review for the authenticated customer',
      security: [{ bearerAuth: [] }],
      requestBody: { required: true, content: { 'application/json': { schema: { type: 'object',
        required: ['rating', 'body'], properties: { rating: { type: 'integer', minimum: 1, maximum: 5 },
          body: { type: 'string', minLength: 1, maxLength: 2000 } } } } } },
      responses: { '201': { description: 'Review and updated Product rating summary.' }, '400': errorResponse('Invalid review.'),
        '401': errorResponse('Authentication required.'), '403': errorResponse('Customer role required.'),
        '404': errorResponse('Product not found.'), '409': errorResponse('Review already exists.'),
        '429': errorResponse('Review write limit reached.') } },
  },
  '/products/{slug}/reviews/me': {
    get: { tags: ['Reviews'], security: [{ bearerAuth: [] }], summary: 'Get current customer review, or { data: null }',
      responses: { '200': { description: 'Own review or null.' }, '401': errorResponse('Authentication required.') } },
    patch: { tags: ['Reviews'], security: [{ bearerAuth: [] }], summary: 'Update own review',
      responses: { '200': { description: 'Updated review and Product rating summary.' }, '400': errorResponse('Invalid review.'),
        '401': errorResponse('Authentication required.'), '403': errorResponse('Customer role required.'),
        '404': errorResponse('Review or Product not found.'), '429': errorResponse('Review write limit reached.') } },
    delete: { tags: ['Reviews'], security: [{ bearerAuth: [] }], summary: 'Delete own review',
      responses: { '204': { description: 'Review deleted.' }, '401': errorResponse('Authentication required.'),
        '403': errorResponse('Customer role required.'), '404': errorResponse('Review or Product not found.'),
        '429': errorResponse('Review write limit reached.') } },
  },
};
