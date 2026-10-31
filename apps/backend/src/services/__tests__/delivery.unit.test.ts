import { describe, expect, it, vi } from 'vitest';

// Pure domain checks: no database client is created (the test DB guard refuses non-disposable targets).
vi.mock('../../lib/prisma.js', () => ({ prisma: {} }));
import { customerTimeline, trackingReference } from '../delivery.service.js';
import { deliveryUpdateSchema } from '../../validators/delivery.validator.js';

const now = new Date('2026-11-01T12:00:00.000Z');
const schema = deliveryUpdateSchema(() => now);

describe('Task 04.5 delivery domain (unit)', () => {
  it('generates EH-TRK- references from the Crockford alphabet only', () => {
    const seen = new Set(Array.from({ length: 200 }, trackingReference));
    expect(seen.size).toBe(200);
    for (const value of seen) expect(value).toMatch(/^EH-TRK-[0-9A-HJKMNP-TV-Z]{10}$/);
  });

  it('projects one customer entry per visible aspect, never LOCATION, status before ETA within an event', () => {
    const at = new Date('2026-11-01T10:00:00.000Z');
    const entries = customerTimeline([
      { id: 'e4', type: 'LOCATION_UPDATED', changes: ['LOCATION'], toStatus: null, estimatedAt: null, occurredAt: at },
      { id: 'e3', type: 'STATUS_CHANGED', changes: ['STATUS', 'LOCATION', 'ETA'], toStatus: 'OUT_FOR_DELIVERY', estimatedAt: at, occurredAt: at },
      { id: 'e2', type: 'ETA_CLEARED', changes: ['ETA'], toStatus: null, estimatedAt: null, occurredAt: at },
      { id: 'e1', type: 'TRACKING_STARTED', changes: [], toStatus: 'CONFIRMED', estimatedAt: null, occurredAt: at },
    ]);
    expect(entries.map(entry => [entry.id, entry.type])).toEqual([['e3:status', 'STATUS_CHANGED'], ['e3:eta', 'ETA_UPDATED'], ['e2:eta', 'ETA_CLEARED'],
      ['e1', 'TRACKING_STARTED']]);
    expect(customerTimeline(Array.from({ length: 80 }, (_, index) => ({ id: `x${index}`, type: 'ETA_UPDATED' as const, changes: ['ETA' as const],
      toStatus: null, estimatedAt: at, occurredAt: at })))).toHaveLength(50);
  });

  it('validates PATCH bodies strictly (T5-13, T5-15)', () => {
    const ok = (body: unknown) => schema.safeParse(body).success;
    expect(ok({ expectedRevision: 1, status: 'PREPARING' })).toBe(true);
    expect(ok({ expectedRevision: 3, location: { latitude: -90, longitude: 180, label: '  ' } })).toBe(true);
    expect(schema.parse({ expectedRevision: 3, location: { latitude: 1, longitude: 2, label: '  ' } }).location).toEqual({ latitude: 1, longitude: 2, label: null });
    expect(ok({ expectedRevision: 1, location: null })).toBe(true);
    expect(ok({ expectedRevision: 1, estimatedAt: null })).toBe(true);
    expect(ok({ expectedRevision: 1, estimatedAt: '2026-11-01T11:56:00.000Z' })).toBe(true);
    expect(ok({ expectedRevision: 1, estimatedAt: '2026-11-01T11:00:00.000Z' })).toBe(false);
    expect(ok({ expectedRevision: 1, estimatedAt: '2026-12-02T12:00:00.000Z' })).toBe(false);
    expect(ok({ expectedRevision: 1, location: { latitude: 91, longitude: 0 } })).toBe(false);
    expect(ok({ expectedRevision: 1, location: { latitude: 0, longitude: -180.5 } })).toBe(false);
    expect(ok({ expectedRevision: 1, location: { latitude: Number.NaN, longitude: 0 } })).toBe(false);
    expect(ok({ expectedRevision: 1, location: { latitude: 1, longitude: 1, label: 'x'.repeat(81) } })).toBe(false);
    expect(ok({ expectedRevision: 1, note: 'only a note' })).toBe(false);
    expect(ok({ expectedRevision: 1, status: 'CONFIRMED' })).toBe(false);
    expect(ok({ expectedRevision: 1, status: 'PREPARING', note: 'x'.repeat(281) })).toBe(false);
    for (const smuggled of ['userId', 'actorUserId', 'paymentStatus', 'isPaid', 'isSimulated', 'source', 'revisionOverride']) {
      expect(ok({ expectedRevision: 1, status: 'PREPARING', [smuggled]: 'x' }), smuggled).toBe(false);
    }
  });
});
