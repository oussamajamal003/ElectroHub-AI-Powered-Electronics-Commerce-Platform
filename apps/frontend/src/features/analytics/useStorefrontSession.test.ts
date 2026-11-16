import { renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { saveChoice } from '@/features/privacy/consent';
import { HEARTBEAT_MS, useStorefrontSession } from './useStorefrontSession';

let now = 0;
let visibility: DocumentVisibilityState = 'visible';
const fetchMock = vi.fn(() => Promise.resolve(new Response(null, { status: 202 })));
const sent = () => fetchMock.mock.calls.map(call => JSON.parse(((call as unknown as [string, RequestInit])[1].body as string)) as Record<string, unknown>);
const hide = () => { visibility = 'hidden'; document.dispatchEvent(new Event('visibilitychange')); };
const show = () => { visibility = 'visible'; document.dispatchEvent(new Event('visibilitychange')); };

beforeEach(() => {
  now = 0;
  visibility = 'visible';
  window.localStorage.clear();
  window.sessionStorage.clear();
  saveChoice(true);
  fetchMock.mockClear();
  vi.stubGlobal('fetch', fetchMock);
  vi.spyOn(performance, 'now').mockImplementation(() => now);
  vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe('useStorefrontSession', () => {
  it('reports only visible time, as a running total for one random tab id, with no URL or identity', () => {
    renderHook(() => useStorefrontSession());
    now = 30_000; hide();          // 30 s visible
    now = 90_000; show();          // 60 s hidden: not counted
    now = 100_000; hide();         // +10 s visible
    const reports = sent();
    expect(reports.map(report => report.visibleMs)).toEqual([30_000, 40_000]);
    expect(new Set(reports.map(report => report.sessionId)).size).toBe(1);
    expect(Object.keys(reports[0]!).sort()).toEqual(['sessionId', 'type', 'visibleMs']);
    expect((fetchMock.mock.calls[0] as unknown as [string, RequestInit])[1]).toMatchObject({ keepalive: true, credentials: 'omit' });
  });

  it('does not report a glance shorter than a second, and never repeats an unchanged total', () => {
    const { unmount } = renderHook(() => useStorefrontSession());
    now = 400; hide();
    expect(fetchMock).not.toHaveBeenCalled();
    now = 2_000; show();
    now = 3_000; hide();            // 1.4 s total
    unmount();                      // nothing new to add
    expect(sent().map(report => report.visibleMs)).toEqual([1_400]);
  });

  it('reports the running total from a tab that stays open, but not while it is hidden', () => {
    vi.useFakeTimers();
    try {
      renderHook(() => useStorefrontSession());
      now = HEARTBEAT_MS; vi.advanceTimersByTime(HEARTBEAT_MS);
      now = 2 * HEARTBEAT_MS; vi.advanceTimersByTime(HEARTBEAT_MS);
      hide();
      now = 5 * HEARTBEAT_MS; vi.advanceTimersByTime(3 * HEARTBEAT_MS);
      expect(sent().map(report => report.visibleMs)).toEqual([HEARTBEAT_MS, 2 * HEARTBEAT_MS]);
    } finally {
      vi.useRealTimers();
    }
  });
});
