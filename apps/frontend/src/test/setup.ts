import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup, configure } from '@testing-library/react';

// findBy*/waitFor default to 1 s. Lazy routes and React Query settle well inside that alone, but the full suite runs ~160 files in
// parallel workers and a busy machine pushed a few of them past 1 s (routing home heading, checkout, settings). 5 s keeps a
// real hang failing fast while removing load-dependent flakes; the per-test limit stays 60 s.
configure({ asyncUtilTimeout: 5000 });

// Automatically cleanup DOM after each test
afterEach(() => {
  cleanup();
});

// jsdom does not implement scrolling; the admin layout scrolls to the top on navigation.
if (typeof window !== 'undefined') window.scrollTo = (() => undefined) as typeof window.scrollTo;

// Mock ResizeObserver
global.ResizeObserver = class ResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
};

// Mock PointerEvent for Radix UI
if (typeof window !== 'undefined') {
  class MockPointerEvent extends Event {
    button: number;
    ctrlKey: boolean;
    pointerType: string;
    pointerId: number;
    isPrimary: boolean;

    constructor(type: string, props: PointerEventInit = {}) {
      super(type, props);
      this.button = props.button || 0;
      this.ctrlKey = props.ctrlKey || false;
      this.pointerType = props.pointerType || 'mouse';
      this.pointerId = props.pointerId || 1;
      this.isPrimary = props.isPrimary !== false;
    }
  }
  (window as unknown as { PointerEvent: typeof MockPointerEvent }).PointerEvent = MockPointerEvent;
  window.HTMLElement.prototype.scrollIntoView = function() {};
  window.HTMLElement.prototype.hasPointerCapture = function() { return false; };
  window.HTMLElement.prototype.releasePointerCapture = function() {};

  // jsdom has no top layer, so `:modal` / `:fullscreen` can never match. nwsapi 2.2.27 nevertheless resolves them by
  // re-entering element.matches() until the stack overflows (then swallows the error): ~0.6 s per call. floating-ui's
  // isTopLayer() (Radix Popper: Select, Tooltip, DropdownMenu) asks `:modal` repeatedly while positioning, which pushed
  // single Select/Tooltip tests past the 60 s timeout. Answer these exact, never-matching probes directly.
  const nativeMatches = window.Element.prototype.matches;
  window.Element.prototype.matches = function(this: Element, selector: string) {
    if (selector === ':modal' || selector === ':fullscreen') return false;
    return nativeMatches.call(this, selector);
  };
}


// Mock matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});
