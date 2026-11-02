import { act, renderHook } from '@testing-library/react';
import L from 'leaflet';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useLeafletMap } from './useLeafletMap';

/** The real Leaflet map, built in jsdom: wheel zoom is on by default and the mobile "Explore map" gate switches it (and the other gestures) off and on. */
function mount() {
  const element = document.createElement('div');
  document.body.append(element);
  const maps: L.Map[] = [];
  const original = L.map;
  vi.spyOn(L, 'map').mockImplementation((...args: Parameters<typeof L.map>) => { const map = original(...args); maps.push(map); return map; });
  const hook = renderHook(() => useLeafletMap({ current: element }, { tiles: { url: 'https://tiles.test/{z}/{x}/{y}.png', attribution: 'test' },
    layers: { line: null, markers: [], stale: false }, classes: {}, label: 'Delivery map', describedBy: 'map-help', onError: vi.fn() }));
  return { ...hook, map: maps[0], element };
}

describe('useLeafletMap wheel zoom', () => {
  afterEach(() => { vi.restoreAllMocks(); document.body.innerHTML = ''; });

  it('zooms with the plain mouse wheel by default', () => {
    const { map } = mount();
    expect(map.scrollWheelZoom.enabled()).toBe(true);
  });

  it('the mobile Explore gate disables wheel zoom and the other gestures, and re-enables them on opt-in', () => {
    const { map, result } = mount();
    const handlers = [map.dragging, map.touchZoom, map.scrollWheelZoom, map.doubleClickZoom, map.boxZoom, map.keyboard];
    act(() => result.current.setInteractive(false));
    expect(handlers.map(handler => handler.enabled())).toEqual(handlers.map(() => false));
    expect(map.getContainer().tabIndex).toBe(-1);
    act(() => result.current.setInteractive(true));
    expect(handlers.map(handler => handler.enabled())).toEqual(handlers.map(() => true));
    expect(map.getContainer().tabIndex).toBe(0);
  });
});
