export type MediaIndexState = 'LEGACY' | 'PENDING' | 'PROCESSING' | 'INDEXED' | 'RETRY_WAIT' | 'FAILED';

export interface AdminMediaProduct {
  id: string;
  name: string;
  slug: string;
}

export interface MediaImage {
  id: string;
  productId: string;
  url: string;
  altText: string | null;
  sortOrder: number;
  isPrimary: boolean;
  sourceRevision: string | null;
  mediaState: 'PUBLISHED' | 'RETIRED';
  width: number | null;
  height: number | null;
  updatedAt: string;
  indexing: {
    state: MediaIndexState;
    embeddingVersion: string | null;
    errorCode: string | null;
  };
}

export interface ApiData<T> { data: T }

export function mediaConcurrencyTag(image: MediaImage): string {
  return image.updatedAt;
}

export function newIdempotencyKey(): string {
  if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x40;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = [...bytes].map(byte => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
