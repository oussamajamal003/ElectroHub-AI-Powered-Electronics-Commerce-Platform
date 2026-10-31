import { CheckCircle2, PackageCheck, PackageOpen, Truck, type LucideIcon } from 'lucide-react';
import type { CustomerDeliverySnapshot, DeliveryStage, DeliveryTimelineEntry } from './types';

const TRACKABLE = ['CONFIRMED', 'PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED'];
/** Paid orders with a fulfillment status may be tracked (handoff §6.1). A paid order without a Delivery still opens a truthful page. */
export const canTrackDelivery = (status: string, paymentState: string) => paymentState === 'PAID' && TRACKABLE.includes(status);

/** Same icons as the shipped OrderStatus badge, so a stage looks the same everywhere. */
export const STAGES: { key: DeliveryStage; label: string; title: string; description: string; icon: LucideIcon }[] = [
  { key: 'CONFIRMED', label: 'Confirmed', title: 'Order confirmed', icon: PackageCheck,
    description: 'Your payment is confirmed and your order is queued. Detailed tracking appears once we start preparing it.' },
  { key: 'PREPARING', label: 'Preparing', title: 'Preparing your order', icon: PackageOpen,
    description: 'Your items are being checked and packed at our dispatch hub.' },
  { key: 'OUT_FOR_DELIVERY', label: 'Out for delivery', title: 'Out for delivery', icon: Truck, description: 'Your order has left the dispatch hub.' },
  { key: 'DELIVERED', label: 'Delivered', title: 'Delivered', icon: CheckCircle2, description: 'Your order was delivered.' },
];

export const stageIndex = (status: string) => Math.max(0, STAGES.findIndex(stage => stage.key === status));
export const stageOf = (status: string) => STAGES[stageIndex(status)]!;

/** A location older than this while out for delivery is labelled stale (judged from server time, not the device clock). */
export const STALE_AFTER_MINUTES = 30;
export const minutesBetween = (from: string, to: string) => Math.max(0, Math.floor((new Date(to).getTime() - new Date(from).getTime()) / 60_000));
export function locationFreshness(snapshot: Pick<CustomerDeliverySnapshot, 'location' | 'serverTime' | 'status'>) {
  if (!snapshot.location) return null;
  const minutes = minutesBetween(snapshot.location.updatedAt, snapshot.serverTime);
  return { minutes, stale: snapshot.status === 'OUT_FOR_DELIVERY' && minutes > STALE_AFTER_MINUTES };
}
export function ageLabel(minutes: number) {
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours} h ago` : `${Math.floor(hours / 24)} d ago`;
}

/** Real timestamps use the viewer's locale and time zone. Checkout promise dates stay UTC calendar days (formatEstimate). */
export const formatDay = (value: string) => new Intl.DateTimeFormat('en-US', { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(value));
export const formatTime = (value: string) => new Intl.DateTimeFormat('en-US', { hour: 'numeric', minute: '2-digit' }).format(new Date(value));
export const formatStamp = (value: string) => `${new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' }).format(new Date(value))} · ${formatTime(value)}`;
export const formatStampWithZone = (value: string) =>
  `${formatStamp(value)} ${new Intl.DateTimeFormat('en-US', { timeZoneName: 'short' }).formatToParts(new Date(value)).find(part => part.type === 'timeZoneName')?.value ?? ''}`.trim();

/** The newest recorded fact: a timeline entry or the latest location update. Never invented. */
export function latestUpdate(snapshot: Pick<CustomerDeliverySnapshot, 'timeline' | 'location'>) {
  const candidates = [snapshot.timeline[0]?.occurredAt, snapshot.location?.updatedAt].filter((value): value is string => Boolean(value));
  return candidates.sort().at(-1) ?? null;
}

/** When each stage was actually recorded (TRACKING_STARTED or STATUS_CHANGED rows only). */
export function stageTimes(timeline: DeliveryTimelineEntry[]) {
  const times: Partial<Record<DeliveryStage, string>> = {};
  for (const entry of [...timeline].reverse()) {
    if ((entry.type === 'TRACKING_STARTED' || entry.type === 'STATUS_CHANGED') && entry.status && entry.status in { CONFIRMED: 1, PREPARING: 1, OUT_FOR_DELIVERY: 1, DELIVERED: 1 }) {
      times[entry.status as DeliveryStage] ??= entry.occurredAt;
    }
  }
  return times;
}

const STATUS_COPY: Record<string, string> = {
  CONFIRMED: 'Your order is confirmed.', PREPARING: 'We started preparing your order.',
  OUT_FOR_DELIVERY: 'Your order left the dispatch hub.', DELIVERED: 'Your order was delivered.',
};
export function eventCopy(entry: DeliveryTimelineEntry, trackingReference: string | null) {
  if (entry.type === 'TRACKING_STARTED') {
    const stage = entry.status && entry.status !== 'CONFIRMED' ? ` while your order was ${stageOf(entry.status).label.toLowerCase()}` : '';
    return { title: 'Tracking started', description: trackingReference ? `Tracking reference ${trackingReference} assigned${stage}.` : `Tracking started${stage}.` };
  }
  if (entry.type === 'STATUS_CHANGED') return { title: stageOf(entry.status ?? '').label, description: STATUS_COPY[entry.status ?? ''] ?? 'Delivery status updated.' };
  if (entry.type === 'ETA_UPDATED' && entry.estimatedAt) {
    return { title: 'Estimated arrival updated', description: `${new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'short', day: 'numeric' })
      .format(new Date(entry.estimatedAt))}, around ${formatTime(entry.estimatedAt)}.` };
  }
  return { title: 'Estimated arrival removed', description: 'We will show a new estimate once one is recorded. The checkout window still applies.' };
}
