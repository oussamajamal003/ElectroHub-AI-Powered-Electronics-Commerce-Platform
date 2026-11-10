import type { DeliveryEventChange } from '@prisma/client';
import { DeliveryService } from '../services/delivery.service.js';
import { logSafely } from '../utils/logger.js';
import { orderRoom, type DeliveryGateway } from './delivery.gateway.js';
import { realtimeMetrics } from './realtime-metrics.js';

/**
 * Task 04.7 publication (architecture §8.3–§8.4). Called only after `$transaction` resolved, so a rollback never publishes, and callers skip
 * no-op updates. Failures are logged (no coordinates, no payload) and counted, and never reach the HTTP response: clients converge on the
 * next event, a reconnect, or the REST refetch. Without an attached gateway (workers, tests) every call is a no-op.
 */
export type PublishChange = 'status' | 'location' | 'eta' | 'tracking' | 'simulation';
const CHANGE: Record<DeliveryEventChange, PublishChange> = { STATUS: 'status', LOCATION: 'location', ETA: 'eta' };
export const toPublishChanges = (changes: DeliveryEventChange[]) => changes.map(change => CHANGE[change]);

let gateway: DeliveryGateway | null = null;
let service = new DeliveryService();

/**
 * Callers fire-and-forget, and each publish reads the projection asynchronously, so two commits close together (a simulation tick and
 * the stop, two admin PATCHes) could emit in the order their reads finished: revision 4 before 3 (Task 06.1 R-5). Publishes for one
 * order run one after another; each read starts after the previous emit, so the revisions a room sees never decrease. Orders are
 * independent, and the entry is dropped once its queue drains.
 */
const queues = new Map<string, Promise<void>>();

export const DeliveryPublisher = {
  attach(next: DeliveryGateway | null, deliveryService: DeliveryService = new DeliveryService()) { gateway = next; service = deliveryService; },
  get gateway() { return gateway; },

  afterCommit(orderId: string, changed: PublishChange[]): Promise<void> {
    if (!gateway || changed.length === 0) return Promise.resolve();
    const next = (queues.get(orderId) ?? Promise.resolve()).then(() => publish(orderId, changed));
    queues.set(orderId, next);
    void next.then(() => { if (queues.get(orderId) === next) queues.delete(orderId); });
    return next;
  },

  revoked(orderId: string, orderReference: string, reason: 'ACCESS_REVOKED' | 'ORDER_CANCELLED') {
    if (!gateway) return;
    try {
      gateway.namespace.to(orderRoom(orderId)).emit('delivery:revoked', { v: 1, orderReference, reason });
      realtimeMetrics.increment('revoked');
    } catch {
      realtimeMetrics.increment('publish_failed');
    }
  },

  /** Logout, deactivation and deletion: drop every live socket of the account. Never throws into the caller's flow. */
  disconnectUser(userId: string, reason: 'LOGOUT' | 'ACCOUNT_DELETED' | 'ACCOUNT_DEACTIVATED') {
    try { gateway?.disconnectUser(userId, reason); } catch { realtimeMetrics.increment('publish_failed'); }
  },
};

/** Never rejects, so one failed publish cannot stall the order's queue. */
async function publish(orderId: string, changed: PublishChange[]): Promise<void> {
  const target = gateway;
  if (!target) return;
  try {
    const projection = await service.getRealtimeProjection(orderId);
    if (!projection) return;
    target.namespace.to(orderRoom(orderId)).emit('delivery:updated', { v: 1, orderReference: projection.orderReference, revision: projection.revision,
      occurredAt: projection.occurredAt, changed, snapshot: projection.snapshot, timelineEntry: projection.timelineEntries[0] ?? null,
      timelineEntries: projection.timelineEntries, source: projection.source === 'SIMULATION' ? 'SIMULATION' : 'ADMIN' });
    realtimeMetrics.increment('published');
  } catch (error) {
    realtimeMetrics.increment('publish_failed');
    logSafely('warn', 'Delivery publish failed', { event: 'DELIVERY_PUBLISH_FAILED', errorName: error instanceof Error ? error.name : 'Unknown' });
  }
}
