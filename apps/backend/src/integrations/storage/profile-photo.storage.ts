import { randomUUID } from 'node:crypto';
import type { ProductMediaStorageConfig } from './product-media.storage.js';
import { ProductMediaStorageError } from './product-media.storage.js';

export const PROFILE_PHOTOS_BUCKET = 'profile-photos';
export const PROFILE_PHOTO_URL_TTL_SECONDS = 30 * 60;
export const PROFILE_PHOTO_URL_TTL_MS = PROFILE_PHOTO_URL_TTL_SECONDS * 1000;
const MAX_PROFILE_PHOTO_BYTES = 5 * 1024 * 1024;
const RESPONSE_LIMIT_BYTES = 128 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WEBP_OBJECT = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\.webp$/i;

export type ProfilePhotoRole = 'CUSTOMER' | 'ADMIN';
export type ProfilePhotoStorageFetch = typeof fetch;

export function profilePhotoObjectPath(role: ProfilePhotoRole, userId: string, objectId: string): string {
  if (!['CUSTOMER', 'ADMIN'].includes(role) || !UUID.test(userId) || !UUID.test(objectId)) {
    throw new ProductMediaStorageError('INVALID_INPUT', 'Profile photo object identity is invalid.', 400);
  }
  const folder = role === 'ADMIN' ? 'admins' : 'customers';
  return folder + '/' + userId.toLowerCase() + '/' + objectId.toLowerCase() + '.webp';
}

export function isOwnedProfilePhotoPath(path: string, role: ProfilePhotoRole, userId: string): boolean {
  if (!UUID.test(userId)) return false;
  const segments = path.split('/');
  const expectedFolder = role === 'ADMIN' ? 'admins' : 'customers';
  return segments.length === 3 && segments[0] === expectedFolder &&
    segments[1] === userId.toLowerCase() && WEBP_OBJECT.test(segments[2]);
}

async function readBoundedBody(response: Response, maxBytes: number): Promise<Buffer> {
  const declaredBytes = Number(response.headers.get('content-length'));
  if (Number.isFinite(declaredBytes) && declaredBytes > maxBytes) {
    await response.body?.cancel();
    throw new ProductMediaStorageError('INTEGRITY', 'Storage returned an oversized response.', 503);
  }
  const reader = response.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const chunks: Uint8Array[] = [];
  let length = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.byteLength;
    if (length > maxBytes) {
      await reader.cancel();
      throw new ProductMediaStorageError('INTEGRITY', 'Storage returned an oversized response.', 503);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks, length);
}

/** Server-only adapter for the private profile photo bucket. Paths are derived from the authenticated identity. */
export class ProfilePhotoStorage {
  constructor(
    private readonly config: ProductMediaStorageConfig,
    private readonly request: ProfilePhotoStorageFetch = fetch,
    private readonly timeoutMs = 10_000,
  ) {}

  async upload(role: ProfilePhotoRole, userId: string, bytes: Buffer): Promise<string> {
    if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > MAX_PROFILE_PHOTO_BYTES) {
      throw new ProductMediaStorageError('INVALID_INPUT', 'Profile photo upload is invalid.', 400);
    }
    const path = profilePhotoObjectPath(role, userId, randomUUID());
    const endpoint = this.objectEndpoint(path);
    await this.withRequest(async signal => {
      const response = await this.request(endpoint, {
        method: 'POST',
        headers: this.headers({
          'content-type': 'image/webp',
          'cache-control': '1800',
          'x-upsert': 'false',
        }),
        body: bytes,
        signal,
      });
      if (!response.ok) throw this.upstreamError(response.status);
      await response.body?.cancel();
    });
    return path;
  }

  async createSignedReadUrl(path: string): Promise<{ url: string; expiresAt: string }> {
    this.assertPath(path);
    const endpoint = this.objectEndpoint(path, true);
    const raw = await this.withRequest(async signal => {
      const response = await this.request(endpoint, {
        method: 'POST',
        headers: this.headers({ 'content-type': 'application/json' }),
        body: JSON.stringify({ expiresIn: PROFILE_PHOTO_URL_TTL_SECONDS }),
        signal,
      });
      if (!response.ok) throw this.upstreamError(response.status);
      return readBoundedBody(response, RESPONSE_LIMIT_BYTES);
    });

    let value: unknown;
    try { value = JSON.parse(raw.toString('utf8')); } catch {
      throw new ProductMediaStorageError('INTEGRITY', 'Storage returned an invalid signed link.', 503);
    }
    const signed = value && typeof value === 'object'
      ? Reflect.get(value, 'signedURL') ?? Reflect.get(value, 'signedUrl')
      : null;
    if (typeof signed !== 'string' || signed.length > 4096) {
      throw new ProductMediaStorageError('INTEGRITY', 'Storage returned an invalid signed link.', 503);
    }

    let url: URL;
    try {
      if (/^https?:\/\//i.test(signed)) url = new URL(signed);
      else {
        const relative = signed.replace(/^\/+/, '').replace(/^storage\/v1\//, '');
        url = new URL('/storage/v1/' + relative, this.config.supabaseUrl.origin);
      }
    } catch {
      throw new ProductMediaStorageError('INTEGRITY', 'Storage returned an invalid signed link.', 503);
    }
    if (
      (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost', '127.0.0.1'].includes(url.hostname))) ||
      url.origin !== this.config.supabaseUrl.origin ||
      !url.pathname.startsWith('/storage/v1/object/sign/' + PROFILE_PHOTOS_BUCKET + '/') ||
      url.hash
    ) {
      throw new ProductMediaStorageError('INTEGRITY', 'Storage returned an invalid signed link.', 503);
    }
    return { url: url.toString(), expiresAt: new Date(Date.now() + PROFILE_PHOTO_URL_TTL_MS).toISOString() };
  }

  async remove(path: string): Promise<void> {
    this.assertPath(path);
    const endpoint = new URL('/storage/v1/object/' + encodeURIComponent(PROFILE_PHOTOS_BUCKET), this.config.supabaseUrl);
    await this.withRequest(async signal => {
      const response = await this.request(endpoint, {
        method: 'DELETE',
        headers: this.headers({ 'content-type': 'application/json' }),
        body: JSON.stringify({ prefixes: [path] }),
        signal,
      });
      if (!response.ok) throw this.upstreamError(response.status);
      await response.body?.cancel();
    });
  }

  private objectEndpoint(path: string, sign = false): URL {
    this.assertPath(path);
    const suffix = path.split('/').map(encodeURIComponent).join('/');
    const action = sign ? 'sign/' : '';
    return new URL('/storage/v1/object/' + action + encodeURIComponent(PROFILE_PHOTOS_BUCKET) + '/' + suffix, this.config.supabaseUrl);
  }

  private assertPath(path: string) {
    const segments = path.split('/');
    if (segments.length !== 3 || !['admins', 'customers'].includes(segments[0]) || !UUID.test(segments[1]) ||
        !WEBP_OBJECT.test(segments[2]) || path.includes('..')) {
      throw new ProductMediaStorageError('INVALID_INPUT', 'Profile photo object path is invalid.', 400);
    }
  }

  private headers(extra: Record<string, string>): Headers {
    const headers = new Headers({ apikey: this.config.secretKey ?? this.config.serviceRoleKey, ...extra });
    if (!this.config.secretKey) headers.set('authorization', 'Bearer ' + this.config.serviceRoleKey);
    return headers;
  }

  private upstreamError(status: number): ProductMediaStorageError {
    return new ProductMediaStorageError('UPSTREAM', 'Profile photo storage failed (HTTP ' + status + ').', 503);
  }

  private async withRequest<T>(operation: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      return await operation(controller.signal);
    } catch (error) {
      if (error instanceof ProductMediaStorageError) throw error;
      if (controller.signal.aborted) throw new ProductMediaStorageError('TIMEOUT', 'Profile photo storage request timed out.', 503);
      throw new ProductMediaStorageError('UPSTREAM', 'Profile photo storage request failed.', 503);
    } finally {
      clearTimeout(timer);
    }
  }
}
