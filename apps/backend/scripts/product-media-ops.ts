import { randomUUID, createHash } from 'node:crypto';
import { prisma } from '../src/lib/prisma.js';
import { env } from '../src/config/env.js';
import { describeDatabaseTarget } from '../src/lib/database-target.js';
import { SupabaseProductMediaStorage, resolveProductMediaStorageConfig } from '../src/integrations/storage/product-media.storage.js';
import { listProductMediaTreeBounded, reconcileProductMedia } from '../src/integrations/storage/product-media.reconciliation.js';

async function main() {
  const target = describeDatabaseTarget(env.DATABASE_URL);
  const command = process.argv[2];
  if (!['status', 'reconcile', 'retry'].includes(command)) throw new Error('Usage: product-media-ops.ts status|reconcile|retry <event-uuid>');
  const identity = await prisma.$queryRaw<{ database: string }[]>`SELECT current_database()::text AS database`;
  if ((target.category === 'dev' || target.category === 'production') && identity[0]?.database !== 'postgres') throw new Error('Database identity disagrees with configured target.');
  if (command === 'retry') {
    if (target.category === 'production') throw new Error('PROD event mutation is outside this command. Use the reviewed release procedure.');
    const eventId = process.argv[3] ?? '';
    if (!/^[a-f0-9-]{36}$/i.test(eventId) || process.env.PRODUCT_MEDIA_OPERATOR_TARGET !== target.identity) throw new Error('Retry requires an exact event UUID and PRODUCT_MEDIA_OPERATOR_TARGET identity.');
    await prisma.$transaction(async tx => {
      const event = await tx.catalogMediaEvent.findUniqueOrThrow({ where: { id: eventId } });
      await tx.$queryRaw`SELECT id FROM products WHERE id = ${event.productId}::uuid FOR UPDATE`;
      await tx.$queryRaw`SELECT id FROM catalog_media_events WHERE id = ${eventId}::uuid FOR UPDATE`;
      const latest = await tx.catalogMediaEvent.findUniqueOrThrow({ where: { id: eventId } });
      const image = await tx.productImage.findFirst({ where: { id: event.productImageId, productId: event.productId, mediaState: 'PUBLISHED',
        sourceRevision: event.sourceRevision, sourceSha256: event.sourceSha256 } });
      if (!image || !['RETRY_WAIT', 'PERMANENT_FAILURE'].includes(latest.state)) throw new Error('Event is no longer eligible for retry.');
      await tx.catalogMediaEvent.update({ where: { id: eventId }, data: { state: 'READY', attemptCount: 0,
        nextAttemptAt: new Date(), completedAt: null, claimedUntil: null, leaseToken: null, lastErrorCode: null } });
    });
    console.log(JSON.stringify({ target: target.identity, retriedEvent: eventId })); return;
  }
  const [counts, lag, active] = await Promise.all([
    prisma.catalogMediaEvent.groupBy({ by: ['state'], _count: { _all: true } }),
    prisma.$queryRaw<{ oldestPendingSeconds: number | null }[]>`SELECT EXTRACT(EPOCH FROM (now()-min("createdAt")))::int AS "oldestPendingSeconds"
      FROM catalog_media_events WHERE state IN ('READY','CLAIMED','RETRY_WAIT')`,
    prisma.$queryRaw<{ embedding_version: string }[]>`SELECT embedding_version FROM ai.active_index WHERE singleton`,
  ]);
  console.log(JSON.stringify({ target: target.identity, activeVersion: active[0]?.embedding_version ?? null,
    counts: counts.map(row => ({ state: row.state, count: row._count._all })), oldestPendingSeconds: lag[0]?.oldestPendingSeconds ?? null }));
  if (command === 'status') return;
  const config = resolveProductMediaStorageConfig(process.env);
  if (!config || !target.identity.includes(config.projectRef)) throw new Error('Storage/database identity mismatch.');
  const adapter = new SupabaseProductMediaStorage(config);
  const objects = await listProductMediaTreeBounded((prefix, limit, offset) => adapter.listBounded(prefix, limit, offset));
  const [images, events, orders] = await prisma.$transaction([
    prisma.productImage.findMany({ where: { storageProvider: 'SUPABASE_STORAGE' }, take: 10001,
      select: { storagePath: true, mediaState: true } }),
    prisma.catalogMediaEvent.findMany({ take: 10001, select: { productId: true, productImageId: true, sourceRevision: true } }),
    prisma.orderItem.findMany({ where: { productImageUrl: { startsWith: `${config.supabaseUrl.origin}/storage/v1/object/public/product-media/` } },
      take: 10001, select: { productImageUrl: true } }),
  ]);
  if ([images.length, events.length, orders.length].some(count => count > 10000)) throw new Error('Reference inventory exceeds safety bound; no complete report or deletion produced.');
  const currentReferences = images.filter(image => image.mediaState === 'PUBLISHED').flatMap(image => image.storagePath ? [image.storagePath] : []);
  const currentPaths = new Set(currentReferences);
  const report = reconcileProductMedia({ objects,
    currentReferences,
    retiredReferences: [...images.filter(image => image.mediaState === 'RETIRED').flatMap(image => image.storagePath ? [image.storagePath] : []),
      ...events.flatMap(event => event.sourceRevision ? [`products/${event.productId}/${event.productImageId}/${event.sourceRevision}/original.webp`] : [])
        .filter(path => !currentPaths.has(path))],
    historicalOrderImageUrls: orders.flatMap(order => order.productImageUrl ? [order.productImageUrl] : []),
    supabaseUrl: config.supabaseUrl, bucket: 'product-media' });
  console.log(JSON.stringify({ dryRun: true, ...report, deletionPerformed: false,
    reportIdentity: createHash('sha256').update(JSON.stringify(report)).digest('hex'), runId: randomUUID() }));
}
main().catch(() => { console.error('Media operation refused or failed; inspect safe server diagnostics and the runbook.'); process.exitCode = 1; })
  .finally(async () => prisma.$disconnect());
