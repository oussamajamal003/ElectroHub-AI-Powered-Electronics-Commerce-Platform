const reference = (name: string) => ({ $ref: `#/components/schemas/${name}` });
const nullableString = { type: 'string', nullable: true };
const money = { type: 'string', pattern: '^(0|[1-9][0-9]{0,9})\\.[0-9]{2}$', example: '499.00' };
const summary = {
  type: 'object', required: ['id', 'name', 'slug'],
  properties: { id: { type: 'string', format: 'uuid' }, name: { type: 'string' }, slug: { type: 'string' } },
};
const productProperties = {
  id: { type: 'string', format: 'uuid' }, name: { type: 'string' }, slug: { type: 'string' },
  price: money, compareAtPrice: { ...money, nullable: true }, currency: { type: 'string', enum: ['USD'] },
  availability: { type: 'string', enum: ['AVAILABLE', 'UNAVAILABLE'] },
  category: reference('ProductRelationSummary'),
  brand: { ...summary, nullable: true, description: 'Null for unresolved legacy products only.' },
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
    type: 'object', required: [...Object.keys(productProperties), 'primaryImage'],
    properties: { ...productProperties, primaryImage: { type: 'object', nullable: true,
      properties: { id: { type: 'string', format: 'uuid' }, url: { type: 'string' }, altText: nullableString,
        sortOrder: { type: 'integer' }, isPrimary: { type: 'boolean' } } } },
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
    ...summary, required: ['id', 'name', 'slug', 'description', 'imageUrl'],
    properties: { ...summary.properties, description: nullableString, imageUrl: nullableString },
  },
  BrandMetadata: {
    ...summary, required: ['id', 'name', 'slug', 'description', 'logoUrl'],
    properties: { ...summary.properties, description: nullableString, logoUrl: nullableString },
  },
  ProductPagination: {
    type: 'object', required: ['page', 'pageSize', 'total'],
    properties: { page: { type: 'integer', minimum: 1, maximum: 1000000 },
      pageSize: { type: 'integer', minimum: 1, maximum: 100 }, total: { type: 'integer', minimum: 0 } },
  },
};

const errorResponse = (description: string) => ({
  description, content: { 'application/json': { schema: reference('ProductError') } },
});
const collectionOperation = (schema: string, description: string) => ({
  tags: ['Products'], description,
  parameters: [
    { name: 'page', in: 'query', schema: { type: 'integer', default: 1, minimum: 1, maximum: 1000000 } },
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
  '/products': { get: collectionOperation('ProductSummary', 'Active products in active categories. Created time descending, then ID ascending. Primary image only; no search/filter/sort.') },
  '/products/{slug}': { get: detailOperation('ProductDetail', 280, 'Active product details. Images: primary first, sortOrder then ID. Specifications: group, sortOrder then ID.') },
  '/categories': { get: collectionOperation('CategoryMetadata', 'Active categories ordered by name then ID. No product arrays.') },
  '/categories/{slug}': { get: detailOperation('CategoryMetadata', 120, 'Active category metadata.') },
  '/brands': { get: collectionOperation('BrandMetadata', 'Brands ordered by name then ID. No product arrays.') },
  '/brands/{slug}': { get: detailOperation('BrandMetadata', 120, 'Brand metadata.') },
};
