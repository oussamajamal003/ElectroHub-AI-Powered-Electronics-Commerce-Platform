import { describe, expect, it } from 'vitest';
import { parseDeliveryOrigin } from '../../config/delivery-map.config.js';
import { buildDeliveryMap, MAP_PATH_LIMIT } from '../delivery-map.projection.js';

const origin = { latitude: 33.9, longitude: 35.5, label: 'Demo hub' };
const none = { latitude: null, longitude: null };

describe('Task 04.6 DeliveryMapProjection', () => {
  it('rounds the stored destination to 3 dp and never invents one', () => {
    expect(buildDeliveryMap({ origin, shipping: { latitude: 33.123456, longitude: 35.987654 }, points: [], isSimulated: false }).destination)
      .toEqual({ latitude: 33.123, longitude: 35.988 });
    expect(buildDeliveryMap({ origin, shipping: none, points: [], isSimulated: false }).destination).toBeNull();
  });

  it('T6-03 drops corrupt points and reports NONE when nothing valid remains', () => {
    const map = buildDeliveryMap({ origin, shipping: none, isSimulated: false,
      points: [{ latitude: 91, longitude: 0 }, { latitude: Number.NaN, longitude: 1 }, { latitude: 1, longitude: null }, { latitude: 10, longitude: 20 }] });
    expect(map).toMatchObject({ path: [[10, 20]], pathKind: 'RECORDED' });
    expect(buildDeliveryMap({ origin, shipping: none, isSimulated: false, points: [{ latitude: 0, longitude: 181 }] }).pathKind).toBe('NONE');
  });

  it('AC3 the path holds recorded points only: never the origin or the destination', () => {
    const map = buildDeliveryMap({ origin, shipping: { latitude: 34, longitude: 36 }, isSimulated: false, points: [] });
    expect(map).toMatchObject({ path: [], pathKind: 'NONE' });
  });

  it('keeps the newest points oldest-first and bounds the path at 200', () => {
    const points = Array.from({ length: 250 }, (_, index) => ({ latitude: index / 10, longitude: 1 }));
    const map = buildDeliveryMap({ origin, shipping: none, isSimulated: false, points });
    expect(map.path).toHaveLength(MAP_PATH_LIMIT);
    expect(map.path[0]).toEqual([5, 1]);
    expect(map.path.at(-1)).toEqual([24.9, 1]);
  });

  it('T6-09 a simulated delivery draws only simulation points as SIMULATED_FIXTURE; real points never join it', () => {
    const points = [{ latitude: 1, longitude: 1 }, { latitude: 2, longitude: 2, simulated: true }];
    expect(buildDeliveryMap({ origin, shipping: none, isSimulated: true, points })).toMatchObject({ path: [[2, 2]], pathKind: 'SIMULATED_FIXTURE' });
    expect(buildDeliveryMap({ origin, shipping: none, isSimulated: false, points })).toMatchObject({ path: [[1, 1]], pathKind: 'RECORDED' });
    expect(buildDeliveryMap({ origin, shipping: none, isSimulated: true, points: [{ latitude: 1, longitude: 1 }] }).pathKind).toBe('NONE');
  });
});

describe('Task 04.6 DELIVERY_ORIGIN_* configuration', () => {
  it('is off when unset and parsed when complete', () => {
    expect(parseDeliveryOrigin({})).toBeNull();
    expect(parseDeliveryOrigin({ DELIVERY_ORIGIN_LAT: '33.9', DELIVERY_ORIGIN_LNG: '35.5', DELIVERY_ORIGIN_LABEL: ' Demo hub ' })).toEqual(origin);
  });
  it('refuses partial or out-of-range values without echoing them', () => {
    expect(() => parseDeliveryOrigin({ DELIVERY_ORIGIN_LAT: '33.9' })).toThrow(/DELIVERY_ORIGIN_LNG/);
    expect(() => parseDeliveryOrigin({ DELIVERY_ORIGIN_LAT: '95.123', DELIVERY_ORIGIN_LNG: '1', DELIVERY_ORIGIN_LABEL: 'x' })).toThrow(/^(?!.*95\.123).*DELIVERY_ORIGIN_LAT/);
    expect(() => parseDeliveryOrigin({ DELIVERY_ORIGIN_LAT: 'abc', DELIVERY_ORIGIN_LNG: '1', DELIVERY_ORIGIN_LABEL: 'x' })).toThrow();
  });
});
