import { randomBytes } from 'node:crypto';
import { Prisma, PrismaClient, type DeliveryEventChange, type DeliveryEventType, type OrderStatus } from '@prisma/client';
import { prisma } from '../lib/prisma.js';
import { AppError } from '../middleware/errorHandler.js';
import { transitionFulfillment } from './commerce-email.producer.js';
import { deliveryOrigin, type DeliveryOrigin } from '../config/delivery-map.config.js';
import { buildDeliveryMap, MAP_PATH_LIMIT, type CustomerDeliveryMap } from './delivery-map.projection.js';
import { redactDeliveryForDeletedOwner } from './delivery-privacy.js';
import { parseOrderReference } from './order.service.js';
import { orderSearch } from './admin-order.service.js';
import type { DeliveryUpdateInput } from '../validators/delivery.validator.js';
import { activeSharedDevSimulationScope } from './delivery-simulation/simulation.config.js';

/**
 * Task 04.5 Delivery Tracking Foundation (architecture §3–§5). Order.status stays canonical; Delivery.status mirrors it and is written
 * only here, inside the same transaction as the EXISTING transitionFulfillment (forward-only, replay-safe, commerce email outbox).
 * Every write starts by locking the Order row, the same lock payment compensation takes, so delivery writes and cancellation serialize.
 */
type Tx = Prisma.TransactionClient;
export type SimulationIneligibleReason = 'ORDER_NOT_FOUND' | 'ORDER_CANCELLED' | 'PAYMENT_INELIGIBLE' | 'NOT_OUT_FOR_DELIVERY' | 'DELIVERY_NOT_STARTED';
export type DeliveryAvailability = 'AVAILABLE' | 'NOT_STARTED' | 'PAYMENT_PENDING' | 'CANCELLED';
const FULFILLMENT: readonly OrderStatus[] = ['CONFIRMED', 'PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED'];
const NEXT: Partial<Record<OrderStatus, OrderStatus>> = { CONFIRMED: 'PREPARING', PREPARING: 'OUT_FOR_DELIVERY', OUT_FOR_DELIVERY: 'DELIVERED' };
const CUSTOMER_TIMELINE_LIMIT = 50;
const ADMIN_HISTORY_LIMIT = 200;
const TX_OPTIONS = { maxWait: 10_000, timeout: 20_000 };

const include = {
  payment: { select: { status: true } },
  delivery: true,
  paymentAttempt: { select: { id: true } },
  items: { select: { product: { select: { id: true, isTestFixture: true } } } },
} satisfies Prisma.OrderInclude;
type LoadedOrder = Prisma.OrderGetPayload<{ include: typeof include }>;
type DeliveryRow = NonNullable<LoadedOrder['delivery']>;

/** Raised inside the write transaction; the controller answers 409 with the current admin snapshot read after rollback. */
export class DeliveryRevisionConflict extends AppError {
  constructor(public readonly orderReference: string) {
    super('This delivery changed since you loaded it. Load the latest version and review your update again.', 409, 'DELIVERY_REVISION_CONFLICT');
    // AppError pins its own prototype; restore ours so the controller can recognise the conflict.
    Object.setPrototypeOf(this, DeliveryRevisionConflict.prototype);
  }
}

/** Public reference, identical to the Order Details projection. */
const orderReference = (id: string) => `ORD-${id.toUpperCase()}`;
const iso = (value: Date | null | undefined) => value ? value.toISOString() : null;
const coordinate = (value: Prisma.Decimal | null) => value === null ? null : Number(value);
/** No synthetic payment: the narrowly scoped QA exception stays visibly unpaid in all projections. */
export const paymentEligible = (order: LoadedOrder) => {
  if (order.status === 'AWAITING_CAPTURE') return false;
  if (order.payment?.status === 'SUCCEEDED') return true;
  const scope = activeSharedDevSimulationScope();
  return Boolean(scope && scope.orderIds.includes(order.id) && order.shippingRecipient === scope.runId && order.shippingLine1 === scope.runId &&
    order.userId === scope.customerUserId && order.total.isZero() &&
    !order.payment && !order.paymentAttempt && order.items.length && order.items.every(item => item.product.id === scope.productId && item.product.isTestFixture));
};

export function availability(order: LoadedOrder): DeliveryAvailability {
  if (order.status === 'CANCELLED') return 'CANCELLED';
  if (!paymentEligible(order) || !FULFILLMENT.includes(order.status)) return 'PAYMENT_PENDING';
  return order.delivery ? 'AVAILABLE' : 'NOT_STARTED';
}

/** `EH-TRK-` + 10 Crockford base32 characters from the CSPRNG. Display-only; never a credential, never in a URL. */
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
export function trackingReference() {
  return `EH-TRK-${Array.from(randomBytes(10), byte => CROCKFORD[byte & 31]).join('')}`;
}

type EventRow = Prisma.DeliveryEventGetPayload<{ include: { actor: { select: { email: true } } } }>;
type TimelineEntry = { id: string; type: 'TRACKING_STARTED' | 'STATUS_CHANGED' | 'ETA_UPDATED' | 'ETA_CLEARED'; occurredAt: string;
  status?: OrderStatus; estimatedAt?: string | null };

/** Customer projection: one entry per customer-visible aspect of an event. Location, notes, actors and sources never leave the server. */
export function customerTimeline(events: Pick<EventRow, 'id' | 'type' | 'changes' | 'toStatus' | 'estimatedAt' | 'occurredAt'>[]) {
  const entries: TimelineEntry[] = [];
  for (const event of events) {
    const occurredAt = event.occurredAt.toISOString();
    if (event.type === 'TRACKING_STARTED') {
      entries.push({ id: event.id, type: 'TRACKING_STARTED', occurredAt, ...(event.toStatus ? { status: event.toStatus } : {}) });
      continue;
    }
    if (event.changes.includes('STATUS') && event.toStatus) entries.push({ id: `${event.id}:status`, type: 'STATUS_CHANGED', occurredAt, status: event.toStatus });
    if (event.changes.includes('ETA')) entries.push({ id: `${event.id}:eta`, type: event.estimatedAt ? 'ETA_UPDATED' : 'ETA_CLEARED', occurredAt,
      estimatedAt: iso(event.estimatedAt) });
  }
  return entries.slice(0, CUSTOMER_TIMELINE_LIMIT);
}

function customerFields(order: LoadedOrder, timeline: TimelineEntry[], now: Date) {
  const state = availability(order);
  const delivery = state === 'AVAILABLE' ? order.delivery : null;
  const live = delivery && order.status === 'OUT_FOR_DELIVERY' && delivery.latitude !== null && delivery.longitude !== null && delivery.locationUpdatedAt;
  return {
    orderReference: orderReference(order.id),
    availability: state,
    status: order.status,
    paymentState: paymentState(order),
    revision: delivery?.revision ?? 0,
    trackingReference: delivery?.trackingCode ?? null,
    deliveryMethod: order.deliveryMethod,
    eta: { estimatedAt: order.status === 'DELIVERED' ? null : iso(delivery?.estimatedAt), updatedAt: iso(delivery?.etaUpdatedAt),
      promisedStart: order.estimatedDeliveryStart.toISOString(), promisedEnd: order.estimatedDeliveryEnd.toISOString() },
    location: live ? { latitude: coordinate(delivery.latitude)!, longitude: coordinate(delivery.longitude)!, label: delivery.locationLabel,
      updatedAt: delivery.locationUpdatedAt!.toISOString(), source: delivery.locationSource ?? 'MANUAL' } : null,
    deliveredAt: iso(delivery?.deliveredAt),
    isSimulated: delivery?.isSimulated ?? false,
    // Cancelled orders keep the history that was genuinely recorded before cancellation; nothing is added for them.
    timeline: state === 'AVAILABLE' || state === 'CANCELLED' ? timeline : [],
    serverTime: now.toISOString(),
  };
}

/** Same projection as Order Details: PAID only for a stored SUCCEEDED payment. */
function paymentState(order: Pick<LoadedOrder, 'payment'>) {
  const status = order.payment?.status;
  return !status ? 'UNPROCESSED' : status === 'SUCCEEDED' ? 'PAID' : status === 'REFUNDED' ? 'REFUNDED' : status === 'FAILED' ? 'FAILED' : 'PENDING';
}

function adminFields(order: LoadedOrder & { user: { email: string; firstName: string | null; lastName: string | null } }, events: EventRow[], now: Date) {
  const timeline = customerTimeline(events.filter(event => event.type === 'TRACKING_STARTED' || event.changes.some(change => change !== 'LOCATION')));
  const delivery = order.delivery;
  const eligible = paymentEligible(order) && order.status !== 'CANCELLED';
  return {
    ...customerFields(order, timeline, now),
    orderId: order.id,
    customer: { name: [order.user.firstName, order.user.lastName].filter(Boolean).join(' ') || null, email: order.user.email },
    paymentEligible: eligible,
    canStart: eligible && FULFILLMENT.includes(order.status) && !delivery,
    allowedNextStatus: eligible && delivery ? NEXT[order.status] ?? null : null,
    current: delivery ? {
      status: delivery.status, revision: delivery.revision, trackingReference: delivery.trackingCode,
      estimatedAt: iso(delivery.estimatedAt), etaUpdatedAt: iso(delivery.etaUpdatedAt),
      location: delivery.latitude !== null && delivery.longitude !== null ? { latitude: coordinate(delivery.latitude)!, longitude: coordinate(delivery.longitude)!,
        label: delivery.locationLabel, updatedAt: iso(delivery.locationUpdatedAt), source: delivery.locationSource } : null,
      deliveredAt: iso(delivery.deliveredAt), updatedAt: delivery.updatedAt.toISOString(),
    } : null,
    history: events.map(event => ({ id: event.id, revision: event.revision, type: event.type, changes: event.changes, source: event.source,
      fromStatus: event.fromStatus, toStatus: event.toStatus, latitude: coordinate(event.latitude), longitude: coordinate(event.longitude),
      estimatedAt: iso(event.estimatedAt), note: event.note, actorEmail: event.actor?.email ?? null, occurredAt: event.occurredAt.toISOString() })),
  };
}

export type CustomerDeliverySnapshot = ReturnType<typeof customerFields> & { map: CustomerDeliveryMap | null };
export type AdminDeliverySnapshot = ReturnType<typeof adminFields>;
/** Task 04.7 `delivery:updated` payload body: the customer projection without the timeline or the recorded map path (clients append). */
export type RealtimeDeliveryProjection = { orderId: string; orderReference: string; revision: number; occurredAt: string;
  snapshot: Omit<CustomerDeliverySnapshot, 'timeline' | 'map'> & { map: Omit<CustomerDeliveryMap, 'path'> | null };
  timelineEntries: TimelineEntry[]; source: 'ADMIN' | 'SIMULATION' | 'SYSTEM' };
/** Who wrote an update. SIMULATION is the Task 04.7 demo runner: it marks the delivery and its location as simulated. */
export type DeliveryUpdateSource = 'ADMIN' | 'SIMULATION';

const customerTimelineWhere: Prisma.DeliveryEventWhereInput = { OR: [{ type: 'TRACKING_STARTED' }, { changes: { hasSome: ['STATUS', 'ETA'] } }] };

export class DeliveryService {
  constructor(private readonly database: PrismaClient = prisma, private readonly clock: () => Date = () => new Date(),
    private readonly origin: () => DeliveryOrigin | null = deliveryOrigin) {}

  /** Owner-scoped read. Unknown and other customers' orders are the same 404 as Order Details, so existence never leaks. */
  async getCustomerSnapshot(userId: string, reference: string): Promise<CustomerDeliverySnapshot> {
    const order = await this.database.order.findFirst({ where: { id: parseOrderReference(reference), userId }, include });
    if (!order) throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');
    const [events, map] = await Promise.all([order.delivery ? this.database.deliveryEvent.findMany({ where: { deliveryId: order.delivery.id, ...customerTimelineWhere },
      orderBy: { revision: 'desc' }, take: CUSTOMER_TIMELINE_LIMIT,
      select: { id: true, type: true, changes: true, toStatus: true, estimatedAt: true, occurredAt: true } }) : [], this.customerMap(order)]);
    return { ...customerFields(order, customerTimeline(events), this.clock()), map };
  }

  /**
   * Task 04.6 map: only for a trackable order with a configured hub. Recorded positions are shared only while the live location itself is
   * shared (OUT_FOR_DELIVERY with a current position), so a delivered or cancelled order, or one whose location an admin cleared, never
   * exposes its route. Redacted owners already hold null coordinates.
   */
  private async customerMap(order: LoadedOrder): Promise<CustomerDeliveryMap | null> {
    const origin = this.origin();
    if (!origin || availability(order) !== 'AVAILABLE' || !order.delivery) return null;
    const live = order.status === 'OUT_FOR_DELIVERY' && order.delivery.latitude !== null && order.delivery.longitude !== null;
    const points = live ? await this.database.deliveryEvent.findMany({
      where: { deliveryId: order.delivery.id, changes: { has: 'LOCATION' }, latitude: { not: null }, longitude: { not: null } },
      orderBy: { revision: 'desc' }, take: MAP_PATH_LIMIT, select: { latitude: true, longitude: true, source: true } }) : [];
    return buildDeliveryMap({ origin, isSimulated: order.delivery.isSimulated,
      shipping: { latitude: coordinate(order.shippingLatitude), longitude: coordinate(order.shippingLongitude) },
      points: points.reverse().map(point => ({ latitude: coordinate(point.latitude), longitude: coordinate(point.longitude),
        simulated: point.source === 'SIMULATION' })) });
  }

  async getAdminSnapshot(reference: string, database: PrismaClient | Tx = this.database): Promise<AdminDeliverySnapshot> {
    const order = await database.order.findUnique({ where: { id: parseOrderReference(reference) },
      include: { ...include, user: { select: { email: true, firstName: true, lastName: true } } } });
    if (!order) throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');
    const events = order.delivery ? await database.deliveryEvent.findMany({ where: { deliveryId: order.delivery.id }, orderBy: { revision: 'desc' },
      take: ADMIN_HISTORY_LIMIT, include: { actor: { select: { email: true } } } }) : [];
    return adminFields(order, events, this.clock());
  }

  /** Paid, non-cancelled orders newest first; payment eligibility is decided from the stored Payment, never from a badge. */
  async listForAdmin({ status, q, page, pageSize }: { status?: OrderStatus; q?: string; page: number; pageSize: number }) {
    // Status tabs count within the search, so each tab's number matches the rows it selects.
    const scope: Prisma.OrderWhereInput[] = [{ payment: { is: { status: 'SUCCEEDED' } } }, { status: { in: [...FULFILLMENT] } }];
    if (q) scope.push(orderSearch(q));
    const where: Prisma.OrderWhereInput = { AND: status ? [...scope, { status }] : scope };
    const [orders, total, groups] = await Promise.all([
      this.database.order.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * pageSize, take: pageSize,
        select: { id: true, status: true, createdAt: true, deliveryMethod: true, user: { select: { email: true, firstName: true, lastName: true } },
          delivery: { select: { revision: true, trackingCode: true, updatedAt: true, estimatedAt: true } } } }),
      this.database.order.count({ where }),
      this.database.order.groupBy({ by: ['status'], where: { AND: scope }, _count: { _all: true } }),
    ]);
    const statusCounts = Object.fromEntries(groups.map(group => [group.status, group._count._all]));
    return { data: orders.map(order => ({ orderReference: orderReference(order.id), status: order.status, paymentState: 'PAID' as const,
      createdAt: order.createdAt.toISOString(), deliveryMethod: order.deliveryMethod,
      customer: { name: [order.user.firstName, order.user.lastName].filter(Boolean).join(' ') || null, email: order.user.email },
      delivery: order.delivery ? { revision: order.delivery.revision, trackingReference: order.delivery.trackingCode,
        estimatedAt: iso(order.delivery.estimatedAt), updatedAt: order.delivery.updatedAt.toISOString() } : null })),
    meta: { page, pageSize, total, totalPages: Math.ceil(total / pageSize), statusCounts } };
  }

  /**
   * Start tracking (idempotent). Mirrors the order's CURRENT fulfillment status with one TRACKING_STARTED event at revision 1:
   * a paid order already past CONFIRMED gets no fabricated earlier milestones.
   */
  async start(actorUserId: string, reference: string): Promise<{ created: boolean; snapshot: AdminDeliverySnapshot }> {
    const orderId = parseOrderReference(reference);
    const created = await this.database.$transaction(async tx => {
      const order = await this.lockOrder(tx, orderId);
      this.assertWritable(order);
      if (order.delivery) return false;
      const now = this.clock();
      const delivery = await tx.delivery.create({ data: { orderId, status: order.status as Exclude<OrderStatus, 'AWAITING_CAPTURE' | 'CANCELLED'>,
        trackingCode: await this.uniqueTrackingReference(tx), revision: 1 } });
      await tx.deliveryEvent.create({ data: { deliveryId: delivery.id, revision: 1, type: 'TRACKING_STARTED', changes: [], source: 'ADMIN',
        toStatus: order.status, actorUserId, occurredAt: now } });
      return true;
    }, TX_OPTIONS);
    return { created, snapshot: await this.getAdminSnapshot(reference) };
  }

  /** One accepted request = one revision = one DeliveryEvent. A request that changes nothing writes nothing. */
  async applyUpdate(actorUserId: string, reference: string, input: DeliveryUpdateInput, source: DeliveryUpdateSource = 'ADMIN'):
    Promise<{ changed: boolean; changes: DeliveryEventChange[]; snapshot: AdminDeliverySnapshot }> {
    const orderId = parseOrderReference(reference);
    const changes = await this.database.$transaction(async tx => {
      const order = await this.lockOrder(tx, orderId);
      this.assertWritable(order);
      const delivery = order.delivery;
      if (!delivery) throw new AppError('Start tracking before updating this delivery.', 404, 'DELIVERY_NOT_STARTED');
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "deliveries" WHERE "id" = ${delivery.id}::uuid FOR UPDATE`);
      if (delivery.revision !== input.expectedRevision) throw new DeliveryRevisionConflict(reference);
      if (order.status === 'DELIVERED') throw new AppError('This order has been delivered. Its tracking can no longer change.', 409, 'DELIVERY_TERMINAL');

      const now = this.clock();
      const changes: DeliveryEventChange[] = [];
      const data: Prisma.DeliveryUpdateInput = {};
      const event: Partial<Prisma.DeliveryEventUncheckedCreateInput> = {};
      let status: OrderStatus = order.status;

      if (input.status !== undefined && input.status !== order.status) {
        if (NEXT[order.status] !== input.status) throw new AppError('This order status change is not allowed.', 409, 'ORDER_TRANSITION_INVALID');
        await transitionFulfillment(tx, { orderId, to: input.status, occurredAt: now });
        status = input.status;
        changes.push('STATUS');
        data.status = input.status;
        if (input.status === 'DELIVERED') data.deliveredAt = now;
        Object.assign(event, { fromStatus: order.status, toStatus: input.status });
      }
      if (input.location !== undefined) this.applyLocation(delivery, status, input.location, now, changes, data, event, source);
      if (input.estimatedAt !== undefined) {
        const next = input.estimatedAt === null ? null : new Date(input.estimatedAt);
        if (next?.getTime() !== delivery.estimatedAt?.getTime()) {
          if (status === 'DELIVERED') throw new AppError('A delivered order has no estimated arrival.', 409, 'DELIVERY_TERMINAL');
          changes.push('ETA');
          Object.assign(data, { estimatedAt: next, etaUpdatedAt: now });
          event.estimatedAt = next;
        }
      }
      if (changes.length === 0) return changes;
      if (source === 'SIMULATION') data.isSimulated = true;

      const revision = delivery.revision + 1;
      const updated = await tx.delivery.updateMany({ where: { id: delivery.id, revision: delivery.revision }, data: { ...data, revision } as Prisma.DeliveryUpdateManyMutationInput });
      if (updated.count !== 1) throw new DeliveryRevisionConflict(reference);
      await tx.deliveryEvent.create({ data: { ...event, deliveryId: delivery.id, revision, type: primaryType(changes, data), changes, source,
        actorUserId, note: input.note ?? null, occurredAt: now } });
      if (status === 'DELIVERED') await redactDeliveryForDeletedOwner(tx, orderId);
      return changes;
    }, TX_OPTIONS);
    return { changed: changes.length > 0, changes, snapshot: await this.getAdminSnapshot(reference) };
  }

  /**
   * Task 04.7 demo markers. SIMULATION_STARTED flags the delivery as simulated; SIMULATION_STOPPED records the end. Both take the same lock,
   * revision and single-event path as admin updates, never touch status, payment or the order, and never reach the customer timeline.
   * Returns the new revision, or null when the delivery can no longer change (stop after DELIVERED/CANCELLED writes nothing).
   */
  async recordSimulation(actorUserId: string | null, reference: string, marker: 'STARTED' | 'STOPPED'): Promise<number | null> {
    const orderId = parseOrderReference(reference);
    return this.database.$transaction(async tx => {
      const order = await this.lockOrder(tx, orderId);
      if (marker === 'STOPPED' && (order.status !== 'OUT_FOR_DELIVERY' || !order.delivery)) return null;
      this.assertWritable(order);
      const delivery = order.delivery;
      if (!delivery) throw new AppError('Start tracking before updating this delivery.', 404, 'DELIVERY_NOT_STARTED');
      if (order.status !== 'OUT_FOR_DELIVERY') throw new AppError('A simulation can run only while the order is out for delivery.', 409, 'DELIVERY_LOCATION_NOT_ALLOWED');
      await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "deliveries" WHERE "id" = ${delivery.id}::uuid FOR UPDATE`);
      const revision = delivery.revision + 1;
      const updated = await tx.delivery.updateMany({ where: { id: delivery.id, revision: delivery.revision },
        data: { revision, ...(marker === 'STARTED' ? { isSimulated: true } : {}) } });
      if (updated.count !== 1) throw new DeliveryRevisionConflict(reference);
      await tx.deliveryEvent.create({ data: { deliveryId: delivery.id, revision, type: marker === 'STARTED' ? 'SIMULATION_STARTED' : 'SIMULATION_STOPPED',
        changes: [], source: actorUserId ? 'SIMULATION' : 'SYSTEM', actorUserId, occurredAt: this.clock() } });
      return revision;
    }, TX_OPTIONS);
  }

  /**
   * Why (or whether) a demo simulation could start for this order. Read-only and advisory: Start re-checks everything under the order lock in
   * recordSimulation. Mirrors assertWritable, so payment-ineligible orders (including ordinary unpaid ones) are never reported as eligible.
   */
  async simulationEligibility(reference: string): Promise<SimulationIneligibleReason | null> {
    const order = await this.database.order.findUnique({ where: { id: parseOrderReference(reference) }, include });
    if (!order) return 'ORDER_NOT_FOUND';
    if (order.status === 'CANCELLED') return 'ORDER_CANCELLED';
    if (!paymentEligible(order) || !FULFILLMENT.includes(order.status)) return 'PAYMENT_INELIGIBLE';
    if (order.status !== 'OUT_FOR_DELIVERY') return 'NOT_OUT_FOR_DELIVERY';
    return order.delivery ? null : 'DELIVERY_NOT_STARTED';
  }

  /**
   * Task 04.7: the customer-safe projection published after a commit, read back from the database so the revision is the persisted one.
   * Timeline entries come from the event at that revision only (none for location-only or simulation markers). Null when the order is gone.
   */
  async getRealtimeProjection(orderId: string): Promise<RealtimeDeliveryProjection | null> {
    const order = await this.database.order.findUnique({ where: { id: orderId }, include });
    if (!order) return null;
    const event = order.delivery ? await this.database.deliveryEvent.findUnique({ where: { deliveryId_revision: { deliveryId: order.delivery.id, revision: order.delivery.revision } },
      select: { id: true, type: true, changes: true, toStatus: true, estimatedAt: true, occurredAt: true, source: true } }) : null;
    const now = this.clock();
    const { timeline: _timeline, ...fields } = customerFields(order, [], now);
    void _timeline;
    const map = await this.customerMap(order);
    const visible = event && (event.type === 'TRACKING_STARTED' || event.changes.some(change => change !== 'LOCATION'));
    return { orderId, orderReference: fields.orderReference, revision: fields.revision, occurredAt: (event?.occurredAt ?? now).toISOString(),
      snapshot: { ...fields, map: map ? { origin: map.origin, destination: map.destination, pathKind: map.pathKind } : null },
      timelineEntries: visible && fields.availability !== 'PAYMENT_PENDING' ? customerTimeline([event]) : [], source: event?.source ?? 'SYSTEM' };
  }

  private applyLocation(delivery: DeliveryRow, status: OrderStatus, location: DeliveryUpdateInput['location'], now: Date,
    changes: DeliveryEventChange[], data: Prisma.DeliveryUpdateInput, event: Partial<Prisma.DeliveryEventUncheckedCreateInput>, source: DeliveryUpdateSource) {
    const hasLocation = delivery.latitude !== null && delivery.longitude !== null;
    if (location === null) {
      if (!hasLocation) return;
      changes.push('LOCATION');
      Object.assign(data, { latitude: null, longitude: null, locationLabel: null, locationSource: null, locationUpdatedAt: now });
      return;
    }
    if (!location) return;
    // A courier position means nothing to a customer before dispatch, and the live location is frozen after delivery.
    if (status !== 'OUT_FOR_DELIVERY') throw new AppError('A location can be shared only while the order is out for delivery.', 409, 'DELIVERY_LOCATION_NOT_ALLOWED');
    const label = location.label ?? null;
    if (hasLocation && Number(delivery.latitude) === location.latitude && Number(delivery.longitude) === location.longitude && delivery.locationLabel === label) return;
    changes.push('LOCATION');
    Object.assign(data, { latitude: location.latitude, longitude: location.longitude, locationLabel: label,
      locationSource: source === 'SIMULATION' ? 'SIMULATED' : 'MANUAL', locationUpdatedAt: now });
    Object.assign(event, { latitude: location.latitude, longitude: location.longitude });
  }

  private async lockOrder(tx: Tx, orderId: string) {
    const rows = await tx.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT "id" FROM "orders" WHERE "id" = ${orderId}::uuid FOR UPDATE`);
    if (!rows[0]) throw new AppError('Order not found.', 404, 'ORDER_NOT_FOUND');
    return tx.order.findUniqueOrThrow({ where: { id: orderId }, include });
  }

  /** I3, I5, I7: checked under the order row lock, so a concurrent cancellation or refund is always observed. */
  private assertWritable(order: LoadedOrder) {
    if (order.status === 'CANCELLED') throw new AppError('This order was cancelled. Its delivery can no longer change.', 409, 'DELIVERY_ORDER_CANCELLED');
    if (!paymentEligible(order) || !FULFILLMENT.includes(order.status)) {
      throw new AppError('Delivery tracking needs a confirmed successful payment for this order.', 409, 'DELIVERY_PAYMENT_INELIGIBLE');
    }
  }

  private async uniqueTrackingReference(tx: Tx) {
    for (let attempt = 0; attempt < 5; attempt++) {
      const candidate = trackingReference();
      if (!await tx.delivery.findUnique({ where: { trackingCode: candidate }, select: { id: true } })) return candidate;
    }
    throw new AppError('A tracking reference could not be assigned. Please retry.', 503, 'DELIVERY_REFERENCE_UNAVAILABLE');
  }
}

/** Precedence STATUS_CHANGED > LOCATION_* > ETA_*; `changes` lists every aspect on the same row. */
function primaryType(changes: DeliveryEventChange[], data: Prisma.DeliveryUpdateInput): DeliveryEventType {
  if (changes.includes('STATUS')) return 'STATUS_CHANGED';
  if (changes.includes('LOCATION')) return data.latitude === null ? 'LOCATION_CLEARED' : 'LOCATION_UPDATED';
  return data.estimatedAt === null ? 'ETA_CLEARED' : 'ETA_UPDATED';
}
