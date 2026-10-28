import { createHash } from 'node:crypto';

export const PRODUCT_MEDIA_BUCKET_DEFAULT = 'product-media';
export const PRODUCT_MEDIA_STORAGE_TIMEOUT_MS = 10_000;

export interface ProductMediaStorageConfig {
  supabaseUrl: URL;
  serviceRoleKey: string;
  /** Preferred modern API key; unlike legacy service_role JWTs, this must not be sent as Bearer. */
  secretKey?: string;
  projectRef: string;
  bucket?: string;
  timeoutMs?: number;
}

export interface ProductMediaStorageEnvironment {
  NODE_ENV?: string;
  SUPABASE_URL?: string;
  SUPABASE_SECRET_KEY?: string;
  SUPABASE_SERVICE_ROLE_KEY?: string;
  SUPABASE_PROJECT_REF?: string;
  PRODUCT_MEDIA_BUCKET?: string;
  PRODUCT_MEDIA_STORAGE_TIMEOUT_MS?: string;
}

export interface ImmutableProductMediaInput {
  productId: string;
  imageId: string;
  revision: string;
  bytes: Buffer;
  sha256: string;
}

export interface StoredProductMedia {
  bucket: string;
  path: string;
  url: string;
}

export interface ProductMediaStorageEntry {
  path: string;
  kind: 'folder' | 'file';
  byteSize: number | null;
  contentType: string | null;
  updatedAt: string | null;
}

export type StorageFetch = typeof fetch;

export class ProductMediaStorageError extends Error {
  constructor(
    readonly code: 'NOT_CONFIGURED' | 'INVALID_INPUT' | 'UPSTREAM' | 'INTEGRITY' | 'TIMEOUT',
    message: string,
    readonly statusCode = 503,
  ) {
    super(message);
    this.name = 'ProductMediaStorageError';
  }
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<Buffer> {
  const declaredBytes = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
    await response.body?.cancel();
    throw new ProductMediaStorageError('INTEGRITY', 'Storage response exceeded its allowed size.', 503);
  }
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    byteLength += value.byteLength;
    if (byteLength > maxBytes) {
      await reader.cancel();
      throw new ProductMediaStorageError('INTEGRITY', 'Storage response exceeded its allowed size.', 503);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, byteLength);
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA256 = /^[0-9a-f]{64}$/i;
const PRODUCT_MEDIA_PATH = new RegExp(`^products/${UUID.source.slice(1, -1)}/${UUID.source.slice(1, -1)}/${UUID.source.slice(1, -1)}/original\\.webp$`, 'i');

/** Resolves storage-only configuration lazily so missing credentials never block commerce startup. */
export function resolveProductMediaStorageConfig(
  source: ProductMediaStorageEnvironment,
  timeoutMs = PRODUCT_MEDIA_STORAGE_TIMEOUT_MS,
): ProductMediaStorageConfig | null {
  const { SUPABASE_URL, SUPABASE_PROJECT_REF } = source;
  if (source.PRODUCT_MEDIA_STORAGE_TIMEOUT_MS !== undefined) timeoutMs = Number(source.PRODUCT_MEDIA_STORAGE_TIMEOUT_MS);
  const credential = source.SUPABASE_SECRET_KEY || source.SUPABASE_SERVICE_ROLE_KEY;
  if (!SUPABASE_URL && !credential && !SUPABASE_PROJECT_REF) return null;
  if (!SUPABASE_URL || !credential || !SUPABASE_PROJECT_REF) {
    throw new ProductMediaStorageError('NOT_CONFIGURED', 'Product media storage is not fully configured.');
  }

  let supabaseUrl: URL;
  try {
    supabaseUrl = new URL(SUPABASE_URL);
  } catch {
    throw new ProductMediaStorageError('NOT_CONFIGURED', 'Product media storage URL is invalid.');
  }
  const projectRef = SUPABASE_PROJECT_REF.trim();
  const usesSecretKey = Boolean(source.SUPABASE_SECRET_KEY);
  const nodeEnv = source.NODE_ENV ?? process.env.NODE_ENV ?? 'development';
  const expectedProjectRef = nodeEnv === 'production' ? 'yepfgjehdstlxbpespun' :
    nodeEnv === 'development' ? 'pzxekjybdiulzmssalfo' : undefined;
  if (
    (supabaseUrl.protocol !== 'https:' && !(supabaseUrl.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(supabaseUrl.hostname))) ||
    supabaseUrl.username || supabaseUrl.password || supabaseUrl.search || supabaseUrl.hash || supabaseUrl.pathname !== '/' ||
    !/^[a-z0-9-]{8,64}$/i.test(projectRef) || supabaseUrl.hostname.toLowerCase() !== `${projectRef.toLowerCase()}.supabase.co` ||
    (expectedProjectRef !== undefined && projectRef.toLowerCase() !== expectedProjectRef) ||
    credential !== credential.trim() || credential.length < 32 ||
    (usesSecretKey && !/^sb_secret_[a-z0-9_-]{24,64}$/i.test(credential)) ||
    !Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 30_000
  ) {
    throw new ProductMediaStorageError('NOT_CONFIGURED', 'Product media storage configuration failed validation.');
  }

  const bucket = source.PRODUCT_MEDIA_BUCKET?.trim() || PRODUCT_MEDIA_BUCKET_DEFAULT;
  if (bucket !== PRODUCT_MEDIA_BUCKET_DEFAULT) {
    throw new ProductMediaStorageError('NOT_CONFIGURED', 'Product media bucket must be product-media.');
  }
  return {
    supabaseUrl,
    serviceRoleKey: credential,
    ...(usesSecretKey ? { secretKey: credential } : {}),
    projectRef,
    bucket,
    timeoutMs,
  };
}

function productMediaPath(input: ImmutableProductMediaInput): string {
  if (!UUID.test(input.productId) || !UUID.test(input.imageId) || !UUID.test(input.revision) ||
      !Buffer.isBuffer(input.bytes) || input.bytes.length === 0 || !SHA256.test(input.sha256)) {
    throw new ProductMediaStorageError('INVALID_INPUT', 'Product media upload input is invalid.', 400);
  }
  const digest = createHash('sha256').update(input.bytes).digest('hex');
  if (digest !== input.sha256.toLowerCase()) {
    throw new ProductMediaStorageError('INTEGRITY', 'Normalized product media digest does not match its bytes.', 422);
  }
  return `products/${input.productId.toLowerCase()}/${input.imageId.toLowerCase()}/${input.revision.toLowerCase()}/original.webp`;
}

/** Server-only Supabase Storage REST adapter. It never upserts and verifies bytes before reporting success. */
export class ProductMediaStorage {
  constructor(
    private readonly config: ProductMediaStorageConfig,
    private readonly request: StorageFetch = fetch,
  ) {
    if (!config) throw new ProductMediaStorageError('NOT_CONFIGURED', 'Product media storage is not configured.');
  }

  async uploadImmutable(input: ImmutableProductMediaInput): Promise<StoredProductMedia> {
    const path = productMediaPath(input);
    const encodedPath = path.split('/').map(encodeURIComponent).join('/');
    const bucket = this.config.bucket ?? PRODUCT_MEDIA_BUCKET_DEFAULT;
    const objectEndpoint = new URL(`/storage/v1/object/${encodeURIComponent(bucket)}/${encodedPath}`, this.config.supabaseUrl);

    await this.withRequest(async signal => {
      const response = await this.request(objectEndpoint, {
        method: 'POST',
        headers: {
          apikey: this.config.secretKey ?? this.config.serviceRoleKey,
          ...(!this.config.secretKey ? { authorization: `Bearer ${this.config.serviceRoleKey}` } : {}),
          'content-type': 'image/webp',
          'cache-control': 'public, max-age=31536000, immutable',
          'x-upsert': 'false',
        },
        body: input.bytes,
        signal,
      });
      if (!response.ok) throw this.upstreamError(response.status);
      await response.body?.cancel();
    });

    await this.withRequest(async signal => {
      const response = await this.request(objectEndpoint, {
        method: 'GET',
        headers: {
          apikey: this.config.secretKey ?? this.config.serviceRoleKey,
          ...(!this.config.secretKey ? { authorization: `Bearer ${this.config.serviceRoleKey}` } : {}),
        },
        signal,
      });
      if (!response.ok) throw this.upstreamError(response.status);
      const expectedBytes = input.bytes.length;
      const body = await readBoundedBody(response, expectedBytes);
      if (body.length !== expectedBytes || createHash('sha256').update(body).digest('hex') !== input.sha256.toLowerCase()) {
        throw new ProductMediaStorageError('INTEGRITY', 'Uploaded product media failed integrity verification.', 503);
      }
    });

    const url = new URL(`/storage/v1/object/public/${encodeURIComponent(bucket)}/${encodedPath}`, this.config.supabaseUrl);
    return { bucket, path, url: url.toString() };
  }

  /** Reads one bounded listing page. It never walks folders or mutates Storage; callers choose recursion bounds. */
  async listBounded(prefix: string, limit: number, offset = 0): Promise<ProductMediaStorageEntry[]> {
    const segments = prefix.split('/');
    if (
      (segments[0] !== 'products') || segments.length > 4 ||
      segments.slice(1).some(segment => !UUID.test(segment)) ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > 1000 ||
      !Number.isSafeInteger(offset) || offset < 0 || offset > 10_000_000
    ) {
      throw new ProductMediaStorageError('INVALID_INPUT', 'Product media listing request is invalid.', 400);
    }
    const endpoint = new URL(`/storage/v1/object/list/${encodeURIComponent(this.config.bucket ?? PRODUCT_MEDIA_BUCKET_DEFAULT)}`, this.config.supabaseUrl);
    return this.withRequest(async signal => {
      const headers = new Headers({
        apikey: this.config.secretKey ?? this.config.serviceRoleKey,
        'content-type': 'application/json',
      });
      if (!this.config.secretKey) headers.set('authorization', `Bearer ${this.config.serviceRoleKey}`);
      const response = await this.request(endpoint, {
        method: 'POST', headers,
        body: JSON.stringify({ prefix, limit, offset, sortBy: { column: 'name', order: 'asc' } }),
        signal,
      });
      if (!response.ok) throw this.upstreamError(response.status);
      const raw = await readBoundedBody(response, 2 * 1024 * 1024);
      let parsed: unknown;
      try { parsed = JSON.parse(raw.toString('utf8')); } catch {
        throw new ProductMediaStorageError('INTEGRITY', 'Storage returned an invalid listing.', 503);
      }
      if (!Array.isArray(parsed) || parsed.length > limit) {
        throw new ProductMediaStorageError('INTEGRITY', 'Storage returned an invalid listing.', 503);
      }
      return parsed.map((entry: unknown) => {
        if (!entry || typeof entry !== 'object' || !('name' in entry) || typeof entry.name !== 'string' ||
            entry.name.length === 0 || entry.name === '.' || entry.name === '..' || entry.name.includes('/') ||
            entry.name.includes('\\') || entry.name.includes('%')) {
          throw new ProductMediaStorageError('INTEGRITY', 'Storage returned an invalid listing entry.', 503);
        }
        const item = entry as { name: string; id?: unknown; metadata?: unknown; updated_at?: unknown };
        const isFolder = item.id === null;
        const metadata = item.metadata && typeof item.metadata === 'object' ? item.metadata as Record<string, unknown> : {};
        const size = metadata.size;
        return {
          path: `${prefix}/${item.name}`,
          kind: isFolder ? 'folder' as const : 'file' as const,
          byteSize: typeof size === 'number' && Number.isSafeInteger(size) && size >= 0 ? size : null,
          contentType: typeof metadata.mimetype === 'string' && metadata.mimetype.length <= 128 ? metadata.mimetype : null,
          updatedAt: typeof item.updated_at === 'string' && item.updated_at.length <= 64 ? item.updated_at : null,
        };
      });
    });
  }

  /** Explicit object removal for an authorized cleanup workflow; never called as part of upload/retirement. */
  async remove(path: string): Promise<void> {
    if (!PRODUCT_MEDIA_PATH.test(path) || path.includes('..')) {
      throw new ProductMediaStorageError('INVALID_INPUT', 'Product media object path is invalid.', 400);
    }
    const endpoint = new URL(`/storage/v1/object/${encodeURIComponent(this.config.bucket ?? PRODUCT_MEDIA_BUCKET_DEFAULT)}`, this.config.supabaseUrl);
    await this.withRequest(async signal => {
      const response = await this.request(endpoint, {
        method: 'DELETE',
        headers: {
          apikey: this.config.secretKey ?? this.config.serviceRoleKey,
          ...(!this.config.secretKey ? { authorization: `Bearer ${this.config.serviceRoleKey}` } : {}),
          'content-type': 'application/json',
        },
        body: JSON.stringify({ prefixes: [path] }),
        signal,
      });
      if (!response.ok) throw this.upstreamError(response.status);
      await response.body?.cancel();
    });
  }

  private upstreamError(status: number): ProductMediaStorageError {
    return new ProductMediaStorageError('UPSTREAM', `Product media storage request failed (HTTP ${status}).`, 503);
  }

  private async withRequest<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs ?? PRODUCT_MEDIA_STORAGE_TIMEOUT_MS);
    try {
      return await operation(controller.signal);
    } catch (error) {
      if (error instanceof ProductMediaStorageError) throw error;
      if (controller.signal.aborted) throw new ProductMediaStorageError('TIMEOUT', 'Product media storage request timed out.');
      throw new ProductMediaStorageError('UPSTREAM', 'Product media storage request failed.');
    } finally {
      clearTimeout(timer);
    }
  }
}

/** Production convenience wrapper; env is read only when a media operation constructs this adapter. */
export class SupabaseProductMediaStorage extends ProductMediaStorage {
  constructor(
    config: ProductMediaStorageConfig | null = resolveProductMediaStorageConfig(process.env),
    request: StorageFetch = fetch,
  ) {
    if (!config) throw new ProductMediaStorageError('NOT_CONFIGURED', 'Product media storage is not configured.');
    super(config, request);
  }
}
