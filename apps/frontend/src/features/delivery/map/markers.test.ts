import { describe, expect, it } from 'vitest';
import type { CustomerDeliveryMap } from '../types';
import { buildDeliveryLayers, hasDrawableMap, mapTileConfig, sanitizePath } from './markers';

const origin = { latitude: 33.9, longitude: 35.5, label: 'Hub' };
const location = { latitude: 33.88, longitude: 35.51, label: null, updatedAt: '2026-11-04T10:42:00.000Z', source: 'MANUAL' as const };
const map = (overrides: Partial<CustomerDeliveryMap> = {}): CustomerDeliveryMap =>
  ({ origin, destination: { latitude: 33.87, longitude: 35.52 }, path: [[33.89, 35.5], [33.88, 35.51]], pathKind: 'RECORDED', ...overrides });

describe('Task 04.6 map layers', () => {
  it('T6-01 recorded path → solid line plus origin, destination and courier markers', () => {
    const layers = buildDeliveryLayers({ map: map(), status: 'OUT_FOR_DELIVERY', location, stale: false });
    expect(layers.line).toEqual({ kind: 'recorded', points: [[33.89, 35.5], [33.88, 35.51]] });
    expect(layers.markers.map(marker => marker.kind)).toEqual(['origin', 'destination', 'courier']);
  });

  it('AC3 never draws an origin→destination line, whatever the input', () => {
    for (const pathKind of ['NONE', 'RECORDED', 'SIMULATED_FIXTURE'] as const) {
      const layers = buildDeliveryLayers({ map: map({ path: [], pathKind }), status: 'OUT_FOR_DELIVERY', location: null, stale: false });
      expect(layers.line).toBeNull();
      expect(layers.routeUnavailable).toBe(true);
    }
    const layers = buildDeliveryLayers({ map: map(), status: 'OUT_FOR_DELIVERY', location, stale: false });
    expect(layers.line!.points).not.toContainEqual([origin.latitude, origin.longitude]);
    expect(layers.line!.points).not.toContainEqual([33.87, 35.52]);
  });

  it('T6-03 corrupt points are dropped client-side; nothing valid → route unavailable', () => {
    expect(sanitizePath([[1, 2], [Number.NaN, 1], [91, 0], [0, 181], ['1', 2], [3], null, [4, 5]])).toEqual([[1, 2], [4, 5]]);
    const layers = buildDeliveryLayers({ map: map({ path: [[95, 0], [Number.POSITIVE_INFINITY, 1]] as [number, number][] }), status: 'OUT_FOR_DELIVERY', location, stale: false });
    expect(layers).toMatchObject({ line: null, routeUnavailable: true });
  });

  it('T6-09 simulated fixture → dashed simulated line; stale courier flagged', () => {
    const layers = buildDeliveryLayers({ map: map({ pathKind: 'SIMULATED_FIXTURE' }), status: 'OUT_FOR_DELIVERY', location, stale: true });
    expect(layers.line!.kind).toBe('simulated');
    expect(layers.stale).toBe(true);
  });

  it('T6-02 / AC4 nothing to draw when pathKind is NONE and there is no location (chunk never requested)', () => {
    expect(hasDrawableMap({ status: 'OUT_FOR_DELIVERY', location: null, map: map({ path: [], pathKind: 'NONE' }) })).toBe(false);
    expect(hasDrawableMap({ status: 'PREPARING', location: null, map: map({ path: [], pathKind: 'NONE' }) })).toBe(false);
    expect(hasDrawableMap({ status: 'OUT_FOR_DELIVERY', location: null, map: null })).toBe(false);
    expect(hasDrawableMap({ status: 'OUT_FOR_DELIVERY', location: null, map: undefined })).toBe(false);
    expect(hasDrawableMap({ status: 'OUT_FOR_DELIVERY', location, map: map({ path: [], pathKind: 'NONE' }) })).toBe(true);
    expect(hasDrawableMap({ status: 'OUT_FOR_DELIVERY', location: null, map: map() })).toBe(true);
  });

  it('tile config: both variables required, XYZ over https or loopback http only', () => {
    expect(mapTileConfig({})).toBeNull();
    expect(mapTileConfig({ VITE_MAP_TILE_URL: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png' })).toBeNull();
    expect(mapTileConfig({ VITE_MAP_TILE_URL: 'http://tiles.example/{z}/{x}/{y}.png', VITE_MAP_ATTRIBUTION: 'x' })).toBeNull();
    expect(mapTileConfig({ VITE_MAP_TILE_URL: 'https://tiles.example/static.png', VITE_MAP_ATTRIBUTION: 'x' })).toBeNull();
    expect(mapTileConfig({ VITE_MAP_TILE_URL: 'http://127.0.0.1:4599/{z}/{x}/{y}.png', VITE_MAP_ATTRIBUTION: '© OSM' }))
      .toEqual({ url: 'http://127.0.0.1:4599/{z}/{x}/{y}.png', attribution: '© OSM', attributionUrl: 'https://www.openstreetmap.org/copyright' });
    expect(mapTileConfig({ VITE_MAP_TILE_URL: 'https://t.example/{z}/{x}/{y}.png', VITE_MAP_ATTRIBUTION: '© Provider', VITE_MAP_ATTRIBUTION_URL: 'https://t.example/terms' })!
      .attributionUrl).toBe('https://t.example/terms');
    expect(mapTileConfig({ VITE_MAP_TILE_URL: 'https://t.example/{z}/{x}/{y}.png', VITE_MAP_ATTRIBUTION: 'x', VITE_MAP_ATTRIBUTION_URL: 'javascript:alert(1)' })).toBeNull();
  });
});
