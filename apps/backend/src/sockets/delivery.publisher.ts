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

export const DeliveryPublisher = {
  attach(next: DeliveryGateway | null, deliveryService: DeliveryService = new DeliveryService()) { gateway = next; service = deliveryService; },
  get gateway() { return gateway; },

  async afterCommit(orderId: string, changed: PublishChange[]): Promise<void> {
    const target = gateway;
    if (!target || changed.length === 0) return;
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

