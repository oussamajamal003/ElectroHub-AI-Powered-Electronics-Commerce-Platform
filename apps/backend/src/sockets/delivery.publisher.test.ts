import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DeliveryService } from '../services/delivery.service.js';
import type { DeliveryGateway } from './delivery.gateway.js';
import { DeliveryPublisher } from './delivery.publisher.js';

vi.mock('../lib/prisma.js', () => ({ prisma: {} }));
vi.mock('../utils/logger.js', () => ({ logSafely: vi.fn() }));
vi.mock('../services/delivery.service.js', () => ({ DeliveryService: class {} }));

/**
 * Task 06.1 R-5: publishes are fire-and-forget and each reads the projection asynchronously. A slow read for an earlier commit must not
 * let a later commit's event overtake it.
 */
const deferred = <T>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };
const projection = (revision: number) => ({ orderReference: 'ORD-1', revision, occurredAt: new Date(0).toISOString(), snapshot: { revision },
  timelineEntries: [], source: 'ADMIN' });

const setup = (reads: Promise<unknown>[]) => {
  const emitted: { room: string; revision: number }[] = [];
  const namespace = { to: (room: string) => ({ emit: (_: string, payload: { revision: number }) => { emitted.push({ room, revision: payload.revision }); } }) };
  const getRealtimeProjection = vi.fn(() => reads.shift()!);
  DeliveryPublisher.attach({ namespace } as unknown as DeliveryGateway, { getRealtimeProjection } as unknown as DeliveryService);
  return { emitted, getRealtimeProjection };
};

afterEach(() => { DeliveryPublisher.attach(null); });

describe('DeliveryPublisher ordering', () => {
  it('emits one order\'s events in commit order even when the earlier read resolves last', async () => {
    const slow = deferred<unknown>();
    const { emitted, getRealtimeProjection } = setup([slow.promise, Promise.resolve(projection(4))]);
    const first = DeliveryPublisher.afterCommit('order-a', ['location']);
    const second = DeliveryPublisher.afterCommit('order-a', ['simulation']);
    await Promise.resolve();
    // The second read has not started: it waits for the first emit.
    expect(getRealtimeProjection).toHaveBeenCalledTimes(1);
    slow.resolve(projection(3));
    await Promise.all([first, second]);
    expect(emitted.map(event => event.revision)).toEqual([3, 4]);
  });

  it('a failed publish does not stall the next one for the same order', async () => {
    const { emitted } = setup([Promise.reject(new Error('db down')), Promise.resolve(projection(5))]);
    await expect(DeliveryPublisher.afterCommit('order-a', ['eta'])).resolves.toBeUndefined();
    await DeliveryPublisher.afterCommit('order-a', ['eta']);
    expect(emitted.map(event => event.revision)).toEqual([5]);
  });

  it('different orders are not queued behind each other', async () => {
    const slow = deferred<unknown>();
    const { emitted } = setup([slow.promise, Promise.resolve({ ...projection(1), orderReference: 'ORD-2' })]);
    const blocked = DeliveryPublisher.afterCommit('order-a', ['status']);
    await DeliveryPublisher.afterCommit('order-b', ['status']);
    expect(emitted).toEqual([{ room: expect.stringContaining('order-b'), revision: 1 }]);
    slow.resolve(projection(2));
    await blocked;
    expect(emitted.map(event => event.revision)).toEqual([1, 2]);
  });

  it('does nothing without a gateway or without changes', async () => {
    const { getRealtimeProjection } = setup([]);
    await DeliveryPublisher.afterCommit('order-a', []);
    DeliveryPublisher.attach(null);
    await DeliveryPublisher.afterCommit('order-a', ['status']);
    expect(getRealtimeProjection).not.toHaveBeenCalled();
  });
});
