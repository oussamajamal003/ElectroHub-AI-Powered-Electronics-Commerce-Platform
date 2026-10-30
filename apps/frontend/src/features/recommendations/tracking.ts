import { useCallback, useEffect, useRef } from 'react';
import { sendRecommendationEvents } from './api';

export const IMPRESSION_VISIBLE_RATIO = 0.5;
export const IMPRESSION_DWELL_MS = 1000;
const FLUSH_DELAY_MS = 400;

// Module scope: a card counted once in this page session is not counted again on re-render, remount or refetch.
const sent = new Set<string>();
export function resetImpressionDedupeForTests() { sent.clear(); }

/**
 * Viewable-impression tracking for one server-issued batch: a card counts after at least half of it stays on screen for
 * one second while the tab is visible. Rendering, off-screen cards and hidden tabs never count. Events are batched and
 * sent without blocking anything; without a token (e.g. NO_DATA) nothing is tracked.
 */
export function useImpressionTracking(token: string | null) {
  const timers = useRef(new Map<Element, ReturnType<typeof setTimeout>>());
  const ids = useRef(new Map<Element, string>());
  const inViewport = useRef(new Set<Element>());
  const queue = useRef<string[]>([]);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const observer = useRef<IntersectionObserver | null>(null);

  const flush = useCallback(() => {
    flushTimer.current = null;
    if (!token || queue.current.length === 0) return;
    sendRecommendationEvents(token, queue.current.splice(0).map(productId => ({ productId, type: 'IMPRESSION' as const })));
  }, [token]);

  useEffect(() => {
    if (!token || typeof IntersectionObserver === 'undefined') return;
    const pending = timers.current;
    const viewport = inViewport.current;
    const startDwell = (element: Element) => {
      const productId = ids.current.get(element);
      if (!productId || document.visibilityState !== 'visible' || pending.has(element)) return;
      const key = `${token}:${productId}`;
      if (sent.has(key)) return;
      pending.set(element, setTimeout(() => {
        pending.delete(element);
        if (document.visibilityState !== 'visible' || !viewport.has(element) || sent.has(key)) return;
        sent.add(key);
        queue.current.push(productId);
        flushTimer.current ??= setTimeout(flush, FLUSH_DELAY_MS);
      }, IMPRESSION_DWELL_MS));
    };
    observer.current = new IntersectionObserver(entries => {
      for (const entry of entries) {
        const productId = ids.current.get(entry.target);
        if (!productId) continue;
        if (entry.isIntersecting && entry.intersectionRatio >= IMPRESSION_VISIBLE_RATIO) {
          viewport.add(entry.target);
          startDwell(entry.target);
        } else {
          viewport.delete(entry.target);
          clearTimeout(pending.get(entry.target));
          pending.delete(entry.target);
        }
      }
    }, { threshold: [IMPRESSION_VISIBLE_RATIO] });
    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        for (const element of viewport) startDwell(element);
      } else {
        for (const timer of pending.values()) clearTimeout(timer);
        pending.clear();
      }
    };
    document.addEventListener('visibilitychange', onVisibilityChange);
    for (const element of ids.current.keys()) observer.current.observe(element);
    return () => {
      observer.current?.disconnect();
      observer.current = null;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      viewport.clear();
      for (const timer of pending.values()) clearTimeout(timer);
      pending.clear();
      if (flushTimer.current) { clearTimeout(flushTimer.current); flush(); }
    };
  }, [flush, token]);

  // One stable ref callback per product, so re-renders do not detach/re-attach (and restart the dwell timer).
  const elements = useRef(new Map<string, HTMLElement>());
  const callbacks = useRef(new Map<string, (element: HTMLElement | null) => void>());
  const observe = useCallback((productId: string) => {
    let callback = callbacks.current.get(productId);
    if (!callback) {
      callback = (element: HTMLElement | null) => {
        const previous = elements.current.get(productId);
        if (previous && previous !== element) {
          observer.current?.unobserve(previous);
          clearTimeout(timers.current.get(previous));
          timers.current.delete(previous);
          inViewport.current.delete(previous);
          ids.current.delete(previous);
          elements.current.delete(productId);
        }
        if (!element || previous === element) return;
        elements.current.set(productId, element);
        ids.current.set(element, productId);
        observer.current?.observe(element);
      };
      callbacks.current.set(productId, callback);
    }
    return callback;
  }, []);

  /** A click is attributed immediately (keepalive), never delaying navigation. */
  const click = useCallback((productId: string) => {
    if (token) sendRecommendationEvents(token, [{ productId, type: 'CLICK' }]);
  }, [token]);

  return { observe, click };
}
