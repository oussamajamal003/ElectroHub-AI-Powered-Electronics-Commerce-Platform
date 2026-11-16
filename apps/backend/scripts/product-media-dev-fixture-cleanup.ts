import { env } from '../src/config/env.js';
import { DEV_PROJECT, resolveDatabaseTargets } from '../src/lib/database-target.js';
import { prisma } from '../src/lib/prisma.js';
import { SupabaseProductMediaStorage, resolveProductMediaStorageConfig } from '../src/integrations/storage/product-media.storage.js';

const PRODUCT_ID = 'bcbb6186-e00a-4ffd-860d-3624a9b6f48e';
const SKU = 'EH-T043-DEV-69502083';
const RUN_ID = '69502083-e479-47a7-bf51-7dfcb1689aac';
const PRODUCT_NAME = 'Wireless Headphones — Task 04.3 DEV Search QA 69502083';
const ACTIVE_MODEL = 'siglip2-b16-p256-d1-b3900dd9fad5';
const EXPECTED_MIGRATION_COUNT = 25;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ACTIVE_WORKER_STATES = ['STARTING', 'READY', 'PROCESSING', 'STOPPING'];
const PAGE_SIZE = 200;

type OverlayRow = { product_image_id: string; product_id: string; source_revision: string; embedding_version: string };

function assertInvocation(): void {
  if (process.argv.length !== 6 || process.argv[2] !== 'execute' || process.argv[3] !== PRODUCT_ID ||
      process.argv[4] !== SKU || process.argv[5] !== RUN_ID) {
    throw new Error(`USAGE: node --import tsx scripts/product-media-dev-fixture-cleanup.ts execute ${PRODUCT_ID} ${SKU} ${RUN_ID}`);
  }
  if (env.NODE_ENV !== 'development') throw new Error('FIXTURE_ENVIRONMENT_REFUSED');
  const targets = resolveDatabaseTargets({ ...process.env, NODE_ENV: env.NODE_ENV,
    DATABASE_URL: env.DATABASE_URL, DIRECT_URL: env.DIRECT_URL, DB_RUNTIME_URL_SOURCE: env.DB_RUNTIME_URL_SOURCE });
  const expectedIdentity = `supabase:${DEV_PROJECT}/postgres`;
  if (DEV_PROJECT !== 'pzxekjybdiulzmssalfo' || targets.runtime.category !== 'dev' ||
      targets.migration.category !== 'dev' || targets.runtime.identity !== expectedIdentity ||
      targets.migration.identity !== expectedIdentity) throw new Error('FIXTURE_DATABASE_TARGET_REFUSED');
  const storageUrl = process.env.SUPABASE_URL ? new URL(process.env.SUPABASE_URL) : null;
  if (process.env.SUPABASE_PROJECT_REF !== DEV_PROJECT || storageUrl?.hostname !== `${DEV_PROJECT}.supabase.co` ||
      (process.env.PRODUCT_MEDIA_BUCKET ?? 'product-media') !== 'product-media') throw new Error('FIXTURE_STORAGE_TARGET_REFUSED');
}

async function assertDevAiIdentity() {
  const [identity, migrations, active, base] = await Promise.all([
    prisma.$queryRaw<{ database: string; hasAi: boolean; hasHeartbeat: boolean }[]>`
      SELECT current_database()::text AS database, to_regnamespace('ai') IS NOT NULL AS "hasAi",
        to_regclass('ai.media_worker_heartbeats') IS NOT NULL AS "hasHeartbeat"`,
    prisma.$queryRaw<{ count: number }[]>`SELECT count(*)::int AS count FROM public._prisma_migrations WHERE finished_at IS NOT NULL`,
    prisma.$queryRaw<{ embedding_version: string }[]>`SELECT embedding_version FROM ai.active_index WHERE singleton = true`,
    prisma.$queryRaw<{ count: number }[]>`SELECT count(*)::int AS count FROM ai.product_image_embeddings WHERE embedding_version = ${ACTIVE_MODEL}`,
  ]);
  if (identity[0]?.database !== 'postgres' || !identity[0]?.hasAi || !identity[0]?.hasHeartbeat ||
      migrations[0]?.count !== EXPECTED_MIGRATION_COUNT || active[0]?.embedding_version !== ACTIVE_MODEL) {
    throw new Error('FIXTURE_DEV_AI_PREFLIGHT_REFUSED');
  }
  return { activeVersion: active[0].embedding_version, baseVectorCount: base[0]?.count ?? 0 };
}

async function assertWorkerStoppedAndQueueIdle(): Promise<void> {
  const [workers, pending] = await Promise.all([
    prisma.$queryRaw<{ state: string; ageSeconds: number; currentEventId: string | null }[]>`
      SELECT state, GREATEST(0, EXTRACT(EPOCH FROM (clock_timestamp() - heartbeat_at)))::int AS "ageSeconds",
        current_event_id::text AS "currentEventId"
      FROM ai.media_worker_heartbeats ORDER BY heartbeat_at DESC LIMIT 100`,
    prisma.catalogMediaEvent.count({ where: { productId: PRODUCT_ID, state: { in: ['READY', 'CLAIMED', 'RETRY_WAIT'] } } }),
  ]);
  if (workers.some(worker => ACTIVE_WORKER_STATES.includes(worker.state) && worker.ageSeconds <= 60) || pending !== 0 ||
      workers.some(worker => worker.currentEventId !== null && worker.ageSeconds <= 60)) {
    throw new Error('FIXTURE_WORKER_OR_QUEUE_ACTIVE');
  }
}

async function listOnlyFixtureStorage(adapter: SupabaseProductMediaStorage): Promise<string[]> {
  const root = `products/${PRODUCT_ID}`;
  const pending = [root];
  const visited = new Set<string>();
  const files: string[] = [];
  let listedEntries = 0;
  while (pending.length) {
    const prefix = pending.pop()!;
    if (visited.has(prefix)) continue;
    visited.add(prefix);
    let offset = 0;
    while (true) {
      const page = await adapter.listBounded(prefix, PAGE_SIZE, offset);
      listedEntries += page.length;
      if (listedEntries > 500) throw new Error('FIXTURE_STORAGE_BOUND_EXCEEDED');
      for (const entry of page) {
        if (entry.kind === 'folder') {
          if (!/^products\/[0-9a-f-]{36}(?:\/[0-9a-f-]{36}){0,2}$/i.test(entry.path)) {
            throw new Error('FIXTURE_STORAGE_PATH_REFUSED');
          }
          pending.push(entry.path);
        } else {
          files.push(entry.path);
        }
      }
      if (page.length < PAGE_SIZE) break;
      offset += page.length;
    }
  }
  if (new Set(files).size !== files.length) throw new Error('FIXTURE_STORAGE_DUPLICATE_PATH');
  return files.sort();
}

async function main(): Promise<void> {
  assertInvocation();
  const baseline = await assertDevAiIdentity();
  const config = resolveProductMediaStorageConfig(process.env);
  if (!config || config.projectRef !== DEV_PROJECT || config.bucket !== 'product-media') throw new Error('FIXTURE_STORAGE_CONFIG_REFUSED');
  const adapter = new SupabaseProductMediaStorage(config);

  const product = await prisma.product.findUnique({ where: { id: PRODUCT_ID }, select: {
    id: true, sku: true, name: true, description: true, category: { select: { slug: true } },
    cartItems: { select: { id: true } }, wishItems: { select: { id: true } },
    inventory: { select: { quantity: true } }, specifications: { select: { id: true } }, reviews: { select: { id: true } },
  } });
  if (!product) {
    const leftovers = await prisma.$queryRaw<{ count: number }[]>`
      SELECT ((SELECT count(*) FROM public.catalog_media_events WHERE "productId" = ${PRODUCT_ID}::uuid) +
              (SELECT count(*) FROM public.product_images WHERE "productId" = ${PRODUCT_ID}::uuid) +
              (SELECT count(*) FROM ai.media_image_embeddings WHERE product_id = ${PRODUCT_ID}::uuid) +
              (SELECT count(*) FROM ai.catalog_media_sources WHERE product_id = ${PRODUCT_ID}::uuid) +
              (SELECT count(*) FROM ai.product_image_embeddings WHERE product_id = ${PRODUCT_ID}::uuid))::int AS count`;
    const historicalUrls = await prisma.$queryRaw<{ count: number }[]>`
      SELECT ((SELECT count(*) FROM public.order_items WHERE "productImageUrl" LIKE ${`%/products/${PRODUCT_ID}/%`}) +
              (SELECT count(*) FROM public.payment_attempt_items WHERE "imageUrl" LIKE ${`%/products/${PRODUCT_ID}/%`}))::int AS count`;
    const objects = await listOnlyFixtureStorage(adapter);
    if (leftovers[0]?.count !== 0 || historicalUrls[0]?.count !== 0 ||
        objects.some(path => !/^products\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/original\.webp$/i.test(path))) {
      throw new Error('FIXTURE_PARTIAL_CLEANUP_REQUIRES_REVIEW');
    }
    await assertWorkerStoppedAndQueueIdle();
    for (const path of objects) await adapter.remove(path);
    const remaining = await listOnlyFixtureStorage(adapter);
    if (remaining.length) throw new Error('FIXTURE_STORAGE_POSTCONDITION_FAILED');
    console.log(JSON.stringify({ target: `supabase:${DEV_PROJECT}/postgres`, alreadyAbsent: true,
      recoveredStorageObjects: objects.length, remainingStorageObjects: 0 }));
    return;
  }
  if (product.sku !== SKU || product.name !== PRODUCT_NAME || product.category.slug !== 'headphones' ||
      !product.description?.includes(`run ${RUN_ID}`)) throw new Error('FIXTURE_PRODUCT_IDENTITY_REFUSED');
  if (product.cartItems.length || product.wishItems.length || product.specifications.length || product.reviews.length ||
      product.inventory?.quantity !== 0) throw new Error('FIXTURE_DEPENDENT_DATA_REQUIRES_REVIEW');

  const [orderRefs, paymentRefs, historicalUrls, images, events, overlay, baseForFixture, objects] = await Promise.all([
    prisma.orderItem.count({ where: { productId: PRODUCT_ID } }),
    prisma.paymentAttemptItem.count({ where: { productId: PRODUCT_ID } }),
    prisma.$queryRaw<{ count: number }[]>`
      SELECT ((SELECT count(*) FROM public.order_items WHERE "productImageUrl" LIKE ${`%/products/${PRODUCT_ID}/%`}) +
              (SELECT count(*) FROM public.payment_attempt_items WHERE "imageUrl" LIKE ${`%/products/${PRODUCT_ID}/%`}))::int AS count`,
    prisma.productImage.findMany({ where: { productId: PRODUCT_ID }, orderBy: { id: 'asc' },
      select: { id: true, productId: true, storageProvider: true, storageBucket: true, storagePath: true,
        sourceRevision: true, mediaState: true } }),
    prisma.catalogMediaEvent.findMany({ where: { productId: PRODUCT_ID }, orderBy: { id: 'asc' },
      select: { id: true, productId: true, productImageId: true, sourceRevision: true, state: true } }),
    prisma.$queryRaw<OverlayRow[]>`SELECT product_image_id::text, product_id::text, source_revision::text, embedding_version
      FROM ai.media_image_embeddings WHERE product_id = ${PRODUCT_ID}::uuid ORDER BY product_image_id`,
    prisma.$queryRaw<{ count: number }[]>`SELECT count(*)::int AS count FROM ai.product_image_embeddings
      WHERE product_id = ${PRODUCT_ID}::uuid OR product_image_id IN
        (SELECT id FROM public.product_images WHERE "productId" = ${PRODUCT_ID}::uuid)`,
    listOnlyFixtureStorage(adapter),
  ]);
  if (orderRefs || paymentRefs || historicalUrls[0]?.count) throw new Error('FIXTURE_ORDER_HISTORY_PROTECTED');
  if (baseForFixture[0]?.count !== 0) throw new Error('FIXTURE_BASE_VECTOR_PRESENT');

  const imageIds = new Set(images.map(image => image.id));
  if (events.some(event => event.productId !== PRODUCT_ID || !imageIds.has(event.productImageId))) {
    throw new Error('FIXTURE_EVENT_IDENTITY_REFUSED');
  }
  if (overlay.some(row => row.product_id !== PRODUCT_ID || !imageIds.has(row.product_image_id))) {
    throw new Error('FIXTURE_OVERLAY_IDENTITY_REFUSED');
  }
  if (events.some(event => ['READY', 'CLAIMED', 'RETRY_WAIT'].includes(event.state))) throw new Error('FIXTURE_EVENT_PENDING');

  const revisionsByImage = new Map<string, Set<string>>();
  const addRevision = (imageId: string, revision: string | null) => {
    if (!revision) return;
    if (!UUID.test(imageId) || !UUID.test(revision)) throw new Error('FIXTURE_REVISION_IDENTITY_REFUSED');
    const set = revisionsByImage.get(imageId) ?? new Set<string>();
    set.add(revision.toLowerCase()); revisionsByImage.set(imageId, set);
  };
  for (const image of images) {
    if (image.productId !== PRODUCT_ID) throw new Error('FIXTURE_IMAGE_IDENTITY_REFUSED');
    addRevision(image.id, image.sourceRevision);
    if (image.storagePath && !image.storagePath.startsWith(`products/${PRODUCT_ID}/`)) throw new Error('FIXTURE_IMAGE_PATH_REFUSED');
  }
  for (const event of events) addRevision(event.productImageId, event.sourceRevision);
  for (const row of overlay) addRevision(row.product_image_id, row.source_revision);

  const expectedPaths = new Set<string>();
  for (const [imageId, revisions] of revisionsByImage) {
    for (const revision of revisions) expectedPaths.add(`products/${PRODUCT_ID}/${imageId}/${revision}/original.webp`);
  }
  for (const image of images) {
    if (image.storageProvider === 'SUPABASE_STORAGE' &&
        (image.storageBucket !== 'product-media' || !image.storagePath || !expectedPaths.has(image.storagePath))) {
      throw new Error('FIXTURE_CURRENT_STORAGE_REFERENCE_REFUSED');
    }
  }
  if (objects.some(path => !/^products\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/original\.webp$/i.test(path) || !expectedPaths.has(path))) {
    throw new Error('FIXTURE_UNRELATED_STORAGE_OBJECT');
  }
  const eventIds = events.map(event => event.id);
  const imageIdList = images.map(image => image.id);
  const expectedStoragePaths = objects;

  await assertWorkerStoppedAndQueueIdle();
  const deletion = await prisma.$transaction(async tx => {
    await tx.$queryRaw`SELECT id FROM public.products WHERE id = ${PRODUCT_ID}::uuid FOR UPDATE`;
    await tx.$queryRaw`SELECT id FROM public.inventory WHERE "productId" = ${PRODUCT_ID}::uuid FOR UPDATE`;
    const locked = await tx.product.findUnique({ where: { id: PRODUCT_ID }, select: { sku: true, name: true,
      description: true, category: { select: { slug: true } }, inventory: { select: { quantity: true } },
      cartItems: { select: { id: true } }, wishItems: { select: { id: true } },
      specifications: { select: { id: true } }, reviews: { select: { id: true } } } });
    if (!locked || locked.sku !== SKU || locked.name !== PRODUCT_NAME || locked.category.slug !== 'headphones' ||
        !locked.description?.includes(`run ${RUN_ID}`) || locked.inventory?.quantity !== 0 || locked.cartItems.length ||
        locked.wishItems.length || locked.specifications.length || locked.reviews.length) {
      throw new Error('FIXTURE_PRODUCT_CHANGED_DURING_CLEANUP');
    }
    const [protectedOrders, protectedPayments, remainingEvents, remainingImages] = await Promise.all([
      tx.orderItem.count({ where: { productId: PRODUCT_ID } }),
      tx.paymentAttemptItem.count({ where: { productId: PRODUCT_ID } }),
      tx.catalogMediaEvent.findMany({ where: { productId: PRODUCT_ID }, select: { id: true, state: true } }),
      tx.productImage.findMany({ where: { productId: PRODUCT_ID }, select: { id: true } }),
    ]);
    if (protectedOrders || protectedPayments || remainingEvents.length !== eventIds.length ||
        remainingImages.length !== imageIdList.length || remainingEvents.some(event => !eventIds.includes(event.id)) ||
        remainingImages.some(image => !imageIdList.includes(image.id)) ||
        remainingEvents.some(event => ['READY', 'CLAIMED', 'RETRY_WAIT'].includes(event.state))) {
      throw new Error('FIXTURE_CHANGED_DURING_CLEANUP');
    }
    const protectedHistoricalUrls = await tx.$queryRaw<{ count: number }[]>`
      SELECT ((SELECT count(*) FROM public.order_items WHERE "productImageUrl" LIKE ${`%/products/${PRODUCT_ID}/%`}) +
              (SELECT count(*) FROM public.payment_attempt_items WHERE "imageUrl" LIKE ${`%/products/${PRODUCT_ID}/%`}))::int AS count`;
    if (protectedHistoricalUrls[0]?.count) throw new Error('FIXTURE_ORDER_HISTORY_PROTECTED');
    const removedOverlay = await tx.$executeRaw`DELETE FROM ai.media_image_embeddings
      WHERE product_id = ${PRODUCT_ID}::uuid`;
    if (Number(removedOverlay) !== overlay.length) throw new Error('FIXTURE_OVERLAY_CHANGED_DURING_CLEANUP');
    const removedEvents = await tx.catalogMediaEvent.deleteMany({ where: { id: { in: eventIds }, productId: PRODUCT_ID } });
    if (removedEvents.count !== eventIds.length) throw new Error('FIXTURE_EVENTS_CHANGED_DURING_CLEANUP');
    const removedProduct = await tx.product.deleteMany({ where: { id: PRODUCT_ID, sku: SKU, name: PRODUCT_NAME,
      category: { slug: 'headphones' } } });
    if (removedProduct.count !== 1) throw new Error('FIXTURE_PRODUCT_CHANGED_DURING_CLEANUP');
    return { images: imageIdList.length, events: removedEvents.count, overlayVectors: Number(removedOverlay) };
  }, { maxWait: 10_000, timeout: 30_000 });

  for (const path of expectedStoragePaths) await adapter.remove(path);
  const [productAfter, eventAfter, imageAfter, overlayAfter, sourceAfter, baseAfter, pathsAfter] = await Promise.all([
    prisma.product.count({ where: { id: PRODUCT_ID } }),
    prisma.catalogMediaEvent.count({ where: { productId: PRODUCT_ID } }),
    prisma.productImage.count({ where: { productId: PRODUCT_ID } }),
    prisma.$queryRaw<{ count: number }[]>`SELECT count(*)::int AS count FROM ai.media_image_embeddings WHERE product_id = ${PRODUCT_ID}::uuid`,
    prisma.$queryRaw<{ count: number }[]>`SELECT count(*)::int AS count FROM ai.catalog_media_sources WHERE product_id = ${PRODUCT_ID}::uuid`,
    prisma.$queryRaw<{ count: number }[]>`SELECT count(*)::int AS count FROM ai.product_image_embeddings WHERE embedding_version = ${ACTIVE_MODEL}`,
    listOnlyFixtureStorage(adapter),
  ]);
  if (productAfter || eventAfter || imageAfter || overlayAfter[0]?.count || sourceAfter[0]?.count || pathsAfter.length ||
      baseAfter[0]?.count !== baseline.baseVectorCount) throw new Error('FIXTURE_CLEANUP_POSTCONDITION_FAILED');
  const activeAfter = await prisma.$queryRaw<{ embedding_version: string }[]>`SELECT embedding_version FROM ai.active_index WHERE singleton = true`;
  if (activeAfter[0]?.embedding_version !== baseline.activeVersion) throw new Error('FIXTURE_ACTIVE_MODEL_CHANGED');
  console.log(JSON.stringify({ target: `supabase:${DEV_PROJECT}/postgres`, product: PRODUCT_ID, sku: SKU, runId: RUN_ID,
    categoryPreserved: 'headphones', removed: deletion, imageIds, revisions: [...revisionsByImage.entries()].map(([imageId, revisions]) => ({ imageId, revisions: [...revisions] })),
    eventIds, overlay: overlay.map(row => ({ imageId: row.product_image_id, revision: row.source_revision, model: row.embedding_version })),
    removedStoragePaths: expectedStoragePaths,
    activeModelPreserved: baseline.activeVersion, baseVectorCountPreserved: baseline.baseVectorCount,
    postconditions: { product: productAfter, productImages: imageAfter, events: eventAfter, overlayVectors: overlayAfter[0]?.count ?? 0,
      aiCatalogSources: sourceAfter[0]?.count ?? 0,
      fixtureStorageObjects: pathsAfter.length } }));
}

main().catch(error => {
  const safeCode = error instanceof Error && /^[A-Z0-9_:-]{1,100}$/.test(error.message) ? error.message : 'FIXTURE_CLEANUP_FAILED';
  console.error(safeCode);
  process.exitCode = 1;
}).finally(async () => prisma.$disconnect());
