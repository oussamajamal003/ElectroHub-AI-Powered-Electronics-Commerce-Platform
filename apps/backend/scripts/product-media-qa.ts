import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import sharp from 'sharp';
import { prisma } from '../src/lib/prisma.js';
import { ProductMediaService } from '../src/services/product-media.service.js';
import { ProductService } from '../src/services/product.service.js';
import type { ImmutableProductMediaInput } from '../src/integrations/storage/product-media.storage.js';

async function main() {
  const identity = await prisma.$queryRaw<{ database: string; port: number; ssl: boolean }[]>`
    SELECT current_database()::text AS database,inet_server_port() AS port,ssl FROM pg_stat_ssl WHERE pid=pg_backend_pid()`;
  assert.match(process.env.PRODUCT_MEDIA_QA_RUN ?? '', /^electrohub_disposable_media_[a-f0-9]{10}$/);
  assert.equal(identity[0]?.database, process.env.PRODUCT_MEDIA_QA_RUN);
  assert.equal(identity[0]?.port, 55434); assert.equal(identity[0]?.ssl, true);
  const role = await prisma.role.create({ data: { name: 'ADMIN' } });
  const actor = await prisma.user.create({ data: { roleId: role.id, email: 'media-admin@qa.invalid', firstName: 'Media', lastName: 'QA' } });
  const category = await prisma.category.create({ data: { name: 'Media QA', slug: 'media-qa' } });
  const product = await prisma.product.create({ data: { name: 'Media QA product', slug: 'media-qa', sku: 'MEDIA-QA', price: 10, categoryId: category.id } });
  const other = await prisma.product.create({ data: { name: 'Other media QA', slug: 'media-qa-other', sku: 'MEDIA-QA-2', price: 10, categoryId: category.id } });
  let storageFails = false;
  const stored: ImmutableProductMediaInput[] = [];
  const service = new ProductMediaService(prisma, () => ({
    async uploadImmutable(input: ImmutableProductMediaInput) {
      if (storageFails) throw new Error('QA_STORAGE_FAILURE');
      stored.push(input);
      const path = `products/${input.productId}/${input.imageId}/${input.revision}/original.webp`;
      return { bucket: 'product-media', path, url: `https://qa.invalid/${path}` };
    },
  }));
  const bytes = await sharp({ create: { width: 256, height: 256, channels: 3, background: '#2563eb' } }).png().toBuffer();
  const upload = (key = randomUUID()) => service.upload({ actorId: actor.id, productId: product.id, key, bytes, mime: 'image/png' });
  const key = randomUUID(); const first = await upload(key); const replay = await upload(key);
  assert.equal(replay.id, first.id); assert.equal(stored.length, 1);
  assert.equal(await prisma.catalogMediaEvent.count(), 1);
  await assert.rejects(service.patch(actor.id, other.id, first.id, first.updatedAt, { altText: 'Cross product' }), /Image not found/);
  await assert.rejects(service.patch(actor.id, product.id, first.id, '2020-01-01T00:00:00.000Z', { altText: 'Stale' }), /changed/);
  storageFails = true; await assert.rejects(upload(), /QA_STORAGE_FAILURE/); storageFails = false;
  assert.equal(await prisma.productImage.count(), 1); assert.equal(await prisma.catalogMediaEvent.count(), 1);

  // Real rollback: a DB trigger refuses the outbox insert after the image insert; neither may commit.
  await prisma.$executeRawUnsafe(`CREATE FUNCTION public.media_qa_fail_event() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'QA_OUTBOX_FAILURE'; END $$`);
  await prisma.$executeRawUnsafe('CREATE TRIGGER media_qa_fail_event BEFORE INSERT ON catalog_media_events FOR EACH ROW EXECUTE FUNCTION public.media_qa_fail_event()');
  await assert.rejects(upload());
  assert.equal(await prisma.productImage.count(), 1); assert.equal(await prisma.catalogMediaEvent.count(), 1);
  await prisma.$executeRawUnsafe('DROP TRIGGER media_qa_fail_event ON catalog_media_events');
  await prisma.$executeRawUnsafe('DROP FUNCTION public.media_qa_fail_event()');
  console.log('PASS actual PostgreSQL outbox rollback, duplicate replay, ownership/CAS and Storage-failure isolation (Storage is a double)');

  const second = await upload();
  const primaries = await Promise.allSettled([service.patch(actor.id, product.id, first.id, first.updatedAt, { isPrimary: true }),
    service.patch(actor.id, product.id, second.id, second.updatedAt, { isPrimary: true })]);
  assert.ok(primaries.some(result => result.status === 'fulfilled'));
  assert.equal(await prisma.productImage.count({ where: { productId: product.id, isPrimary: true, mediaState: 'PUBLISHED' } }), 1);
  const current = (await service.list(product.id)).find(image => image.id === first.id)!;
  const replacements = await Promise.allSettled([1, 2].map(() => service.upload({ actorId: actor.id, productId: product.id,
    imageId: first.id, expected: current.updatedAt, key: randomUUID(), bytes, mime: 'image/png' })));
  assert.equal(replacements.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(replacements.filter(result => result.status === 'rejected').length, 1);
  const changed = (await service.list(product.id)).find(image => image.id === first.id)!;
  assert.notEqual(changed.url, first.url); assert.notEqual(changed.sourceRevision, first.sourceRevision);
  await service.retire(actor.id, product.id, first.id, changed.updatedAt);
  assert.equal(await prisma.productImage.count(), 2); // tombstone retained
  assert.equal((await new ProductService().detail('media-qa')).images.length, 1);
  const third = await upload();
  const futureTimestamp = new Date(Date.now() + 60_000);
  await prisma.productImage.update({ where: { id: second.id }, data: { updatedAt: futureTimestamp } });
  await service.patch(actor.id, product.id, third.id, third.updatedAt, { isPrimary: true });
  const formerPrimary = await prisma.productImage.findUniqueOrThrow({ where: { id: second.id } });
  assert.ok(formerPrimary.updatedAt > futureTimestamp, 'Clearing another primary must advance its revision despite clock skew');
  let currentThird = (await service.list(product.id)).find(image => image.id === third.id)!;
  await service.patch(actor.id, product.id, third.id, currentThird.updatedAt, { sortOrder: 1 });
  const reorderedSecond = await prisma.productImage.findUniqueOrThrow({ where: { id: second.id } });
  assert.ok(reorderedSecond.updatedAt > formerPrimary.updatedAt, 'Reordering another image must advance its revision');
  currentThird = (await service.list(product.id)).find(image => image.id === third.id)!;
  await service.retire(actor.id, product.id, third.id, currentThird.updatedAt);
  const successor = await prisma.productImage.findUniqueOrThrow({ where: { id: second.id } });
  assert.ok(successor.updatedAt > reorderedSecond.updatedAt, 'Selecting a primary successor must advance its revision');
  console.log('PASS monotonic revisions for former primary, reordered peers and retirement successor under clock skew');
  await prisma.user.update({ where: { id: actor.id }, data: { isActive: false } });
  await assert.rejects(upload(), /Administrator access/);
  console.log('PASS concurrent primary invariant, concurrent replacement CAS, immutable URL, storefront retirement and revoked admin');
}
main().catch(error => { console.error(error instanceof Error ? error.message : 'MEDIA_QA_FAILURE'); process.exitCode = 1; })
  .finally(async () => prisma.$disconnect());
