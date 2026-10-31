import type { FulfillmentStatus, OrderPaymentState } from '@/features/orders/types';

/** Mirror of `GET /api/orders/:orderReference/delivery` (architecture §5.1). The `map` field arrives additively in Task 04.6. */
export type DeliveryAvailability = 'AVAILABLE' | 'NOT_STARTED' | 'PAYMENT_PENDING' | 'CANCELLED';
export type DeliveryStage = 'CONFIRMED' | 'PREPARING' | 'OUT_FOR_DELIVERY' | 'DELIVERED';

export interface DeliveryTimelineEntry {
  id: string;
  type: 'TRACKING_STARTED' | 'STATUS_CHANGED' | 'ETA_UPDATED' | 'ETA_CLEARED';
  occurredAt: string;
  status?: FulfillmentStatus;
  estimatedAt?: string | null;
}

export interface CustomerDeliverySnapshot {
  orderReference: string;
  availability: DeliveryAvailability;
  status: FulfillmentStatus;
  paymentState: OrderPaymentState;
  revision: number;
  trackingReference: string | null;
  deliveryMethod: 'STANDARD' | 'EXPRESS' | 'OVERNIGHT';
  eta: { estimatedAt: string | null; updatedAt: string | null; promisedStart: string; promisedEnd: string };
  location: { latitude: number; longitude: number; label: string | null; updatedAt: string; source: 'MANUAL' | 'SIMULATED' } | null;
  deliveredAt: string | null;
  isSimulated: boolean;
  timeline: DeliveryTimelineEntry[];
  serverTime: string;
}

export interface AdminDeliveryEvent {
  id: string;
  revision: number;
  type: 'TRACKING_STARTED' | 'STATUS_CHANGED' | 'LOCATION_UPDATED' | 'LOCATION_CLEARED' | 'ETA_UPDATED' | 'ETA_CLEARED' | 'SIMULATION_STARTED' | 'SIMULATION_STOPPED';
  changes: ('STATUS' | 'LOCATION' | 'ETA')[];
  source: 'ADMIN' | 'SIMULATION' | 'SYSTEM';
  fromStatus: FulfillmentStatus | null;
  toStatus: FulfillmentStatus | null;
  latitude: number | null;
  longitude: number | null;
  estimatedAt: string | null;
  note: string | null;
  actorEmail: string | null;
  occurredAt: string;
}

/** `GET|POST|PATCH /api/admin/orders/:orderReference/delivery` (ADMIN only). */
export interface AdminDeliverySnapshot extends CustomerDeliverySnapshot {
  orderId: string;
  customer: { name: string | null; email: string };
  paymentEligible: boolean;
  canStart: boolean;
  allowedNextStatus: Exclude<DeliveryStage, 'CONFIRMED'> | null;
  current: {
    status: DeliveryStage; revision: number; trackingReference: string | null; estimatedAt: string | null; etaUpdatedAt: string | null;
    location: { latitude: number; longitude: number; label: string | null; updatedAt: string | null; source: 'MANUAL' | 'SIMULATED' | null } | null;
    deliveredAt: string | null; updatedAt: string;
  } | null;
  history: AdminDeliveryEvent[];
}

export interface AdminDeliveryRow {
  orderReference: string;
  status: DeliveryStage;
  paymentState: 'PAID';
  createdAt: string;
  customer: { name: string | null; email: string };
  delivery: { revision: number; trackingReference: string | null; estimatedAt: string | null; updatedAt: string } | null;
}

export interface AdminDeliveryUpdate {
  expectedRevision: number;
  status?: Exclude<DeliveryStage, 'CONFIRMED'>;
  location?: { latitude: number; longitude: number; label?: string | null } | null;
  estimatedAt?: string | null;
  note?: string;
}
