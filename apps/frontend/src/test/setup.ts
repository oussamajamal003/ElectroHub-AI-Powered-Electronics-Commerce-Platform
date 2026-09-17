import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// Automatically cleanup DOM after each test
afterEach(() => {
  cleanup();
});

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
