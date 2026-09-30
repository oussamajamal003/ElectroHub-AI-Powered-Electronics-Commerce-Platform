import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { BenefitsReveal, SectionReveal, StaggerContainer, StaggerItem } from './Motion';

describe('section motion', () => {
  const originalObserver = window.IntersectionObserver;
  const originalMatchMedia = window.matchMedia;
  afterEach(() => {
    if (originalObserver) window.IntersectionObserver = originalObserver;
    else delete (window as { IntersectionObserver?: typeof IntersectionObserver }).IntersectionObserver;
    window.matchMedia = originalMatchMedia;
    vi.restoreAllMocks();
  });

  it('reveals once and does not hide on later scroll changes', () => {
    let callback: IntersectionObserverCallback | undefined;
    const disconnect = vi.fn();
    window.IntersectionObserver = class {
      constructor(next: IntersectionObserverCallback) { callback = next; }
      observe() {}
      disconnect = disconnect;
      unobserve() {}
      takeRecords() { return []; }
      root = null;
      rootMargin = '';
      thresholds = [];
    };
    render(<SectionReveal><h2>Heading</h2></SectionReveal>);
    const wrapper = screen.getByRole('heading', { name: 'Heading' }).parentElement!;
    expect(wrapper.className).toContain('pending');
    act(() => callback?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(wrapper.className).toContain('visible');
    expect(wrapper.className).not.toContain('pending');
    act(() => callback?.([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(wrapper.className).toContain('visible');
    expect(disconnect).toHaveBeenCalled();
  });

  it('keeps semantic content in the DOM while stagger is pending', () => {
    render(<StaggerContainer><StaggerItem>Product</StaggerItem></StaggerContainer>);
    expect(screen.getByText('Product')).toBeInTheDocument();
  });

  it('replays a section only after it leaves and re-enters the viewport', () => {
    let callback: IntersectionObserverCallback | undefined;
    const disconnect = vi.fn();
    window.IntersectionObserver = class {
      constructor(next: IntersectionObserverCallback) { callback = next; }
      observe() {}
      disconnect = disconnect;
      unobserve() {}
      takeRecords() { return []; }
      root = null;
      rootMargin = '';
      thresholds = [];
    };
    render(<StaggerContainer replay><StaggerItem>Benefit</StaggerItem></StaggerContainer>);
    const wrapper = screen.getByText('Benefit').parentElement!;
    expect(wrapper.className).toContain('pending');
    act(() => callback?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(wrapper.className).toContain('visible');
    act(() => callback?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(wrapper.className).toContain('visible');
    act(() => callback?.([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(wrapper.className).not.toContain('pending');
    expect(wrapper.className).not.toContain('visible');
    act(() => callback?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(wrapper.className).toContain('visible');
    expect(wrapper.className).not.toContain('pending');
    expect(disconnect).not.toHaveBeenCalled();
  });

  it('keeps replayed cards mounted across viewport changes', () => {
    let callback: IntersectionObserverCallback | undefined;
    window.IntersectionObserver = class {
      constructor(next: IntersectionObserverCallback) { callback = next; }
      observe() {}
      disconnect() {}
      unobserve() {}
      takeRecords() { return []; }
      root = null;
      rootMargin = '';
      thresholds = [];
    };
    const mounted = vi.fn();
    function Card() { mounted(); return <button>Product</button>; }
    render(<StaggerItem replay><Card /></StaggerItem>);
    const button = screen.getByRole('button', { name: 'Product' });
    act(() => callback?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
    act(() => callback?.([{ isIntersecting: false } as IntersectionObserverEntry], {} as IntersectionObserver));
    act(() => callback?.([{ isIntersecting: true } as IntersectionObserverEntry], {} as IntersectionObserver));
    expect(screen.getByRole('button', { name: 'Product' })).toBe(button);
    expect(mounted).toHaveBeenCalledTimes(1);
  });

  it('shows content immediately with reduced motion', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true });
    render(<SectionReveal replay><h2>Visible heading</h2></SectionReveal>);
    expect(screen.getByRole('heading', { name: 'Visible heading' }).parentElement?.className).not.toContain('pending');
  });

  it('waits for scrolling and meaningful visibility, then replays only after a sufficient exit', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: false });
    let nextFrame: FrameRequestCallback | undefined;
    vi.spyOn(window, 'requestAnimationFrame').mockImplementation(callback => { nextFrame = callback; return 1; });
    vi.spyOn(window, 'cancelAnimationFrame').mockImplementation(() => {});
    render(<BenefitsReveal><StaggerItem>Delivery</StaggerItem></BenefitsReveal>);
    const wrapper = screen.getByText('Delivery').parentElement!;
    let top = window.innerHeight - 20;
    vi.spyOn(wrapper, 'getBoundingClientRect').mockImplementation(() => ({ top, bottom: top + 120, height: 120 }) as DOMRect);
    const scroll = () => act(() => {
      fireEvent.scroll(window);
      nextFrame?.(0);
    });
    expect(wrapper.className).toContain('benefitsPending');
    scroll();
    expect(wrapper.className).toContain('benefitsPending');
    top = window.innerHeight - 80;
    scroll();
    expect(wrapper.className).toContain('benefitsVisible');
    top = window.innerHeight - 10;
    scroll();
    expect(wrapper.className).toContain('benefitsVisible');
    top = window.innerHeight + 80;
    scroll();
    expect(wrapper.className).toContain('benefitsPending');
    top = window.innerHeight - 80;
    scroll();
    expect(wrapper.className).toContain('benefitsVisible');
    expect(screen.getByText('Delivery')).toBeInTheDocument();
  });

  it('keeps benefits immediately visible under reduced motion', () => {
    window.matchMedia = vi.fn().mockReturnValue({ matches: true });
    render(<BenefitsReveal><StaggerItem>Static delivery</StaggerItem></BenefitsReveal>);
    expect(screen.getByText('Static delivery').parentElement?.className).not.toMatch(/benefitsPending|benefitsVisible/);
  });
});
