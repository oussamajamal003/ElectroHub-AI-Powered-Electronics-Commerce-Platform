import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { sendRecommendationEvents } from './api';
import { IMPRESSION_DWELL_MS, resetImpressionDedupeForTests, useImpressionTracking } from './tracking';

vi.mock('./api', () => ({ sendRecommendationEvents: vi.fn() }));

// The module batches impressions for 400 ms after the dwell timer fires.
const FLUSH_DELAY_MS = 400;

type Entry = { target: Element; isIntersecting: boolean; intersectionRatio: number };

/** Records instances and lets a test deliver intersection entries explicitly. */
class FakeIntersectionObserver {
  static instances: FakeIntersectionObserver[] = [];
  readonly observed = new Set<Element>();

  constructor(readonly callback: (entries: Entry[]) => void, readonly options?: IntersectionObserverInit) {
    FakeIntersectionObserver.instances.push(this);
  }
  observe(element: Element) { this.observed.add(element); }
  unobserve(element: Element) { this.observed.delete(element); }
  disconnect() { this.observed.clear(); }
  takeRecords() { return []; }
  deliver(entries: Entry[]) { this.callback(entries); }
}

function observerAt(index: number): FakeIntersectionObserver {
  const observer = FakeIntersectionObserver.instances[index];
  if (!observer) throw new Error(`No IntersectionObserver was created at index ${index}`);
  return observer;
}

let visibility: DocumentVisibilityState = 'visible';

function visible(target: Element, ratio = 0.6): Entry {
  return { target, isIntersecting: true, intersectionRatio: ratio };
}
function hiddenEntry(target: Element): Entry {
  return { target, isIntersecting: false, intersectionRatio: 0 };
}

function makeCard(): HTMLElement {
  const element = document.createElement('div');
  document.body.appendChild(element);
  return element;
}

describe('useImpressionTracking', () => {
  const send = vi.mocked(sendRecommendationEvents);

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    resetImpressionDedupeForTests();
    FakeIntersectionObserver.instances = [];
    vi.stubGlobal('IntersectionObserver', FakeIntersectionObserver);
    visibility = 'visible';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete (document as unknown as { visibilityState?: unknown }).visibilityState;
    document.body.innerHTML = '';
  });

  it('creates no observer and sends nothing on click without a token', () => {
    const { result } = renderHook(() => useImpressionTracking(null));
    expect(FakeIntersectionObserver.instances).toHaveLength(0);

    act(() => result.current.click('p1'));
    expect(send).not.toHaveBeenCalled();
  });

  it('counts a card after half of it is visible for the full dwell time, then flushes one batch', () => {
    const { result, unmount } = renderHook(() => useImpressionTracking('tok-visible'));
    const observer = observerAt(0);
    const card = makeCard();
    act(() => { result.current.observe('p1')(card); });
    expect(observer.observed.has(card)).toBe(true);

    act(() => observer.deliver([visible(card, 0.5)]));
    act(() => { vi.advanceTimersByTime(IMPRESSION_DWELL_MS - 1); });
    expect(send).not.toHaveBeenCalled();

    act(() => { vi.advanceTimersByTime(1); });
    act(() => { vi.advanceTimersByTime(FLUSH_DELAY_MS); });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('tok-visible', [{ productId: 'p1', type: 'IMPRESSION' }]);
    unmount();
  });

  it('does not count a card that leaves the viewport before the dwell time', () => {
    const { result, unmount } = renderHook(() => useImpressionTracking('tok-leave'));
    const observer = observerAt(0);
    const card = makeCard();
    act(() => { result.current.observe('p1')(card); });

    act(() => observer.deliver([visible(card)]));
    act(() => { vi.advanceTimersByTime(500); });
    act(() => observer.deliver([hiddenEntry(card)]));
    act(() => { vi.advanceTimersByTime(IMPRESSION_DWELL_MS + FLUSH_DELAY_MS); });

    expect(send).not.toHaveBeenCalled();
    unmount();
  });

  it('does not count a card when the tab is hidden at the end of the dwell time', () => {
    const { result, unmount } = renderHook(() => useImpressionTracking('tok-hidden'));
    const observer = observerAt(0);
    const card = makeCard();
    act(() => { result.current.observe('p1')(card); });

    act(() => observer.deliver([visible(card)]));
    visibility = 'hidden';
    act(() => { vi.advanceTimersByTime(IMPRESSION_DWELL_MS + FLUSH_DELAY_MS); });

    expect(send).not.toHaveBeenCalled();
    unmount();
  });

  it('counts the same token and product only once, across hook instances and repeated visibility', () => {
    const first = renderHook(() => useImpressionTracking('tok-dedupe'));
    const firstObserver = observerAt(0);
    const card = makeCard();
    act(() => { first.result.current.observe('p1')(card); });
    act(() => firstObserver.deliver([visible(card)]));
    act(() => { vi.advanceTimersByTime(IMPRESSION_DWELL_MS + FLUSH_DELAY_MS); });
    expect(send).toHaveBeenCalledTimes(1);

    // Same token and product in a remounted view, and the original card reporting visible again.
    const second = renderHook(() => useImpressionTracking('tok-dedupe'));
    const secondObserver = observerAt(1);
    const remountedCard = makeCard();
    act(() => { second.result.current.observe('p1')(remountedCard); });
    act(() => secondObserver.deliver([visible(remountedCard)]));
    act(() => firstObserver.deliver([visible(card)]));
    act(() => { vi.advanceTimersByTime(IMPRESSION_DWELL_MS + FLUSH_DELAY_MS * 2); });

    expect(send).toHaveBeenCalledTimes(1);
    first.unmount();
    second.unmount();
  });

  it('sends a CLICK immediately for the clicked product', () => {
    const { result, unmount } = renderHook(() => useImpressionTracking('tok-click'));

    act(() => result.current.click('p9'));

    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith('tok-click', [{ productId: 'p9', type: 'CLICK' }]);
    unmount();
  });
});
