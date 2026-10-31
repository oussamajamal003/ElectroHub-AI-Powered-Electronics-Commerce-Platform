/**
 * Task 04.5 real-PostgreSQL acceptance (DISPOSABLE only; launched by scripts/delivery-pg.cjs, skipped everywhere else).
 * Every repository migration up to 20261031000000_delivery_tracking is applied before this runs. IDs map to architecture §11 T5-xx.
 */
import { Prisma } from '@prisma/client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deliveryFixtures } from './helpers/delivery-fixtures.js';

const enabled = process.env.DELIVERY_PG_RUN === '1';
// Loaded only inside the disposable runner: elsewhere the database client refuses non-disposable targets and this suite skips.
let prisma: typeof import('../../lib/prisma.js').prisma;
let service: InstanceType<typeof import('../delivery.service.js').DeliveryService>;
let AccountDeletionService: typeof import('../account-deletion.service.js').AccountDeletionService;
const fixtures = deliveryFixtures('svc');
const soon = (hours: number) => new Date(Date.now() + hours * 3_600_000).toISOString();
const code = async (promise: Promise<unknown>) => promise.then(() => 'OK', (error: { code?: string }) => error.code ?? String(error));
const events = (deliveryId: string) => prisma.deliveryEvent.findMany({ where: { deliveryId }, orderBy: { revision: 'asc' } });
const outbox = (orderId: string) => prisma.commerceEmailOutbox.count({ where: { orderId } });
async function mirror(orderId: string) {
  const order = await prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { delivery: true } });
  return { order: order.status, delivery: order.delivery?.status ?? null, revision: order.delivery?.revision ?? null };
}

describe.skipIf(!enabled).sequential('Task 04.5 DeliveryService on real PostgreSQL', () => {
  let admin: { id: string };
  let customer: { id: string };

  beforeAll(async () => {
    ({ prisma } = await import('../../lib/prisma.js'));
    service = new (await import('../delivery.service.js')).DeliveryService();
    ({ AccountDeletionService } = await import('../account-deletion.service.js'));
    admin = await fixtures.user('ADMIN', 'admin');
    customer = await fixtures.user('CUSTOMER', 'customer');
  });
  afterAll(async () => {
    expect(await fixtures.cleanup()).toBe(0);
    await prisma.$disconnect();
  });

  it('T5-18 migration: CHECK and unique constraints are active and existing orders gain no delivery rows', async () => {
    const order = await fixtures.order(customer.id, 'CONFIRMED', 'SUCCEEDED');
    expect(await prisma.delivery.count({ where: { orderId: order.id } })).toBe(0);
    const row = await prisma.delivery.create({ data: { orderId: order.id, status: 'CONFIRMED' } });
    expect(row.revision).toBe(0);
    expect(row.isSimulated).toBe(false);
    const violates = (sql: Prisma.Sql) => prisma.$executeRaw(sql).then(() => 'accepted', (error: Error) => error.message);
    expect(await violates(Prisma.sql`UPDATE deliveries SET latitude = 91, longitude = 0 WHERE id = ${row.id}::uuid`)).toMatch(/deliveries_coordinates_range_check/);
    expect(await violates(Prisma.sql`UPDATE deliveries SET latitude = 10 WHERE id = ${row.id}::uuid`)).toMatch(/deliveries_coordinates_pair_check/);
    expect(await violates(Prisma.sql`UPDATE deliveries SET revision = -1 WHERE id = ${row.id}::uuid`)).toMatch(/deliveries_revision_nonnegative_check/);
    expect(await violates(Prisma.sql`INSERT INTO delivery_events (id, "deliveryId", revision, type, source) VALUES (gen_random_uuid(), ${row.id}::uuid, 0, 'TRACKING_STARTED', 'ADMIN')`))
      .toMatch(/delivery_events_revision_positive_check/);
    await prisma.$executeRaw`INSERT INTO delivery_events (id, "deliveryId", revision, type, source) VALUES (gen_random_uuid(), ${row.id}::uuid, 1, 'TRACKING_STARTED', 'ADMIN')`;
    expect(await violates(Prisma.sql`INSERT INTO delivery_events (id, "deliveryId", revision, type, source) VALUES (gen_random_uuid(), ${row.id}::uuid, 1, 'TRACKING_STARTED', 'ADMIN')`))
      .toMatch(/delivery_events_deliveryId_revision_key|unique/i);
    expect(await violates(Prisma.sql`INSERT INTO delivery_events (id, "deliveryId", revision, type, source, latitude, longitude) VALUES (gen_random_uuid(), ${row.id}::uuid, 2, 'LOCATION_UPDATED', 'ADMIN', 0, 535)`))
      .toMatch(/delivery_events_coordinates_range_check/);
    await prisma.delivery.delete({ where: { id: row.id } });
    expect(await prisma.deliveryEvent.count({ where: { deliveryId: row.id } })).toBe(0);
  });

  it('T5-02 / T5-01 paid order: NOT_STARTED, then Start creates one delivery at revision 1 with exactly one event (idempotent)', async () => {
    const order = await fixtures.order(customer.id, 'CONFIRMED', 'SUCCEEDED');
    const before = await service.getCustomerSnapshot(customer.id, order.reference);
    expect(before).toMatchObject({ availability: 'NOT_STARTED', revision: 0, trackingReference: null, timeline: [], location: null });
    const first = await service.start(admin.id, order.reference);
    const again = await service.start(admin.id, order.reference);
    expect([first.created, again.created]).toEqual([true, false]);
    expect(first.snapshot.trackingReference).toMatch(/^EH-TRK-[0-9A-HJKMNP-TV-Z]{10}$/);
    expect(again.snapshot.trackingReference).toBe(first.snapshot.trackingReference);
    const after = await service.getCustomerSnapshot(customer.id, order.reference);
    expect(after).toMatchObject({ availability: 'AVAILABLE', status: 'CONFIRMED', revision: 1, paymentState: 'PAID' });
    expect(after.timeline).toEqual([expect.objectContaining({ type: 'TRACKING_STARTED', status: 'CONFIRMED' })]);
    expect(await prisma.delivery.count({ where: { orderId: order.id } })).toBe(1);
    expect(await mirror(order.id)).toEqual({ order: 'CONFIRMED', delivery: 'CONFIRMED', revision: 1 });
  });

  it('T5-03 / T5-04 legacy-unpaid, pending and awaiting-capture orders read PAYMENT_PENDING and can never be started or advanced', async () => {
    for (const [status, payment] of [['CONFIRMED', null], ['CONFIRMED', 'PENDING'], ['CONFIRMED', 'FAILED'], ['AWAITING_CAPTURE', 'PROCESSING']] as const) {
      const order = await fixtures.order(customer.id, status, payment);
      expect((await service.getCustomerSnapshot(customer.id, order.reference)).availability).toBe('PAYMENT_PENDING');
      expect(await code(service.start(admin.id, order.reference))).toBe('DELIVERY_PAYMENT_INELIGIBLE');
      expect(await code(service.applyUpdate(admin.id, order.reference, { expectedRevision: 1, status: 'PREPARING' }))).toBe('DELIVERY_PAYMENT_INELIGIBLE');
      expect(await prisma.delivery.count({ where: { orderId: order.id } })).toBe(0);
      expect((await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).status).toBe(status);
    }
  });

  it('T5-07 / AC2 full progression mirrors Order.status, writes one event per revision and one outbox row per genuine transition', async () => {
    const order = await fixtures.order(customer.id, 'CONFIRMED', 'SUCCEEDED');
    const payment = await prisma.payment.findUniqueOrThrow({ where: { orderId: order.id } });
    await service.start(admin.id, order.reference);
    expect(await outbox(order.id)).toBe(0);

    await service.applyUpdate(admin.id, order.reference, { expectedRevision: 1, status: 'PREPARING', estimatedAt: soon(30) });
    expect(await mirror(order.id)).toEqual({ order: 'PREPARING', delivery: 'PREPARING', revision: 2 });
    expect(await outbox(order.id)).toBe(1);

    const out = await service.applyUpdate(admin.id, order.reference, { expectedRevision: 2, status: 'OUT_FOR_DELIVERY',
      location: { latitude: 33.8938, longitude: 35.5018, label: 'Beirut sorting hub' }, estimatedAt: soon(4), note: 'Loaded on van 3' });
    expect(out.changed).toBe(true);
    expect(await mirror(order.id)).toEqual({ order: 'OUT_FOR_DELIVERY', delivery: 'OUT_FOR_DELIVERY', revision: 3 });
    expect(await outbox(order.id)).toBe(2);
    const rows = await events((await prisma.delivery.findUniqueOrThrow({ where: { orderId: order.id } })).id);
    expect(rows.map(row => [row.revision, row.type])).toEqual([[1, 'TRACKING_STARTED'], [2, 'STATUS_CHANGED'], [3, 'STATUS_CHANGED']]);
    expect(rows[2]).toMatchObject({ changes: ['STATUS', 'LOCATION', 'ETA'], fromStatus: 'PREPARING', toStatus: 'OUT_FOR_DELIVERY', source: 'ADMIN',
      actorUserId: admin.id, note: 'Loaded on van 3' });
    expect(Number(rows[2]!.latitude)).toBe(33.8938);

    const customerView = await service.getCustomerSnapshot(customer.id, order.reference);
    expect(customerView.location).toMatchObject({ label: 'Beirut sorting hub', source: 'MANUAL' });
    expect(customerView.timeline.map(entry => entry.type)).toEqual(['STATUS_CHANGED', 'ETA_UPDATED', 'STATUS_CHANGED', 'ETA_UPDATED', 'TRACKING_STARTED']);

    await service.applyUpdate(admin.id, order.reference, { expectedRevision: 3, status: 'DELIVERED' });
    const delivered = await prisma.delivery.findUniqueOrThrow({ where: { orderId: order.id } });
    expect(await mirror(order.id)).toEqual({ order: 'DELIVERED', delivery: 'DELIVERED', revision: 4 });
    expect(delivered.deliveredAt).toBeInstanceOf(Date);
    expect(await outbox(order.id)).toBe(3);
    const final = await service.getCustomerSnapshot(customer.id, order.reference);
    expect(final).toMatchObject({ status: 'DELIVERED', location: null, eta: expect.objectContaining({ estimatedAt: null }) });
    expect(final.deliveredAt).toBe(delivered.deliveredAt!.toISOString());

    // §4.4 commerce integrity: payment row untouched by every delivery write.
    expect(await prisma.payment.findUniqueOrThrow({ where: { orderId: order.id } })).toEqual(payment);

    // T5-06 delivered is terminal.
    expect(await code(service.applyUpdate(admin.id, order.reference, { expectedRevision: 4, estimatedAt: soon(1) }))).toBe('DELIVERY_TERMINAL');
    expect(await code(service.applyUpdate(admin.id, order.reference, { expectedRevision: 4, status: 'DELIVERED' }))).toBe('DELIVERY_TERMINAL');
    expect((await prisma.delivery.findUniqueOrThrow({ where: { orderId: order.id } })).revision).toBe(4);
  });

  it('T5-08 / T5-14 / no-op: skips and backward moves are rejected, location before dispatch is refused, a no-op writes nothing', async () => {
    const order = await fixtures.order(customer.id, 'CONFIRMED', 'SUCCEEDED');
    await service.start(admin.id, order.reference);
    expect(await code(service.applyUpdate(admin.id, order.reference, { expectedRevision: 1, status: 'OUT_FOR_DELIVERY' }))).toBe('ORDER_TRANSITION_INVALID');
    expect(await code(service.applyUpdate(admin.id, order.reference, { expectedRevision: 1, status: 'DELIVERED' }))).toBe('ORDER_TRANSITION_INVALID');
    await service.applyUpdate(admin.id, order.reference, { expectedRevision: 1, status: 'PREPARING' });
    expect(await code(service.applyUpdate(admin.id, order.reference, { expectedRevision: 2, location: { latitude: 1, longitude: 1 } })))
      .toBe('DELIVERY_LOCATION_NOT_ALLOWED');
    const noop = await service.applyUpdate(admin.id, order.reference, { expectedRevision: 2, status: 'PREPARING', location: null, estimatedAt: null });
    expect(noop.changed).toBe(false);
    expect(await mirror(order.id)).toEqual({ order: 'PREPARING', delivery: 'PREPARING', revision: 2 });
    expect(await prisma.deliveryEvent.count({ where: { delivery: { orderId: order.id } } })).toBe(2);
    expect(await outbox(order.id)).toBe(1);
  });

  it('T5-09 / T5-10 concurrent PATCHes at one revision: exactly one wins, one conflicts, one event; a replay conflicts', async () => {
    const order = await fixtures.order(customer.id, 'CONFIRMED', 'SUCCEEDED');
    await service.start(admin.id, order.reference);
    const results = await Promise.allSettled([
      service.applyUpdate(admin.id, order.reference, { expectedRevision: 1, status: 'PREPARING' }),
      service.applyUpdate(admin.id, order.reference, { expectedRevision: 1, estimatedAt: soon(10) }),
    ]);
    expect(results.filter(result => result.status === 'fulfilled')).toHaveLength(1);
    const rejected = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
    expect(rejected.map(result => result.reason.code)).toEqual(['DELIVERY_REVISION_CONFLICT']);
    expect((await prisma.delivery.findUniqueOrThrow({ where: { orderId: order.id } })).revision).toBe(2);
    expect(await prisma.deliveryEvent.count({ where: { delivery: { orderId: order.id } } })).toBe(2);
    expect(await code(service.applyUpdate(admin.id, order.reference, { expectedRevision: 1, status: 'PREPARING' }))).toBe('DELIVERY_REVISION_CONFLICT');
    expect(await prisma.deliveryEvent.count({ where: { delivery: { orderId: order.id } } })).toBe(2);
  });

  it('T5-15 ETA set and clear: ETA_CLEARED event, customer falls back to the checkout window', async () => {
    const order = await fixtures.order(customer.id, 'CONFIRMED', 'SUCCEEDED');
    await service.start(admin.id, order.reference);
    await service.applyUpdate(admin.id, order.reference, { expectedRevision: 1, estimatedAt: soon(20) });
    await service.applyUpdate(admin.id, order.reference, { expectedRevision: 2, estimatedAt: null });
    const rows = await events((await prisma.delivery.findUniqueOrThrow({ where: { orderId: order.id } })).id);
    expect(rows.map(row => row.type)).toEqual(['TRACKING_STARTED', 'ETA_UPDATED', 'ETA_CLEARED']);
    const view = await service.getCustomerSnapshot(customer.id, order.reference);
    expect(view.eta).toEqual(expect.objectContaining({ estimatedAt: null, promisedStart: '2026-11-04T00:00:00.000Z', promisedEnd: '2026-11-06T00:00:00.000Z' }));
    expect(view.timeline[0]).toMatchObject({ type: 'ETA_CLEARED', estimatedAt: null });
  });

  it('T5-16 timeline: at most 50 entries, newest first, and no LOCATION rows reach the customer', async () => {
    const order = await fixtures.order(customer.id, 'PREPARING', 'SUCCEEDED');
    await service.start(admin.id, order.reference);
    let revision = 1;
    await service.applyUpdate(admin.id, order.reference, { expectedRevision: revision++, status: 'OUT_FOR_DELIVERY' });
    for (let index = 0; index < 60; index++) {
      const update = index % 2 === 0 ? { location: { latitude: 10 + index / 100, longitude: 20 } } : { estimatedAt: soon(2 + index) };
      await service.applyUpdate(admin.id, order.reference, { expectedRevision: revision++, ...update });
    }
    const view = await service.getCustomerSnapshot(customer.id, order.reference);
    expect(view.revision).toBe(62);
    expect(view.timeline.length).toBeLessThanOrEqual(50);
    expect(view.timeline.every(entry => entry.type === 'ETA_UPDATED' || entry.type === 'STATUS_CHANGED' || entry.type === 'TRACKING_STARTED')).toBe(true);
    const times = view.timeline.map(entry => entry.occurredAt);
    expect([...times].sort().reverse()).toEqual(times);
  });

  it('T5-17 a failure after the status write rolls everything back: no status, revision, event or email outbox row', async () => {
    const order = await fixtures.order(customer.id, 'CONFIRMED', 'SUCCEEDED');
    await service.start(admin.id, order.reference);
    const delivery = await prisma.delivery.findUniqueOrThrow({ where: { orderId: order.id } });
    // Occupy revision 2 out of band so the event insert fails AFTER transitionFulfillment has already updated the order row.
    await prisma.$executeRaw`INSERT INTO delivery_events (id, "deliveryId", revision, type, source) VALUES (gen_random_uuid(), ${delivery.id}::uuid, 2, 'ETA_CLEARED', 'SYSTEM')`;
    expect(await code(service.applyUpdate(admin.id, order.reference, { expectedRevision: 1, status: 'PREPARING' }))).toBe('P2002');
    expect(await mirror(order.id)).toEqual({ order: 'CONFIRMED', delivery: 'CONFIRMED', revision: 1 });
    expect(await outbox(order.id)).toBe(0);
    expect(await prisma.deliveryEvent.count({ where: { deliveryId: delivery.id } })).toBe(2);
  });

  it('T5-05 cancelled after tracking: CANCELLED with recorded history kept, every write rejected', async () => {
    const order = await fixtures.order(customer.id, 'CONFIRMED', 'SUCCEEDED');
    await service.start(admin.id, order.reference);
    await service.applyUpdate(admin.id, order.reference, { expectedRevision: 1, status: 'PREPARING' });
    // Cancellation is owned by PaymentService.compensate; simulate its persisted outcome directly.
    await prisma.order.update({ where: { id: order.id }, data: { status: 'CANCELLED' } });
    await prisma.payment.update({ where: { orderId: order.id }, data: { status: 'REFUNDED', refundedAt: new Date() } });
    const view = await service.getCustomerSnapshot(customer.id, order.reference);
    expect(view).toMatchObject({ availability: 'CANCELLED', status: 'CANCELLED', location: null, trackingReference: null });
    expect(view.timeline.map(entry => entry.type)).toEqual(['STATUS_CHANGED', 'TRACKING_STARTED']);
    expect(await code(service.applyUpdate(admin.id, order.reference, { expectedRevision: 2, status: 'OUT_FOR_DELIVERY' }))).toBe('DELIVERY_ORDER_CANCELLED');
    expect(await code(service.start(admin.id, order.reference))).toBe('DELIVERY_ORDER_CANCELLED');
    expect((await prisma.delivery.findUniqueOrThrow({ where: { orderId: order.id } })).status).toBe('PREPARING');
  });

  it('historical paid order already out for delivery: Start mirrors the current status and fabricates no earlier milestones', async () => {
    const order = await fixtures.order(customer.id, 'OUT_FOR_DELIVERY', 'SUCCEEDED');
    await service.start(admin.id, order.reference);
    const rows = await events((await prisma.delivery.findUniqueOrThrow({ where: { orderId: order.id } })).id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ type: 'TRACKING_STARTED', toStatus: 'OUT_FOR_DELIVERY', fromStatus: null });
    expect(await mirror(order.id)).toEqual({ order: 'OUT_FOR_DELIVERY', delivery: 'OUT_FOR_DELIVERY', revision: 1 });
    expect(await outbox(order.id)).toBe(0);
  });

  it('PATCH before Start is DELIVERY_NOT_STARTED; unknown orders are ORDER_NOT_FOUND; other customers get the same 404', async () => {
    const order = await fixtures.order(customer.id, 'CONFIRMED', 'SUCCEEDED');
    const other = await fixtures.user('CUSTOMER', 'other');
    expect(await code(service.applyUpdate(admin.id, order.reference, { expectedRevision: 1, status: 'PREPARING' }))).toBe('DELIVERY_NOT_STARTED');
    expect(await code(service.getCustomerSnapshot(other.id, order.reference))).toBe('ORDER_NOT_FOUND');
    expect(await code(service.getCustomerSnapshot(customer.id, 'ORD-00000000-0000-4000-8000-000000000000'))).toBe('ORDER_NOT_FOUND');
    expect(await code(service.getCustomerSnapshot(customer.id, 'not-a-reference'))).toBe('ORDER_REFERENCE_INVALID');
  });

  it('T6-01 / T6-03 map: stored destination rounded, recorded path oldest-first and bounded, corrupt rows dropped, route hidden once delivered', async () => {
    const mapped = new (await import('../delivery.service.js')).DeliveryService(prisma, () => new Date(), () => ({ latitude: 33.9, longitude: 35.5, label: 'Hub' }));
    const order = await fixtures.order(customer.id, 'PREPARING', 'SUCCEEDED');
    await prisma.order.update({ where: { id: order.id }, data: { shippingLatitude: 33.871234, shippingLongitude: 35.509876 } });
    expect((await mapped.getCustomerSnapshot(customer.id, order.reference)).map).toBeNull();
    await service.start(admin.id, order.reference);
    const before = (await mapped.getCustomerSnapshot(customer.id, order.reference)).map;
    expect(before).toEqual({ origin: { latitude: 33.9, longitude: 35.5, label: 'Hub' }, destination: { latitude: 33.871, longitude: 35.51 }, path: [], pathKind: 'NONE' });
    let revision = 1;
    await service.applyUpdate(admin.id, order.reference, { expectedRevision: revision++, status: 'OUT_FOR_DELIVERY', location: { latitude: 33.89, longitude: 35.5 } });
    for (let index = 1; index <= 205; index++) {
      await service.applyUpdate(admin.id, order.reference, { expectedRevision: revision++, location: { latitude: 33.89 - index / 10000, longitude: 35.5 } });
    }
    await service.applyUpdate(admin.id, order.reference, { expectedRevision: revision++, estimatedAt: soon(3) });
    const view = await mapped.getCustomerSnapshot(customer.id, order.reference);
    expect(view.map!.pathKind).toBe('RECORDED');
    expect(view.map!.path).toHaveLength(200);
    expect(view.map!.path.at(-1)).toEqual([33.8695, 35.5]);
    expect(view.map!.path[0]).toEqual([33.8894, 35.5]);
    expect(view.map!.path).not.toContainEqual([33.9, 35.5]);
    // Clearing the live location also withdraws the recorded route.
    await service.applyUpdate(admin.id, order.reference, { expectedRevision: revision++, location: null });
    expect((await mapped.getCustomerSnapshot(customer.id, order.reference)).map).toMatchObject({ path: [], pathKind: 'NONE' });
    await service.applyUpdate(admin.id, order.reference, { expectedRevision: revision++, status: 'DELIVERED' });
    expect((await mapped.getCustomerSnapshot(customer.id, order.reference)).map).toMatchObject({ path: [], pathKind: 'NONE' });
    expect(await code(mapped.getCustomerSnapshot((await fixtures.user('CUSTOMER', 'mapper')).id, order.reference))).toBe('ORDER_NOT_FOUND');
  });

  it('T6-09 map: a simulated delivery reports SIMULATED_FIXTURE; a redacted owner has no destination or path', async () => {
    const mapped = new (await import('../delivery.service.js')).DeliveryService(prisma, () => new Date(), () => ({ latitude: 33.9, longitude: 35.5, label: 'Hub' }));
    const order = await fixtures.order(customer.id, 'PREPARING', 'SUCCEEDED');
    await service.start(admin.id, order.reference);
    await service.applyUpdate(admin.id, order.reference, { expectedRevision: 1, status: 'OUT_FOR_DELIVERY', location: { latitude: 33.88, longitude: 35.51 } });
    await prisma.delivery.update({ where: { orderId: order.id }, data: { isSimulated: true } });
    const deliveryId = (await prisma.delivery.findUniqueOrThrow({ where: { orderId: order.id } })).id;
    // The admin-recorded position is real data: it never appears on a simulated line.
    expect((await mapped.getCustomerSnapshot(customer.id, order.reference)).map).toMatchObject({ path: [], pathKind: 'NONE' });
    await prisma.deliveryEvent.updateMany({ where: { deliveryId, changes: { has: 'LOCATION' } }, data: { source: 'SIMULATION' } });
    expect((await mapped.getCustomerSnapshot(customer.id, order.reference)).map).toMatchObject({ path: [[33.88, 35.51]], pathKind: 'SIMULATED_FIXTURE' });
    await prisma.deliveryEvent.updateMany({ where: { deliveryId }, data: { latitude: null, longitude: null } });
    expect((await mapped.getCustomerSnapshot(customer.id, order.reference)).map).toMatchObject({ destination: null, path: [], pathKind: 'NONE' });
  });

  it('T5-20 account deletion nulls delivery coordinates, labels and event notes/coordinates for completed orders', async () => {
    const leaving = await fixtures.user('CUSTOMER', 'leaving');
    const order = await fixtures.order(leaving.id, 'PREPARING', 'SUCCEEDED');
    await service.start(admin.id, order.reference);
    await service.applyUpdate(admin.id, order.reference, { expectedRevision: 1, status: 'OUT_FOR_DELIVERY', location: { latitude: 33.9, longitude: 35.5, label: 'Near home' }, note: 'Gate code 1234' });
    await service.applyUpdate(admin.id, order.reference, { expectedRevision: 2, status: 'DELIVERED' });
    await new AccountDeletionService().deleteAccount(leaving.id);
    const delivery = await prisma.delivery.findUniqueOrThrow({ where: { orderId: order.id }, include: { events: true } });
    expect(delivery).toMatchObject({ latitude: null, longitude: null, locationLabel: null, locationSource: null, revision: 3 });
    expect(delivery.events).toHaveLength(3);
    expect(delivery.events.every(event => event.latitude === null && event.longitude === null && event.note === null)).toBe(true);
  });

  it('T5-20b account deletion scrubs a CANCELLED order whose Delivery still says OUT_FOR_DELIVERY, without touching revision, events or payment', async () => {
    const leaving = await fixtures.user('CUSTOMER', 'leaving-cancelled');
    const order = await fixtures.order(leaving.id, 'PREPARING', 'SUCCEEDED');
    await service.start(admin.id, order.reference);
    await service.applyUpdate(admin.id, order.reference, { expectedRevision: 1, status: 'OUT_FOR_DELIVERY', location: { latitude: 33.9, longitude: 35.5, label: 'Near home' }, note: 'Gate code 1234' });
    await prisma.order.update({ where: { id: order.id }, data: { status: 'CANCELLED' } });
    const before = await prisma.delivery.findUniqueOrThrow({ where: { orderId: order.id }, include: { events: true } });
    expect(before.status).toBe('OUT_FOR_DELIVERY');
    await new AccountDeletionService().deleteAccount(leaving.id);
    const after = await prisma.delivery.findUniqueOrThrow({ where: { orderId: order.id }, include: { events: true } });
    expect(after).toMatchObject({ latitude: null, longitude: null, locationLabel: null, locationSource: null, revision: before.revision, status: 'OUT_FOR_DELIVERY' });
    expect(after.events.map(event => event.id).sort()).toEqual(before.events.map(event => event.id).sort());
    expect(after.events.every(event => event.latitude === null && event.longitude === null && event.note === null)).toBe(true);
    expect(await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ shippingRecipient: 'Deleted customer', shippingPhone: 'Redacted', shippingLine1: 'Redacted' });
    expect(await prisma.payment.count({ where: { orderId: order.id, status: 'SUCCEEDED' } })).toBe(1);
  });

  it('T5-20c an ACTIVE order loses historical positions and notes at deletion, keeps what fulfilment needs, and is redacted when delivered', async () => {
    const leaving = await fixtures.user('CUSTOMER', 'leaving-active');
    const order = await fixtures.order(leaving.id, 'PREPARING', 'SUCCEEDED');
    await service.start(admin.id, order.reference);
    await service.applyUpdate(admin.id, order.reference, { expectedRevision: 1, status: 'OUT_FOR_DELIVERY', location: { latitude: 33.9, longitude: 35.5, label: 'Near home' }, note: 'Gate code 1234' });
    const accountDeletion = new AccountDeletionService();
    await accountDeletion.deleteAccount(leaving.id);

    let delivery = await prisma.delivery.findUniqueOrThrow({ where: { orderId: order.id }, include: { events: true } });
    expect(delivery.revision).toBe(2);
    expect(delivery.events).toHaveLength(2);
    expect(delivery.events.every(event => event.latitude === null && event.longitude === null && event.note === null)).toBe(true);
    expect(Number(delivery.latitude)).toBe(33.9);
    expect(await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ shippingRecipient: 'Delivery QA', shippingPhone: '+10000000000', shippingLine1: '1 QA Street' });

    expect(await code(accountDeletion.deleteAccount(leaving.id))).toBe('UNAUTHENTICATED');
    await service.applyUpdate(admin.id, order.reference, { expectedRevision: 2, status: 'DELIVERED' });
    delivery = await prisma.delivery.findUniqueOrThrow({ where: { orderId: order.id }, include: { events: true } });
    expect(delivery).toMatchObject({ latitude: null, longitude: null, locationLabel: null, locationSource: null, revision: 3, status: 'DELIVERED' });
    expect(delivery.events).toHaveLength(3);
    expect(delivery.events.every(event => event.latitude === null && event.longitude === null && event.note === null)).toBe(true);
    expect(await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ shippingRecipient: 'Deleted customer', shippingPhone: 'Redacted', shippingLine1: 'Redacted', shippingCity: 'Redacted' });
    expect(await prisma.payment.count({ where: { orderId: order.id, status: 'SUCCEEDED' } })).toBe(1);
  });

  // Cancellation is owned by PaymentService.compensate, which calls redactDeliveryForDeletedOwner right after the CANCELLED write in the
  // same transaction. These cases drive that exact helper in a real transaction; the lifecycle suite (scenario T) drives compensate itself.
  async function activeDeletedOrder(name: string) {
    const leaving = await fixtures.user('CUSTOMER', name);
    const order = await fixtures.order(leaving.id, 'PREPARING', 'SUCCEEDED');
    await service.start(admin.id, order.reference);
    await service.applyUpdate(admin.id, order.reference, { expectedRevision: 1, status: 'OUT_FOR_DELIVERY', location: { latitude: 33.9, longitude: 35.5, label: 'Near home' }, note: 'Gate code 1234' });
    await new AccountDeletionService().deleteAccount(leaving.id);
    return order;
  }
  const snapshotOf = (orderId: string) => prisma.order.findUniqueOrThrow({ where: { id: orderId }, include: { delivery: { include: { events: true } }, payment: true } });

  it('T5-20e deleted customer, active order, then cancellation: shipping and current location are scrubbed atomically; payment, revision and events stay', async () => {
    const { redactDeliveryForDeletedOwner } = await import('../delivery-privacy.js');
    const order = await activeDeletedOrder('cancel-after-delete');
    const before = await snapshotOf(order.id);
    expect(before.shippingLine1).toBe('1 QA Street');
    await prisma.$transaction(async tx => {
      await tx.order.update({ where: { id: order.id }, data: { status: 'CANCELLED' } });
      await redactDeliveryForDeletedOwner(tx, order.id);
    });
    const after = await snapshotOf(order.id);
    expect(after).toMatchObject({ status: 'CANCELLED', shippingRecipient: 'Deleted customer', shippingPhone: 'Redacted', shippingLine1: 'Redacted', shippingCity: 'Redacted', shippingLatitude: null, shippingLongitude: null });
    expect(after.delivery).toMatchObject({ latitude: null, longitude: null, locationLabel: null, locationSource: null, revision: before.delivery!.revision, status: before.delivery!.status });
    expect(after.delivery!.events.map(event => event.id).sort()).toEqual(before.delivery!.events.map(event => event.id).sort());
    expect(after.delivery!.events.every(event => event.latitude === null && event.longitude === null && event.note === null)).toBe(true);
    expect(after.payment).toEqual(before.payment);
  });

  it('T5-20f the redaction is idempotent, and an active customer who cancels is not redacted', async () => {
    const { redactDeliveryForDeletedOwner } = await import('../delivery-privacy.js');
    const order = await activeDeletedOrder('cancel-twice');
    await prisma.order.update({ where: { id: order.id }, data: { status: 'CANCELLED' } });
    await prisma.$transaction(tx => redactDeliveryForDeletedOwner(tx, order.id));
    const once = await snapshotOf(order.id);
    await prisma.$transaction(tx => redactDeliveryForDeletedOwner(tx, order.id));
    expect(await snapshotOf(order.id)).toEqual(once); // a repeat writes nothing, not even updatedAt

    const active = await fixtures.order(customer.id, 'PREPARING', 'SUCCEEDED');
    await service.start(admin.id, active.reference);
    await service.applyUpdate(admin.id, active.reference, { expectedRevision: 1, status: 'OUT_FOR_DELIVERY', location: { latitude: 33.9, longitude: 35.5, label: 'Near home' }, note: 'n' });
    const kept = await snapshotOf(active.id);
    await prisma.$transaction(async tx => {
      await tx.order.update({ where: { id: active.id }, data: { status: 'CANCELLED' } });
      await redactDeliveryForDeletedOwner(tx, active.id);
    });
    const after = await snapshotOf(active.id);
    expect(after).toMatchObject({ shippingRecipient: kept.shippingRecipient, shippingLine1: kept.shippingLine1, status: 'CANCELLED' });
    expect(Number(after.delivery!.latitude)).toBe(33.9);
    expect(after.delivery!.events.some(event => event.note === 'n')).toBe(true);
  });

  it('T5-20g a failure after the redaction rolls the whole cancellation back: no partial redaction', async () => {
    const { redactDeliveryForDeletedOwner } = await import('../delivery-privacy.js');
    const order = await activeDeletedOrder('cancel-rollback');
    const before = await snapshotOf(order.id);
    await expect(prisma.$transaction(async tx => {
      await tx.order.update({ where: { id: order.id }, data: { status: 'CANCELLED' } });
      await redactDeliveryForDeletedOwner(tx, order.id);
      throw new Error('simulated failure after redaction');
    })).rejects.toThrow('simulated failure');
    expect(await snapshotOf(order.id)).toEqual(before);
  });

  it('T5-20h partial prior redaction: only the phone left behind is still scrubbed, with no write once everything is redacted', async () => {
    const { redactDeliveryForDeletedOwner } = await import('../delivery-privacy.js');
    const order = await activeDeletedOrder('partial');
    await prisma.order.update({ where: { id: order.id }, data: { status: 'CANCELLED', shippingRecipient: 'Deleted customer', shippingLine1: 'Redacted', shippingLine2: null,
      shippingCity: 'Redacted', shippingState: null, shippingPostalCode: null, shippingCountry: 'Redacted', shippingLatitude: null, shippingLongitude: null } });
    expect((await snapshotOf(order.id)).shippingPhone).toBe('+10000000000');
    await prisma.$transaction(tx => redactDeliveryForDeletedOwner(tx, order.id));
    const once = await snapshotOf(order.id);
    expect(once.shippingPhone).toBe('Redacted');
    await prisma.$transaction(tx => redactDeliveryForDeletedOwner(tx, order.id));
    expect(await snapshotOf(order.id)).toEqual(once);
  });

  it('T5-20d a delivered order for an active customer is never redacted by the delivery service', async () => {
    const order = await fixtures.order(customer.id, 'PREPARING', 'SUCCEEDED');
    await service.start(admin.id, order.reference);
    await service.applyUpdate(admin.id, order.reference, { expectedRevision: 1, status: 'OUT_FOR_DELIVERY' });
    await service.applyUpdate(admin.id, order.reference, { expectedRevision: 2, status: 'DELIVERED' });
    expect(await prisma.order.findUniqueOrThrow({ where: { id: order.id } })).toMatchObject({ shippingRecipient: 'Delivery QA', shippingPhone: '+10000000000', shippingLine1: '1 QA Street' });
  });
});
