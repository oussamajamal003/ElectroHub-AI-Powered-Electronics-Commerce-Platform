import { beforeEach, describe, expect, it, vi } from 'vitest';
import sharp from 'sharp';
import { ProductMediaService } from './product-media.service.js';

const ids = vi.hoisted(() => ({ actor: '8f2813b4-a388-44d3-b51e-5d4c40386677', product: '1c5bb1a2-5f0e-4f7a-9d4e-2b8d1f0a9c11', image: '2d6cc2b3-6a1f-4a8b-8e5f-3c9e2a1b0d22', revision: '3e7dd4c4-7b2f-4b9c-8f6e-4d0f3b2c1e33' }));
const state = vi.hoisted(() => ({ image: null as Record<string, unknown> | null, count: 0, created: 0, eventCreates: 0, failEvent: false, replay: null as Record<string, unknown> | null }));
const db = vi.hoisted(() => ({
  $transaction: vi.fn(), $queryRaw: vi.fn(), product: { findUnique: vi.fn() },
  productImage: { findFirst: vi.fn(), findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), count: vi.fn(), create: vi.fn(), update: vi.fn(), updateMany: vi.fn(), findMany: vi.fn() },
  catalogMediaEvent: { findUnique: vi.fn(), findUniqueOrThrow: vi.fn(), findMany: vi.fn(), create: vi.fn(), updateMany: vi.fn() },
  user: { findFirst: vi.fn() },
}));
vi.mock('../lib/prisma.js', () => ({ prisma: db }));
vi.mock('../utils/logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn() }, logSafely: vi.fn() }));

const currentImage = (updatedAt = new Date('2026-10-27T12:00:00.000Z')) => ({
  id: ids.image, productId: ids.product, url: 'https://testproject.supabase.co/storage/v1/object/public/product-media/old.webp',
  altText: null, sortOrder: 0, isPrimary: true, mediaState: 'PUBLISHED', sourceRevision: ids.revision,
  sourceSha256: 'a'.repeat(64), sourceMimeType: 'image/webp', width: 160, height: 160, byteSize: 1000,
  storageProvider: 'SUPABASE_STORAGE', storageBucket: 'product-media', storagePath: 'products/old', retiredAt: null, updatedAt,
});
const requestImage = async () => sharp({ create: { width: 180, height: 160, channels: 3, background: 'red' } }).jpeg().toBuffer();
const storage = { uploadImmutable: vi.fn(), remove: vi.fn() };
const goodObject = { bucket: 'product-media', path: 'products/new.webp', url: 'https://testproject.supabase.co/storage/v1/object/public/product-media/products/new.webp' };

function queryRaw(parts: TemplateStringsArray) {
  const query = parts.join(' ');
  if (query.includes('FROM products')) return [{ id: ids.product }];
  if (query.includes('FROM ai.active_index')) return [{ embedding_version: 'emb_2026.10' }];
  if (query.includes('FROM ai.media_image_embeddings')) return [];
  return [];
}

beforeEach(() => {
  vi.resetAllMocks(); state.image = null; state.count = 0; state.created = 0; state.eventCreates = 0; state.failEvent = false; state.replay = null;
  Object.assign(db, {
    $queryRaw: vi.fn(queryRaw),
    $transaction: vi.fn(async (callback: (tx: typeof db) => Promise<unknown>) => callback(db)),
  });
  db.user.findFirst.mockResolvedValue({ id: ids.actor });
  db.productImage.findFirst.mockImplementation(async () => state.image);
  db.productImage.count.mockImplementation(async () => state.count);
  db.productImage.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
    state.created += 1; state.image = { ...currentImage(), ...data, updatedAt: new Date('2026-10-27T12:01:00.000Z') }; return state.image;
  });
  db.productImage.update.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
    state.image = { ...currentImage(), ...state.image, ...data, updatedAt: new Date('2026-10-27T12:01:00.000Z') }; return state.image;
  });
  db.catalogMediaEvent.findUnique.mockImplementation(async () => state.replay);
  db.catalogMediaEvent.findMany.mockResolvedValue([]);
  db.catalogMediaEvent.create.mockImplementation(async () => { state.eventCreates += 1; if (state.failEvent) throw new Error('outbox failure'); return {}; });
  db.$queryRaw.mockImplementation(queryRaw);
  storage.uploadImmutable.mockResolvedValue(goodObject);
});

const createService = () => new ProductMediaService(db as never, () => storage as never);
const upload = async (service: ProductMediaService, overrides: Record<string, unknown> = {}) => service.upload({
  actorId: ids.actor, productId: ids.product, key: '4f8ee5d5-813e-4c42-a963-d63a98377d03', bytes: await requestImage(), mime: 'image/jpeg', ...overrides,
} as Parameters<ProductMediaService['upload']>[0]);

describe('ProductMediaService upload failure controls (mocked persistence)', () => {
  it('retries only failed current-source work and clears its terminal completion timestamp', async () => {
    state.image = currentImage();
    db.catalogMediaEvent.updateMany.mockResolvedValue({ count: 1 });
    await createService().retry(ids.actor, ids.product, ids.image);
    expect(db.catalogMediaEvent.updateMany).toHaveBeenCalledWith({
      where: { productImageId: ids.image, sourceRevision: ids.revision,
        state: { in: ['PERMANENT_FAILURE', 'RETRY_WAIT'] } },
      data: expect.objectContaining({ state: 'READY', attemptCount: 0, completedAt: null,
        lastErrorCode: null, claimedUntil: null, leaseToken: null }),
    });
  });

  it('normalizes a real JPEG before Storage and returns pending status after publication', async () => {
    const result = await upload(createService());
    expect(storage.uploadImmutable).toHaveBeenCalledTimes(1);
    const uploaded = storage.uploadImmutable.mock.calls[0]?.[0];
    expect(uploaded?.bytes).toBeInstanceOf(Buffer);
    expect(uploaded?.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect((await sharp(uploaded!.bytes).metadata()).format).toBe('webp');
    expect(db.productImage.create).toHaveBeenCalledTimes(1);
    expect(db.catalogMediaEvent.create).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ url: goodObject.url, indexing: { state: 'PENDING' } });
  });

  it('does not write ProductImage or outbox metadata when Storage upload fails', async () => {
    storage.uploadImmutable.mockRejectedValueOnce(new Error('storage offline'));
    await expect(upload(createService())).rejects.toThrow('storage offline');
    expect(db.productImage.create).not.toHaveBeenCalled();
    expect(db.catalogMediaEvent.create).not.toHaveBeenCalled();
  });

  it('keeps the product route identity in the image lookup and rejects cross-product IDs before Storage', async () => {
    state.image = null;
    const service = createService();
    await expect(upload(service, { imageId: ids.image, expected: currentImage().updatedAt.toISOString() }))
      .rejects.toMatchObject({ code: 'MEDIA_NOT_FOUND', statusCode: 404 });
    expect(db.productImage.findFirst).toHaveBeenCalledWith({ where: { id: ids.image, productId: ids.product, mediaState: 'PUBLISHED' } });
    expect(storage.uploadImmutable).not.toHaveBeenCalled();
  });

  it('rejects stale replacement revisions before making a Storage request', async () => {
    state.image = currentImage();
    await expect(upload(createService(), { imageId: ids.image, expected: '2026-10-27T11:59:59.000Z' }))
      .rejects.toMatchObject({ code: 'MEDIA_CONFLICT', statusCode: 409 });
    expect(storage.uploadImmutable).not.toHaveBeenCalled();
    expect(db.productImage.update).not.toHaveBeenCalled();
  });

  it('rejects idempotency-key reuse with a different request fingerprint before side effects', async () => {
    state.replay = { requestSha256: 'f'.repeat(64), productImageId: ids.image };
    await expect(upload(createService())).rejects.toMatchObject({ code: 'MEDIA_IDEMPOTENCY_CONFLICT', statusCode: 409 });
    expect(db.$transaction).not.toHaveBeenCalled();
    expect(storage.uploadImmutable).not.toHaveBeenCalled();
  });

  it('propagates outbox insertion failure from the DB transaction callback after the image write is attempted', async () => {
    state.failEvent = true;
    await expect(upload(createService())).rejects.toThrow('outbox failure');
    expect(db.productImage.create).toHaveBeenCalledTimes(1);
    expect(db.catalogMediaEvent.create).toHaveBeenCalledTimes(1);
    expect(db.$transaction).toHaveBeenCalledTimes(2);
    // This fake proves service control flow and error propagation only; it does not prove PostgreSQL rollback atomicity.
  });
});
