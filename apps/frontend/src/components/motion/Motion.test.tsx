import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BenefitsReveal, SectionReveal, StaggerContainer, StaggerItem } from './Motion';

type Entry = Partial<IntersectionObserverEntry>;

function mockObserver() {
  const state: { callback?: IntersectionObserverCallback; disconnect: () => void; created: number } = { disconnect: vi.fn() as () => void, created: 0 };
  window.IntersectionObserver = class {
    constructor(next: IntersectionObserverCallback) { state.callback = next; state.created += 1; }
    observe() {}
    disconnect = state.disconnect;
    unobserve() {}
    takeRecords() { return []; }
    root = null;
    rootMargin = '';
    thresholds = [];
  };
  const emit = (entry: Entry) => act(() => state.callback?.([entry as IntersectionObserverEntry], {} as IntersectionObserver));
  return { state, emit };
}

describe('section motion', () => {
  const originalObserver = window.IntersectionObserver;
  const originalMatchMedia = window.matchMedia;
  afterEach(() => {
    if (originalObserver) window.IntersectionObserver = originalObserver;
    else delete (window as { IntersectionObserver?: typeof IntersectionObserver }).IntersectionObserver;
    window.matchMedia = originalMatchMedia;
    vi.restoreAllMocks();
  });

  it('reveals once and never hides or replays on later scroll changes in either direction', () => {
    const { state, emit } = mockObserver();
    render(<SectionReveal><h2>Heading</h2></SectionReveal>);
    const wrapper = screen.getByRole('heading', { name: 'Heading' }).parentElement!;
    expect(wrapper.className).toContain('pending');
    emit({ isIntersecting: true });
    expect(wrapper.className).toContain('visible');
    expect(wrapper.className).not.toContain('pending');
    expect(state.disconnect).toHaveBeenCalled();
    // Scrolling back up past it (exit through the bottom) or down past it (exit through the top) are both no-ops: the observer is gone.
    emit({ isIntersecting: false, boundingClientRect: { bottom: 900, top: 800 } as DOMRect });
    emit({ isIntersecting: false, boundingClientRect: { bottom: -50, top: -300 } as DOMRect });
    expect(wrapper.className).toContain('visible');
    expect(wrapper.className).not.toContain('pending');
    expect(state.created).toBe(1);
  });

  it('settles a section that is already above the viewport without animating or hiding it', () => {
    const { emit } = mockObserver();
    render(<SectionReveal><h2>Above</h2></SectionReveal>);
    const wrapper = screen.getByRole('heading', { name: 'Above' }).parentElement!;
    emit({ isIntersecting: false, boundingClientRect: { bottom: -20, top: -400 } as DOMRect });
    expect(wrapper.className).not.toContain('pending');
    expect(wrapper.className).not.toContain('visible');
  });

  it('keeps a section pending while it is merely below the viewport', () => {
    const { emit } = mockObserver();
    render(<SectionReveal><h2>Below</h2></SectionReveal>);
    const wrapper = screen.getByRole('heading', { name: 'Below' }).parentElement!;
    emit({ isIntersecting: false, boundingClientRect: { bottom: 1400, top: 1200 } as DOMRect });
    expect(wrapper.className).toContain('pending');
  });

  it('keeps semantic content in the DOM while stagger is pending', () => {
    render(<StaggerContainer><StaggerItem>Product</StaggerItem></StaggerContainer>);
    expect(screen.getByText('Product')).toBeInTheDocument();
  });

  it('keeps staggered cards mounted across viewport changes', () => {
    const { emit } = mockObserver();
    const mounted = vi.fn();
    function Card() { mounted(); return <button>Product</button>; }
    render(<StaggerContainer><StaggerItem><Card /></StaggerItem></StaggerContainer>);
    const button = screen.getByRole('button', { name: 'Product' });
    emit({ isIntersecting: true });
    emit({ isIntersecting: false, boundingClientRect: { bottom: 900, top: 800 } as DOMRect });
    emit({ isIntersecting: true });
    expect(screen.getByRole('button', { name: 'Product' })).toBe(button);
    expect(mounted).toHaveBeenCalledTimes(1); // never remounted
  });

  it('shows content immediately with reduced motion', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true });
    render(<SectionReveal><h2>Visible heading</h2></SectionReveal>);
    expect(screen.getByRole('heading', { name: 'Visible heading' }).parentElement?.className).not.toContain('pending');
  });

  describe('BenefitsReveal', () => {
    function setup() {
      window.matchMedia = vi.fn().mockReturnValue({ matches: false });
      let nextFrame: FrameRequestCallback | undefined;
      vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { nextFrame = callback; return 1; });
      vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
      render(<BenefitsReveal><StaggerItem>Delivery</StaggerItem></BenefitsReveal>);
      const wrapper = screen.getByText('Delivery').parentElement!;
      const position = { top: window.innerHeight - 20 };
      vi.spyOn(wrapper, 'getBoundingClientRect').mockImplementation(() => ({ top: position.top, bottom: position.top + 120, height: 120 }) as DOMRect);
      const scroll = () => act(() => { fireEvent.scroll(window); nextFrame?.(0); });
      return { wrapper, position, scroll };
    }

    it('waits for scrolling and meaningful visibility, then stays revealed when scrolled away and back', () => {
      const { wrapper, position, scroll } = setup();
      expect(wrapper.className).toContain('benefitsPending');
      scroll();
      expect(wrapper.className).toContain('benefitsPending');
      position.top = window.innerHeight - 80;
      scroll();
      expect(wrapper.className).toContain('benefitsVisible');
      // Scroll up so it leaves through the bottom, then back, then past it upwards: never re-hidden.
      position.top = window.innerHeight + 300;
      scroll();
      expect(wrapper.className).toContain('benefitsVisible');
      expect(wrapper.className).not.toContain('benefitsPending');
      position.top = -600;
      scroll();
      expect(wrapper.className).toContain('benefitsVisible');
      expect(wrapper.className).not.toContain('benefitsPending');
    });

    it('does not hide a block the visitor scrolled past before it ever animated', () => {
      const { wrapper, position, scroll } = setup();
      position.top = -600;
      scroll();
      expect(wrapper.className).not.toContain('benefitsPending');
      expect(wrapper.className).not.toContain('benefitsVisible');
    });

    it('keeps benefits immediately visible under reduced motion', () => {
      window.matchMedia = vi.fn().mockReturnValue({ matches: true });
      render(<BenefitsReveal><StaggerItem>Static delivery</StaggerItem></BenefitsReveal>);
      expect(screen.getByText('Static delivery').parentElement?.className).not.toMatch(/benefitsPending|benefitsVisible/);
    });
  });
});
