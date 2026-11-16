import { describe, expect, it } from 'vitest';
import { ApiError } from '@/lib/api';
import { OUT_FOR_DELIVERY_POLL_MS, snapshotPollInterval } from './queries';
import type { CustomerDeliverySnapshot } from './types';

const snapshot = (status: string, availability = 'AVAILABLE') => ({ status, availability }) as CustomerDeliverySnapshot;

describe('snapshotPollInterval (60 s fallback)', () => {
  it('polls an active delivery that is not live', () => expect(snapshotPollInterval(false, snapshot('OUT_FOR_DELIVERY'), null)).toBe(OUT_FOR_DELIVERY_POLL_MS));
  it('stops once live and for finished or unavailable deliveries', () => {
    expect(snapshotPollInterval(true, snapshot('OUT_FOR_DELIVERY'), null)).toBe(false);
    expect(snapshotPollInterval(false, snapshot('DELIVERED'), null)).toBe(false);
    expect(snapshotPollInterval(false, snapshot('PREPARING', 'UNAVAILABLE'), null)).toBe(false);
    expect(snapshotPollInterval(false, undefined, null)).toBe(false);
  });
  it('keeps polling after a transient failure so a failed reconciliation can recover', () => {
    expect(snapshotPollInterval(false, snapshot('PREPARING'), new ApiError(500, 'Something went wrong.'))).toBe(OUT_FOR_DELIVERY_POLL_MS);
    expect(snapshotPollInterval(false, snapshot('PREPARING'), new ApiError(429, 'Too many requests.'))).toBe(OUT_FOR_DELIVERY_POLL_MS);
    expect(snapshotPollInterval(false, snapshot('PREPARING'), new TypeError('Failed to fetch'))).toBe(OUT_FOR_DELIVERY_POLL_MS);
  });
  it('stops on errors a retry cannot fix', () => {
    for (const status of [401, 403, 404]) expect(snapshotPollInterval(false, snapshot('PREPARING'), new ApiError(status, 'x'))).toBe(false);
  });
});
