import { adminInventoryRoom, type DeliveryGateway } from './delivery.gateway.js';
import { logSafely } from '../utils/logger.js';

/**
 * An authenticated admin-only invalidation hint. The payload deliberately contains no product, customer, count or email data;
 * recipients re-read the normal authorized REST resources after a committed inventory mutation.
 */
let gateway: DeliveryGateway | null = null;

export const AdminInventoryPublisher = {
  attach(next: DeliveryGateway | null) { gateway = next; },
  afterCommit(eventId: string) {
    try { gateway?.namespace.to(adminInventoryRoom).emit('admin:inventory-changed', { v: 1, eventId }); }
    catch (error) {
      logSafely('warn', 'Admin inventory invalidation publish failed', {
        event: 'admin.inventory.publish_failed', errorName: error instanceof Error ? error.name : 'Unknown',
      });
    }
  },
};
