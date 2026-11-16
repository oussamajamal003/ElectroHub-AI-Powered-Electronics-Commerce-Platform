import { describe, expect, it, vi } from 'vitest';
import { brevoDeliveryEvents, classifyDelivery, reconcileDeliveries } from '../commerce-email.delivery.js';

describe('provider delivery classification', () => {
  it('records only final outcomes; a final failure wins over delivered; soft/deferred/open events stay unknown', () => {
    expect(classifyDelivery([{ event: 'requests' }, { event: 'delivered', date: '2026-10-20T18:44:00.000Z' }]))
      .toEqual({ outcome: 'DELIVERED', at: new Date('2026-10-20T18:44:00.000Z') });
    expect(classifyDelivery([{ event: 'delivered' }, { event: 'hardBounces' }])?.outcome).toBe('BOUNCED');
    expect(classifyDelivery([{ event: 'invalid' }])?.outcome).toBe('BOUNCED');
    for (const kind of ['blocked', 'spam', 'error']) expect(classifyDelivery([{ event: kind }])?.outcome).toBe('BLOCKED');
    for (const kind of ['requests', 'softBounces', 'deferred', 'opened', 'clicks']) expect(classifyDelivery([{ event: kind }])).toBeNull();
    expect(classifyDelivery([])).toBeNull();
    expect(classifyDelivery([{ event: 'delivered', date: 'not-a-date' }])).toEqual({ outcome: 'DELIVERED', at: null });
  });
});

describe('delivery reconciliation', () => {
  const now = Date.parse('2026-10-20T19:00:00.000Z');
  const database = (rows: { id: string; providerMessageId: string }[]) => ({ commerceEmailOutbox: {
    findMany: vi.fn().mockResolvedValue(rows), updateMany: vi.fn().mockResolvedValue({ count: 1 }) } });

  it('selects a bounded batch of settled, recently ACCEPTED rows still UNKNOWN, and never touches dispatch state', async () => {
    const db = database([]);
    await reconcileDeliveries(db as never, { events: vi.fn() }, now);
    const query = db.commerceEmailOutbox.findMany.mock.calls[0]![0];
    expect(query.where).toMatchObject({ dispatchState: 'ACCEPTED', deliveryState: 'UNKNOWN', providerMessageId: { not: null } });
    expect(query.where.acceptedAt.lte).toEqual(new Date(now - 60_000));
    expect(query.where.acceptedAt.gte).toEqual(new Date(now - 7 * 86_400_000));
    expect(query.take).toBe(10);
  });

  it('applies a conditional one-way update per final outcome, skips non-final rows, and survives provider failures', async () => {
    const db = database([{ id: 'a', providerMessageId: 'm-a' }, { id: 'b', providerMessageId: 'm-b' }, { id: 'c', providerMessageId: 'm-c' }, { id: 'd', providerMessageId: 'm-d' }]);
    const source = { events: vi.fn(async (id: string) => {
      if (id === 'm-a') return [{ event: 'delivered', date: '2026-10-20T18:50:00.000Z' }];
      if (id === 'm-b') return [{ event: 'hardBounces' }];
      if (id === 'm-c') return [{ event: 'deferred' }];
      throw new Error('BREVO_EVENTS_503');
    }) };
    expect(await reconcileDeliveries(db as never, source, now)).toEqual({ checked: 4, updated: 2, failed: 1 });
    const updates = db.commerceEmailOutbox.updateMany.mock.calls.map(([args]) => args);
    expect(updates).toEqual([
      { where: { id: 'a', deliveryState: 'UNKNOWN' }, data: { deliveryState: 'DELIVERED', deliveredAt: new Date('2026-10-20T18:50:00.000Z') } },
      { where: { id: 'b', deliveryState: 'UNKNOWN' }, data: { deliveryState: 'BOUNCED' } },
    ]);
    for (const [args] of db.commerceEmailOutbox.updateMany.mock.calls) expect(JSON.stringify(args)).not.toMatch(/dispatchState|attempt|lease/);
  });

  it('a row already resolved by another worker is not overwritten (conditional update count 0)', async () => {
    const db = database([{ id: 'a', providerMessageId: 'm-a' }]);
    db.commerceEmailOutbox.updateMany.mockResolvedValue({ count: 0 });
    expect(await reconcileDeliveries(db as never, { events: async () => [{ event: 'delivered' }] }, now)).toEqual({ checked: 1, updated: 0, failed: 0 });
  });
});

describe('Brevo events source', () => {
  it('reads event kinds and dates only and fails on provider errors', async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response(JSON.stringify({ events: [{ event: 'delivered', date: 'd', email: 'x@y.z', subject: 's' }, { foo: 1 }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response('{}', { status: 429 }));
    const source = brevoDeliveryEvents('key', 1000, fetchImpl as never);
    expect(await source.events('<id@x>')).toEqual([{ event: 'delivered', date: 'd' }]);
    expect(String(fetchImpl.mock.calls[0]![0])).toContain('messageId=%3Cid%40x%3E');
    await expect(source.events('m')).rejects.toThrow('BREVO_EVENTS_429');
  });
});
