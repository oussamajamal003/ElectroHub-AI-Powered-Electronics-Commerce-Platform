import { randomUUID } from 'node:crypto';
import { Prisma, ProductStatus, InventoryStatus } from '@prisma/client';
import { env } from '../src/config/env.js';
import { DEV_PROJECT, resolveDatabaseTargets } from '../src/lib/database-target.js';
import { prisma } from '../src/lib/prisma.js';

const EXPECTED_ACTIVE_VERSION = 'siglip2-b16-p256-d1-b3900dd9fad5';
const EXPECTED_MIGRATION_COUNT = 25;

function assertExactDevTarget() {
  if (env.NODE_ENV !== 'development') throw new Error('FIXTURE_ENVIRONMENT_REFUSED');
  const expectedIdentity = `supabase:${DEV_PROJECT}/postgres`;
  const targets = resolveDatabaseTargets({ ...process.env, NODE_ENV: env.NODE_ENV,
    DATABASE_URL: env.DATABASE_URL, DIRECT_URL: env.DIRECT_URL,
    DB_RUNTIME_URL_SOURCE: env.DB_RUNTIME_URL_SOURCE });
  if (DEV_PROJECT !== 'pzxekjybdiulzmssalfo' ||
      targets.runtime.category !== 'dev' || targets.migration.category !== 'dev' ||
      targets.runtime.identity !== expectedIdentity || targets.migration.identity !== expectedIdentity) {
    throw new Error('FIXTURE_DATABASE_TARGET_REFUSED');
  }

  const storageUrl = process.env.SUPABASE_URL ? new URL(process.env.SUPABASE_URL) : null;
  if (process.env.SUPABASE_PROJECT_REF !== DEV_PROJECT || storageUrl?.hostname !== `${DEV_PROJECT}.supabase.co` ||
      (process.env.PRODUCT_MEDIA_BUCKET ?? 'product-media') !== 'product-media') {
    throw new Error('FIXTURE_STORAGE_TARGET_REFUSED');
  }
}

async function assertReadyDevDatabase() {
  // The shared Prisma adapter enforces TLS with rejectUnauthorized=true; pg_stat_ssl reports the
  // Postgres-side connection behind Supavisor and is not a reliable client-to-pooler TLS check.
  const [identity, migrationCount, active, baseCount] = await Promise.all([
    prisma.$queryRaw<{ database: string; publicSchema: boolean; aiSchema: boolean;
      heartbeatTable: boolean }[]>`
      SELECT current_database()::text AS database,
        to_regnamespace('public') IS NOT NULL AS "publicSchema",
        to_regnamespace('ai') IS NOT NULL AS "aiSchema",
        to_regclass('ai.media_worker_heartbeats') IS NOT NULL AS "heartbeatTable"`,
    prisma.$queryRaw<{ count: number }[]>`
      SELECT count(*)::int AS count FROM public._prisma_migrations WHERE finished_at IS NOT NULL`,
    prisma.$queryRaw<{ embedding_version: string }[]>`
      SELECT embedding_version FROM ai.active_index WHERE singleton = true`,
    prisma.$queryRaw<{ count: number }[]>`
      SELECT count(*)::int AS count FROM ai.product_image_embeddings
      WHERE embedding_version = ${EXPECTED_ACTIVE_VERSION}`,
  ]);
  const database = identity[0];
  const failures: string[] = [];
  if (database?.database !== 'postgres') failures.push('DATABASE_IDENTITY');
  if (!database?.publicSchema) failures.push('PUBLIC_SCHEMA');
  if (!database?.aiSchema) failures.push('AI_SCHEMA');
  if (!database?.heartbeatTable) failures.push('HEARTBEAT_TABLE');
  if (migrationCount[0]?.count !== EXPECTED_MIGRATION_COUNT) failures.push(`MIGRATIONS_${migrationCount[0]?.count ?? 'MISSING'}`);
  if (active[0]?.embedding_version !== EXPECTED_ACTIVE_VERSION) failures.push('ACTIVE_MODEL');
  if (failures.length) throw new Error(`FIXTURE_DEV_PREFLIGHT_FAILED:${failures.join('_')}`);
  return { activeVersion: active[0].embedding_version, baseVectorCount: baseCount[0]?.count ?? 0 };
}

async function createFixture() {
  if (process.argv[2] !== 'create' || process.argv.length !== 3) {
    throw new Error('USAGE: node --import tsx scripts/product-media-dev-fixture.ts create');
  }
  assertExactDevTarget();
  const baseline = await assertReadyDevDatabase();
  const runId = randomUUID();
  const suffix = runId.slice(0, 8);
  const productName = `Wireless Headphones — Task 04.3 DEV Search QA ${suffix}`;
  const slug = `task-04-3-dev-search-headphones-${suffix}`;
  const sku = `EH-T043-DEV-${suffix.toUpperCase()}`;
  const category = await prisma.category.findUnique({ where: { slug: 'headphones' },
    select: { id: true, name: true, slug: true, isActive: true } });
  if (!category?.isActive) throw new Error('FIXTURE_HEADPHONES_CATEGORY_UNAVAILABLE');

  const created = await prisma.$transaction(async tx => {
    const product = await tx.product.create({ data: {
      categoryId: category.id,
      brandId: null,
      name: productName,
      slug,
      sku,
      description: `Temporary owner-authorized DEV image-search QA product; run ${runId}. Do not purchase.`,
      price: new Prisma.Decimal('1.00'),
      status: ProductStatus.ACTIVE,
      isTestFixture: false,
      storefrontVisible: true,
      inventory: { create: { quantity: 0, lowStockAt: 1, status: InventoryStatus.OUT_OF_STOCK } },
    }, select: { id: true, name: true, slug: true, sku: true, status: true, isTestFixture: true,
      storefrontVisible: true, categoryId: true, inventory: { select: { quantity: true, status: true } } } });
    return { category, product };
  }, { maxWait: 10_000, timeout: 30_000 });

  const after = await assertReadyDevDatabase();
  if (after.activeVersion !== baseline.activeVersion || after.baseVectorCount !== baseline.baseVectorCount) {
    throw new Error('FIXTURE_UNEXPECTEDLY_CHANGED_ACTIVE_INDEX');
  }
  console.log(JSON.stringify({ target: `supabase:${DEV_PROJECT}/postgres`, runId,
    category: created.category, product: created.product,
    activeEmbeddingVersion: after.activeVersion, baseVectorCountBefore: baseline.baseVectorCount,
    baseVectorCountAfter: after.baseVectorCount }));
}

async function reclassifyFixture() {
  if (process.argv[2] !== 'reclassify-headphones' || process.argv.length !== 5 ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(process.argv[3] ?? '') ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(process.argv[4] ?? '')) {
    throw new Error('USAGE: node --import tsx scripts/product-media-dev-fixture.ts reclassify-headphones <runId> <productId>');
  }
  assertExactDevTarget();
  const baseline = await assertReadyDevDatabase();
  const runId = process.argv[3].toLowerCase();
  const productId = process.argv[4].toLowerCase();
  const suffix = runId.slice(0, 8);
  const sku = `EH-T043-DEV-${suffix.toUpperCase()}`;
  const name = `Wireless Headphones — Task 04.3 DEV Search QA ${suffix}`;
  const [temporaryCategory, category] = await Promise.all([
    prisma.category.findUnique({ where: { slug: `task-04-3-dev-qa-headphones-${suffix}` }, select: { id: true, slug: true } }),
    prisma.category.findUnique({ where: { slug: 'headphones' }, select: { id: true, slug: true, isActive: true } }),
  ]);
  if (!temporaryCategory || !category?.isActive || temporaryCategory.id === category.id) {
    throw new Error('FIXTURE_CATEGORY_IDENTITY_REFUSED');
  }
  const current = await prisma.product.findFirst({ where: { id: productId, sku, name, categoryId: temporaryCategory.id,
    status: ProductStatus.ACTIVE, isTestFixture: false, storefrontVisible: true }, select: { id: true } });
  if (!current) throw new Error('FIXTURE_PRODUCT_IDENTITY_REFUSED');
  const updated = await prisma.$transaction(async tx => {
    const result = await tx.product.updateMany({ where: { id: current.id, sku, categoryId: temporaryCategory.id,
      status: ProductStatus.ACTIVE, isTestFixture: false, storefrontVisible: true }, data: { categoryId: category.id } });
    if (result.count !== 1) throw new Error('FIXTURE_PRODUCT_CHANGED_DURING_RECLASSIFICATION');
    return tx.product.findUnique({ where: { id: current.id }, select: { id: true, name: true, sku: true,
      category: { select: { slug: true } }, status: true, isTestFixture: true, storefrontVisible: true } });
  }, { maxWait: 10_000, timeout: 30_000 });
  const after = await assertReadyDevDatabase();
  if (after.activeVersion !== baseline.activeVersion || after.baseVectorCount !== baseline.baseVectorCount ||
      updated?.category.slug !== 'headphones') throw new Error('FIXTURE_RECLASSIFICATION_POSTCONDITION_FAILED');
  console.log(JSON.stringify({ target: `supabase:${DEV_PROJECT}/postgres`, runId, product: updated,
    activeEmbeddingVersion: after.activeVersion, baseVectorCountBefore: baseline.baseVectorCount,
    baseVectorCountAfter: after.baseVectorCount }));
}

async function cleanupEmptyCategory() {
  if (process.argv[2] !== 'cleanup-empty-category' || process.argv.length !== 4 ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(process.argv[3] ?? '')) {
    throw new Error('USAGE: node --import tsx scripts/product-media-dev-fixture.ts cleanup-empty-category <runId>');
  }
  assertExactDevTarget();
  const baseline = await assertReadyDevDatabase();
  const runId = process.argv[3].toLowerCase();
  const suffix = runId.slice(0, 8);
  const slug = `task-04-3-dev-qa-headphones-${suffix}`;
  const name = `Headphones — Task 04.3 DEV QA ${suffix}`;
  const result = await prisma.$transaction(async tx => {
    const category = await tx.category.findUnique({ where: { slug }, select: { id: true, slug: true, name: true, description: true } });
    if (!category) return { removed: false, slug };
    if (category.name !== name || category.description !== `Temporary owner-authorized DEV image-search QA category; run ${runId}.`) {
      throw new Error('FIXTURE_CATEGORY_IDENTITY_REFUSED');
    }
    if (await tx.product.count({ where: { categoryId: category.id } }) !== 0) {
      throw new Error('FIXTURE_CATEGORY_NOT_EMPTY');
    }
    const deleted = await tx.category.deleteMany({ where: { id: category.id, slug, name, description: category.description } });
    if (deleted.count !== 1) throw new Error('FIXTURE_CATEGORY_CHANGED_DURING_CLEANUP');
    return { removed: true, slug };
  }, { maxWait: 10_000, timeout: 30_000 });
  const after = await assertReadyDevDatabase();
  if (after.activeVersion !== baseline.activeVersion || after.baseVectorCount !== baseline.baseVectorCount) {
    throw new Error('FIXTURE_CLEANUP_CHANGED_ACTIVE_INDEX');
  }
  console.log(JSON.stringify({ target: `supabase:${DEV_PROJECT}/postgres`, runId, category: result,
    activeEmbeddingVersion: after.activeVersion, baseVectorCountBefore: baseline.baseVectorCount,
    baseVectorCountAfter: after.baseVectorCount }));
}

const task = process.argv[2] === 'create' ? createFixture() :
  process.argv[2] === 'reclassify-headphones' ? reclassifyFixture() :
  process.argv[2] === 'cleanup-empty-category' ? cleanupEmptyCategory() : Promise.reject(new Error('FIXTURE_COMMAND_INVALID'));
task.catch(error => {
  const code = error instanceof Error && /^[A-Z0-9_:-]{1,80}$/.test(error.message) ? error.message : 'FIXTURE_CREATION_FAILED';
  const diagnostic = error && typeof error === 'object' && 'code' in error &&
    typeof error.code === 'string' && /^[A-Z0-9_:-]{1,40}$/.test(error.code) ? error.code :
    error instanceof Error && /^[A-Za-z0-9]{1,50}$/.test(error.name) ? error.name : 'UNKNOWN';
  console.error(code === 'FIXTURE_CREATION_FAILED' ? `${code}:${diagnostic}` : code);
  process.exitCode = 1;
}).finally(async () => prisma.$disconnect());
