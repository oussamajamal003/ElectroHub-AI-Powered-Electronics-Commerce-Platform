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
  /** Task 04.6 (architecture §7.3). Absent from 04.5 servers; null when no hub is configured or the order is not trackable. */
  map?: CustomerDeliveryMap | null;
}

export type DeliveryMapPathKind = 'RECORDED' | 'SIMULATED_FIXTURE' | 'NONE';
export interface CustomerDeliveryMap {
  origin: { latitude: number; longitude: number; label: string };
  destination: { latitude: number; longitude: number } | null;
  /** [latitude, longitude] recorded positions, oldest first, at most 200. */
  path: [number, number][];
  pathKind: DeliveryMapPathKind;
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
  deliveryMethod: 'STANDARD' | 'EXPRESS' | 'OVERNIGHT';
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

/** Task 04.7 `GET|POST|DELETE /api/admin/orders/:orderReference/delivery/simulation`. */
export type DeliverySimulationReason = 'FEATURE_DISABLED' | 'QA_SCOPE' | 'ORDER_NOT_FOUND' | 'ORDER_CANCELLED' | 'PAYMENT_INELIGIBLE' | 'NOT_OUT_FOR_DELIVERY' | 'DELIVERY_NOT_STARTED';
export interface DeliverySimulationStatus {
  enabled: boolean;
  /** Why Start is unavailable for this delivery; null when enabled. */
  reason: DeliverySimulationReason | null;
  running: boolean;
  routeId: string | null;
  ticks: number;
  maxTicks: number;
  tickSeconds: number;
  routes: { id: string; label: string; points: number }[];
}

/** Task 04.7 socket events, v1 (architecture §8.3). The snapshot omits the timeline and the recorded map path (clients append). */
export type DeliveryLiveChange = 'status' | 'location' | 'eta' | 'tracking' | 'simulation';
export interface DeliveryUpdatedEvent {
  v: 1;
  orderReference: string;
  revision: number;
  occurredAt: string;
  changed: DeliveryLiveChange[];
  snapshot: Omit<CustomerDeliverySnapshot, 'timeline' | 'map'> & { map?: Omit<CustomerDeliveryMap, 'path'> | null };
  timelineEntry: DeliveryTimelineEntry | null;
  /** Additive to v1: every customer-visible entry of the event (status and ETA can change together). */
  timelineEntries?: DeliveryTimelineEntry[];
  source: 'ADMIN' | 'SIMULATION';
}
export interface DeliveryRevokedEvent { v: 1; orderReference: string; reason: 'ACCESS_REVOKED' | 'ORDER_CANCELLED' }
