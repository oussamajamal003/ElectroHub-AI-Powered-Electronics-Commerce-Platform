const security = [{ bearerAuth: [] }];
const product = { name: 'productId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } };
const image = { name: 'imageId', in: 'path', required: true, schema: { type: 'string', format: 'uuid' } };
const revision = { name: 'If-Match', in: 'header', required: true, description: 'Exact updatedAt ISO timestamp from the current image response.', schema: { type: 'string', format: 'date-time' } };
const errors = { 400: { description: 'Invalid input' }, 401: { description: 'Authentication required' },
  403: { description: 'Live ADMIN required' }, 404: { description: 'Product/image not found' },
  409: { description: 'Gallery/revision/idempotency conflict' }, 413: { description: 'Input exceeds 6 MiB' },
  415: { description: 'Not a JPEG, PNG or WebP' }, 422: { description: 'Unsafe/corrupt image or invalid dimensions' },
  429: { description: 'Rate/concurrent processing limit' }, 503: { description: 'Storage unavailable' } };
const common = { tags: ['Admin product media'], security, responses: { 200: { description: 'Authoritative media response; indexing is independent of publication' }, ...errors } };
const fileBody = { required: true, content: { 'multipart/form-data': { schema: { type: 'object', required: ['file'], additionalProperties: false,
  properties: { file: { type: 'string', format: 'binary', description: 'One JPEG, PNG or WebP; <=6 MiB, 128–6000 px, <=20M pixels' }, altText: { type: 'string', maxLength: 255 } } } } } };
const key = { name: 'Idempotency-Key', in: 'header', required: true, schema: { type: 'string', format: 'uuid' } };
export const productMediaPaths = {
  '/admin/products': { get: { ...common, summary: 'Search and page through existing products for media editing',
    parameters: [{ name: 'q', in: 'query', schema: { type: 'string', maxLength: 100 }, description: 'Case-insensitive match across product name and SKU.' },
      { name: 'page', in: 'query', schema: { type: 'integer', minimum: 1, default: 1 } },
      { name: 'pageSize', in: 'query', schema: { type: 'integer', minimum: 1, maximum: 50, default: 30 } }],
    responses: { 200: { description: 'Product page in `data` plus `meta.page`, `meta.pageSize`, `meta.total`, and `meta.totalPages`.' }, ...errors } } },
  '/admin/products/{productId}/images': {
    get: { ...common, summary: 'Published gallery and truthful indexing states', parameters: [product] },
    post: { ...common, summary: 'Publish a normalized immutable photo', parameters: [product, key], requestBody: fileBody,
      responses: { 201: { description: 'Image published; AI indexing pending' }, ...errors } },
  },
  '/admin/products/{productId}': { get: { ...common, summary: 'Resolve a product for direct media navigation', parameters: [product] } },
  '/admin/products/{productId}/images/{imageId}/file': { put: { ...common, summary: 'Replace source while retaining logical image ID',
    parameters: [product, image, revision, key], requestBody: fileBody } },
  '/admin/products/{productId}/images/{imageId}': {
    patch: { ...common, summary: 'Edit alt text, select primary, or move to a zero-based position', parameters: [product, image, revision],
      requestBody: { required: true, content: { 'application/json': { schema: { type: 'object', additionalProperties: false, minProperties: 1,
        properties: { altText: { type: 'string', maxLength: 255 }, isPrimary: { type: 'boolean', enum: [true] }, sortOrder: { type: 'integer', minimum: 0, maximum: 1000 } } } } } } },
    delete: { ...common, summary: 'Retire photo; retain bytes and historical order snapshots', parameters: [product, image, revision] },
  },
  '/admin/products/{productId}/images/{imageId}/retry': { post: { ...common, summary: 'Retry eligible failed indexing for current source', parameters: [product, image] } },
  '/admin/products/{productId}/image-index-status': { get: { ...common, summary: 'Current per-image index status', parameters: [product] } },
};
