import { createHash, randomUUID } from 'node:crypto';
import { Prisma, type ProductImage } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { normalizeProductMedia } from '../validators/product-media.validator.js';
import { SupabaseProductMediaStorage, ProductMediaStorageError, resolveProductMediaStorageConfig } from '../integrations/storage/product-media.storage.js';
import { describeDatabaseTarget, DEV_PROJECT, PROD_PROJECT } from '../lib/database-target.js';
import { env } from '../config/env.js';

type Client = Prisma.TransactionClient;
type IndexContext = { version: string | null; events: Map<string, { state: string; lastErrorCode: string | null }>;
  indexed: Set<string> };
export type MediaPatch = { altText?: string; isPrimary?: true; sortOrder?: number };
const conflict = () => new AppError('This gallery changed. Refresh it and try again.', 409, 'MEDIA_CONFLICT');
export function assertMediaRevision(image: Pick<ProductImage, 'sourceRevision' | 'updatedAt'>, expected: string) {
  // updatedAt also protects metadata changes on an unchanged source revision.
  if (expected !== image.updatedAt.toISOString()) throw conflict();
}
const fingerprint = (parts: unknown[]) => createHash('sha256').update(JSON.stringify(parts)).digest('hex');
const nextTimestamp = (previous: Date) => new Date(Math.max(Date.now(), previous.getTime() + 1));
// Match the bounded cross-region transaction budget used by cart/wishlist.
// Gallery work is capped at eight images; decoding and Storage stay outside it.
const MEDIA_TRANSACTION_OPTIONS = { maxWait: 10_000, timeout: 30_000 };
function defaultStorage() {
  const config = resolveProductMediaStorageConfig(process.env);
  if (!config) throw new ProductMediaStorageError('NOT_CONFIGURED', 'Product media storage is not configured.');
  const target = describeDatabaseTarget(env.DATABASE_URL);
  const expected = target.category === 'dev' ? DEV_PROJECT : target.category === 'production' ? PROD_PROJECT : null;
  if (!expected || config.projectRef !== expected) throw new ProductMediaStorageError('NOT_CONFIGURED', 'Media Storage and database identities disagree.');
  return new SupabaseProductMediaStorage(config);
}

export class ProductMediaService {
  constructor(private readonly db = prisma,
    private readonly storage: () => Pick<SupabaseProductMediaStorage, 'uploadImmutable'> = defaultStorage) {}

  async products(q: string) {
    return this.db.product.findMany({ where: { isTestFixture: false,
      OR: [{ name: { contains: q, mode: 'insensitive' } }, { sku: { contains: q, mode: 'insensitive' } }] },
      orderBy: [{ name: 'asc' }, { id: 'asc' }], take: 30, select: { id: true, name: true, slug: true } });
  }
  async product(productId: string) {
    const product = await this.db.product.findUnique({ where: { id: productId }, select: { id: true, name: true, slug: true } });
    if (!product) throw new AppError('Product not found.', 404, 'PRODUCT_NOT_FOUND');
    return product;
  }

  private async authorize(tx: Client, actorId: string) {
    // Lock the actor as well as read the current role: revocation cannot race publication.
    await tx.$queryRaw`SELECT id FROM users WHERE id = ${actorId}::uuid FOR SHARE`;
    const actor = await tx.user.findFirst({ where: { id: actorId, isActive: true, role: { name: 'ADMIN' } }, select: { id: true } });
    if (!actor) throw new AppError('Administrator access is required.', 403, 'MEDIA_FORBIDDEN');
  }

  private async lock(tx: Client, productId: string, actorId: string) {
    await this.authorize(tx, actorId);
    const rows = await tx.$queryRaw<{ id: string }[]>`SELECT id FROM products WHERE id = ${productId}::uuid FOR UPDATE`;
    if (!rows.length) throw new AppError('Product not found.', 404, 'PRODUCT_NOT_FOUND');
  }

  private async image(tx: Client, productId: string, imageId: string) {
    const image = await tx.productImage.findFirst({ where: { id: imageId, productId, mediaState: 'PUBLISHED' } });
    if (!image) throw new AppError('Image not found.', 404, 'MEDIA_NOT_FOUND');
    return image;
  }

  private async project(image: ProductImage, tx: Client = this.db, context?: IndexContext) {
    const events = context ? [] : await tx.catalogMediaEvent.findMany({ where: { productImageId: image.id, sourceRevision: image.sourceRevision },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1 });
    const event = context?.events.get(image.id) ?? events[0];
    const active = context ? [] : await tx.$queryRaw<{ embedding_version: string }[]>`SELECT embedding_version FROM ai.active_index WHERE singleton = true`;
    const version = context?.version ?? active[0]?.embedding_version ?? null;
    const indexed = context ? (context.indexed.has(image.id) ? [{ found: true }] : []) : image.sourceRevision && version ? await tx.$queryRaw<{ found: boolean }[]>`
      SELECT true AS found FROM ai.media_image_embeddings WHERE product_image_id = ${image.id}::uuid
      AND embedding_version = ${version} AND source_revision = ${image.sourceRevision}::uuid
      AND source_sha256 = ${image.sourceSha256} LIMIT 1` : [];
    const state = indexed.length ? 'INDEXED' : !image.sourceRevision ? 'LEGACY' :
      event?.state === 'CLAIMED' ? 'PROCESSING' : event?.state === 'PERMANENT_FAILURE' ? 'FAILED' :
      event?.state === 'RETRY_WAIT' ? 'RETRY_WAIT' : 'PENDING';
    return { id: image.id, productId: image.productId, url: image.url, altText: image.altText,
      sortOrder: image.sortOrder, isPrimary: image.isPrimary, sourceRevision: image.sourceRevision,
      updatedAt: image.updatedAt.toISOString(), width: image.width, height: image.height, mediaState: image.mediaState,
      indexing: { state, embeddingVersion: version, errorCode: event?.lastErrorCode ?? null } };
  }

  async list(productId: string) {
    if (!await this.db.product.findUnique({ where: { id: productId }, select: { id: true } })) {
      throw new AppError('Product not found.', 404, 'PRODUCT_NOT_FOUND');
    }
    const images = await this.db.productImage.findMany({ where: { productId, mediaState: 'PUBLISHED' },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
    if (!images.length) return [];
    const [active, events, overlays] = await Promise.all([
      this.db.$queryRaw<{ embedding_version: string }[]>`SELECT embedding_version FROM ai.active_index WHERE singleton = true`,
      this.db.catalogMediaEvent.findMany({ where: { productImageId: { in: images.map(image => image.id) } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], take: 1000 }),
      this.db.$queryRaw<{ product_image_id: string; source_revision: string; source_sha256: string; embedding_version: string }[]>`
        SELECT product_image_id,source_revision,source_sha256,embedding_version FROM ai.media_image_embeddings WHERE product_id = ${productId}::uuid`,
    ]);
    const version = active[0]?.embedding_version ?? null;
    const context: IndexContext = { version, events: new Map(), indexed: new Set() };
    for (const image of images) {
      const event = events.find(event => event.productImageId === image.id && event.sourceRevision === image.sourceRevision);
      if (event) context.events.set(image.id, event);
      if (overlays.some(overlay => overlay.product_image_id === image.id && overlay.source_revision === image.sourceRevision &&
        overlay.source_sha256 === image.sourceSha256 && overlay.embedding_version === version)) context.indexed.add(image.id);
    }
    return Promise.all(images.map(image => this.project(image, this.db, context)));
  }

  async upload(input: { actorId: string; productId: string; imageId?: string; expected?: string;
    key: string; bytes: Buffer; mime: string; altText?: string }) {
    const normalized = await normalizeProductMedia(input.bytes, input.mime);
    const requestSha256 = fingerprint([input.actorId, input.productId, input.imageId ?? null,
      input.expected ?? null, normalized.sha256, input.altText ?? null]);
    const key = `upload:${input.key}`;
    // Resolve completed retries before external side effects; the final transaction also deduplicates races.
    const replay = await this.db.catalogMediaEvent.findUnique({ where: { idempotencyKey: key } });
    if (replay) {
      if (replay.requestSha256 !== requestSha256) throw new AppError('This request key was already used.', 409, 'MEDIA_IDEMPOTENCY_CONFLICT');
      const image = await this.db.productImage.findUniqueOrThrow({ where: { id: replay.productImageId } });
      return this.project(image);
    }
    // Preflight ownership/role before Storage traffic. Final transaction repeats all checks.
    await this.db.$transaction(async tx => {
      await this.lock(tx, input.productId, input.actorId);
      if (input.imageId) assertMediaRevision(await this.image(tx, input.productId, input.imageId), input.expected ?? '');
      else if (await tx.productImage.count({ where: { productId: input.productId, mediaState: 'PUBLISHED' } }) >= 8) {
        throw new AppError('This gallery already has eight images.', 409, 'MEDIA_GALLERY_FULL');
      }
    }, MEDIA_TRANSACTION_OPTIONS);
    const imageId = input.imageId ?? randomUUID();
    const revision = randomUUID();
    const object = await this.storage().uploadImmutable({ productId: input.productId, imageId, revision,
      bytes: normalized.bytes, sha256: normalized.sha256 });
    // Never delete on uncertain commit; retained orphan objects are reconciled against DB and order snapshots.
    const image = await this.db.$transaction(async tx => {
      await this.lock(tx, input.productId, input.actorId);
      const duplicate = await tx.catalogMediaEvent.findUnique({ where: { idempotencyKey: key } });
      if (duplicate) {
        if (duplicate.requestSha256 !== requestSha256) throw new AppError('This request key was already used.', 409, 'MEDIA_IDEMPOTENCY_CONFLICT');
        return tx.productImage.findUniqueOrThrow({ where: { id: duplicate.productImageId } });
      }
      const current = input.imageId ? await this.image(tx, input.productId, input.imageId) : null;
      if (current) assertMediaRevision(current, input.expected ?? '');
      const count = await tx.productImage.count({ where: { productId: input.productId, mediaState: 'PUBLISHED' } });
      if (!current && count >= 8) throw new AppError('This gallery already has eight images.', 409, 'MEDIA_GALLERY_FULL');
      const metadata = { url: object.url, storageProvider: 'SUPABASE_STORAGE', storageBucket: object.bucket,
        storagePath: object.path, sourceRevision: revision, sourceSha256: normalized.sha256,
        sourceMimeType: normalized.mimeType, width: normalized.width, height: normalized.height, byteSize: normalized.byteSize,
        ...(current ? { updatedAt: nextTimestamp(current.updatedAt) } : {}),
        ...(input.altText !== undefined ? { altText: input.altText } : {}) };
      const result = current ? await tx.productImage.update({ where: { id: imageId }, data: metadata }) :
        await tx.productImage.create({ data: { ...metadata, id: imageId, productId: input.productId, sortOrder: count, isPrimary: count === 0 } });
      await tx.catalogMediaEvent.create({ data: { idempotencyKey: key, requestSha256, productId: input.productId,
        productImageId: imageId, operation: current ? 'REPLACED' : 'ADDED', sourceRevision: revision, sourceSha256: normalized.sha256 } });
      return result;
    }, MEDIA_TRANSACTION_OPTIONS);
    return this.project(image);
  }

  async patch(actorId: string, productId: string, imageId: string, expected: string, patch: MediaPatch) {
    const image = await this.db.$transaction(async tx => {
      await this.lock(tx, productId, actorId);
      const current = await this.image(tx, productId, imageId);
      assertMediaRevision(current, expected);
      if (patch.isPrimary) {
        const previous = await tx.productImage.findFirst({ where: { productId, mediaState: 'PUBLISHED', isPrimary: true } });
        if (previous && previous.id !== imageId) await tx.productImage.update({ where: { id: previous.id },
          data: { isPrimary: false, updatedAt: nextTimestamp(previous.updatedAt) } });
      }
      if (patch.sortOrder !== undefined) {
        const images = await tx.productImage.findMany({ where: { productId, mediaState: 'PUBLISHED' }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
        const ordered = images.filter(item => item.id !== imageId);
        ordered.splice(Math.min(patch.sortOrder, ordered.length), 0, current);
        for (const [sortOrder, item] of ordered.entries()) await tx.productImage.update({ where: { id: item.id },
          data: { sortOrder, updatedAt: nextTimestamp(item.updatedAt) } });
      }
      return tx.productImage.update({ where: { id: imageId }, data: { altText: patch.altText, isPrimary: patch.isPrimary,
        updatedAt: nextTimestamp(current.updatedAt) } });
    }, MEDIA_TRANSACTION_OPTIONS);
    return this.project(image);
  }

  async retire(actorId: string, productId: string, imageId: string, expected: string) {
    await this.db.$transaction(async tx => {
      await this.lock(tx, productId, actorId);
      const current = await this.image(tx, productId, imageId);
      assertMediaRevision(current, expected);
      await tx.productImage.update({ where: { id: imageId }, data: { mediaState: 'RETIRED', retiredAt: new Date(), isPrimary: false,
        updatedAt: nextTimestamp(current.updatedAt) } });
      if (current.isPrimary) {
        const next = await tx.productImage.findFirst({ where: { productId, mediaState: 'PUBLISHED' }, orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }] });
        if (next) await tx.productImage.update({ where: { id: next.id },
          data: { isPrimary: true, updatedAt: nextTimestamp(next.updatedAt) } });
      }
      await tx.catalogMediaEvent.create({ data: { idempotencyKey: `retire:${randomUUID()}`, requestSha256: fingerprint([imageId, expected]),
        productId, productImageId: imageId, operation: 'RETIRED', sourceRevision: current.sourceRevision, sourceSha256: current.sourceSha256 } });
    }, MEDIA_TRANSACTION_OPTIONS);
    return { id: imageId };
  }

  async retry(actorId: string, productId: string, imageId: string) {
    const image = await this.db.$transaction(async tx => {
      await this.lock(tx, productId, actorId);
      const current = await this.image(tx, productId, imageId);
      await tx.catalogMediaEvent.updateMany({ where: { productImageId: imageId, sourceRevision: current.sourceRevision,
        state: { in: ['PERMANENT_FAILURE', 'RETRY_WAIT'] } },
      data: { state: 'READY', attemptCount: 0, nextAttemptAt: new Date(), lastErrorCode: null, completedAt: null, claimedUntil: null, leaseToken: null } });
      return current;
    }, MEDIA_TRANSACTION_OPTIONS);
    return this.project(image);
  }
}
