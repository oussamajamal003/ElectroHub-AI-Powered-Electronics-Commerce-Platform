import type { PrismaClient } from '@prisma/client';

/**
 * Task 04.0 delivery tracking. Provider ACCEPTANCE is not delivery: an accepted row stays deliveryState UNKNOWN until the provider's own
 * event log reports a final outcome. This reconciler reads provider events for a bounded batch of recently accepted rows and records
 * DELIVERED / BOUNCED / BLOCKED with a conditional one-way update (UNKNOWN -> outcome). It never sends, resends or touches dispatch state.
 */
export interface ProviderDeliveryEvent { event: string; date?: string }
export interface DeliveryEventSource { events(providerMessageId: string): Promise<ProviderDeliveryEvent[]> }
export type DeliveryOutcome = 'DELIVERED' | 'BOUNCED' | 'BLOCKED';

export const DELIVERY_SYNC_INTERVAL_MS = 60_000;
const SETTLE_MS = 60_000;
const LOOKBACK_MS = 7 * 24 * 60 * 60 * 1000;
const BATCH = 10;

/** Final outcomes only; soft bounces / deferrals / opens are not final and keep UNKNOWN. A final failure wins over a delivered event. */
export function classifyDelivery(events: ProviderDeliveryEvent[]): { outcome: DeliveryOutcome; at: Date | null } | null {
  const of = (kinds: string[]) => events.find(item => kinds.includes(item.event));
  const at = (item?: ProviderDeliveryEvent) => { const value = item?.date ? new Date(item.date) : null; return value && Number.isFinite(value.getTime()) ? value : null; };
  const bounced = of(['hardBounces', 'invalid']);
  if (bounced) return { outcome: 'BOUNCED', at: at(bounced) };
  const blocked = of(['blocked', 'spam', 'error']);
  if (blocked) return { outcome: 'BLOCKED', at: at(blocked) };
  const delivered = of(['delivered']);
  return delivered ? { outcome: 'DELIVERED', at: at(delivered) } : null;
}

type DeliveryDatabase = Pick<PrismaClient, 'commerceEmailOutbox'>;
export async function reconcileDeliveries(database: DeliveryDatabase, source: DeliveryEventSource, now = Date.now()) {
  const rows = await database.commerceEmailOutbox.findMany({
    where: { dispatchState: 'ACCEPTED', deliveryState: 'UNKNOWN', providerMessageId: { not: null },
      acceptedAt: { gte: new Date(now - LOOKBACK_MS), lte: new Date(now - SETTLE_MS) } },
    orderBy: { acceptedAt: 'asc' }, take: BATCH, select: { id: true, providerMessageId: true },
  });
  let updated = 0; let failed = 0;
  for (const row of rows) {
    let events: ProviderDeliveryEvent[];
    try { events = await source.events(row.providerMessageId!); } catch { failed++; continue; }
    const result = classifyDelivery(events);
    if (!result) continue;
    const change = await database.commerceEmailOutbox.updateMany({ where: { id: row.id, deliveryState: 'UNKNOWN' },
      data: { deliveryState: result.outcome, ...(result.outcome === 'DELIVERED' ? { deliveredAt: result.at ?? new Date(now) } : {}) } });
    updated += change.count;
  }
  return { checked: rows.length, updated, failed };
}

/** Brevo transactional events API (read-only). Returns event kinds and dates only. */
export function brevoDeliveryEvents(apiKey: string, timeoutMs = 15_000, fetchImpl: typeof fetch = fetch): DeliveryEventSource {
  return {
    async events(providerMessageId) {
      const url = `https://api.brevo.com/v3/smtp/statistics/events?limit=50&messageId=${encodeURIComponent(providerMessageId)}`;
      const response = await fetchImpl(url, { headers: { accept: 'application/json', 'api-key': apiKey }, signal: AbortSignal.timeout(timeoutMs) });
      if (!response.ok) throw new Error(`BREVO_EVENTS_${response.status}`);
      const body = await response.json() as { events?: { event?: unknown; date?: unknown }[] };
      return (body.events ?? []).filter(item => typeof item.event === 'string')
        .map(item => ({ event: item.event as string, ...(typeof item.date === 'string' ? { date: item.date } : {}) }));
    },
  };
}
