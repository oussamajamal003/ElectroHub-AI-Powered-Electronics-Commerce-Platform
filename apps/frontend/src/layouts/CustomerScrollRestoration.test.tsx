import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createMemoryRouter, Link, RouterProvider, useNavigate } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { CustomerScrollRestoration } from './CustomerScrollRestoration';

function ScrollControls() {
  const navigate = useNavigate();
  return <><CustomerScrollRestoration /><Link to="/account">Open account</Link><button onClick={() => navigate(-1)}>Back</button><button onClick={() => navigate(1)}>Forward</button></>;
}

describe('CustomerScrollRestoration', () => {
  it('starts fresh routes at the top and restores saved history positions on Back and Forward', async () => {
    let scrollY = 420;
    vi.stubGlobal('scrollTo', (_x: number, y: number) => { scrollY = y; Object.defineProperty(window, 'scrollY', { configurable: true, value: y }); });
    Object.defineProperty(window, 'scrollY', { configurable: true, value: scrollY });
    window.requestAnimationFrame = callback => window.setTimeout(() => callback(performance.now()), 0);
    window.cancelAnimationFrame = handle => window.clearTimeout(handle);
    const router = createMemoryRouter([
      { path: '/scroll-test-products', element: <ScrollControls /> },
      { path: '/account', element: <ScrollControls /> },
    ], { initialEntries: ['/scroll-test-products'] });
    render(<RouterProvider router={router} />);
    await waitFor(() => expect(scrollY).toBe(0));
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 1800 });
    fireEvent.scroll(window);
    fireEvent.click(screen.getByRole('link', { name: 'Open account' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/account'));
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(scrollY).toBe(1800));
    fireEvent.click(screen.getByRole('button', { name: 'Forward' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/account'));
    await waitFor(() => expect(scrollY).toBe(0));
  });

  it('ignores scrolling while a navigation is pending so Back restores the position the page was left at', async () => {
    let scrollY = 0;
    vi.stubGlobal('scrollTo', (_x: number, y: number) => { scrollY = y; Object.defineProperty(window, 'scrollY', { configurable: true, value: y }); });
    Object.defineProperty(window, 'scrollY', { configurable: true, value: scrollY });
    window.requestAnimationFrame = callback => window.setTimeout(() => callback(performance.now()), 0);
    window.cancelAnimationFrame = handle => window.clearTimeout(handle);
    const router = createMemoryRouter([
      { path: '/scroll-test-pending', element: <ScrollControls /> },
      { path: '/account', element: <ScrollControls /> },
    ], { initialEntries: ['/scroll-test-pending'] });
    render(<RouterProvider router={router} />);
    await waitFor(() => expect(scrollY).toBe(0));
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 1867 });
    fireEvent.scroll(window);
    try {
      // BrowserRouter pushes the next entry ({ usr, key, idx }) at once, while a lazy route keeps this page on screen.
      window.history.replaceState({ usr: null, key: 'pending-next-entry', idx: 1 }, '');
      Object.defineProperty(window, 'scrollY', { configurable: true, value: 1419 });
      fireEvent.scroll(window);
      fireEvent.click(screen.getByRole('link', { name: 'Open account' }));
      await waitFor(() => expect(router.state.location.pathname).toBe('/account'));
    } finally {
      window.history.replaceState(null, '');
    }
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/scroll-test-pending'));
    await waitFor(() => expect(scrollY).toBe(1867));
  });

  it('glides to the top on page-number navigation instead of jumping', async () => {
    const scrollTo = vi.fn();
    vi.stubGlobal('scrollTo', scrollTo);
    window.requestAnimationFrame = callback => window.setTimeout(() => callback(performance.now()), 0);
    window.cancelAnimationFrame = handle => window.clearTimeout(handle);
    const router = createMemoryRouter([
      { path: '/scroll-test-smooth', element: <ScrollControls /> },
    ], { initialEntries: ['/scroll-test-smooth'] });
    render(<RouterProvider router={router} />);
    scrollTo.mockClear();
    await router.navigate('/scroll-test-smooth?page=2', { state: { smoothTop: true } });
    await waitFor(() => expect(scrollTo).toHaveBeenCalledWith(expect.objectContaining({ top: 0, behavior: 'smooth' })));
  });

  async function leaveAndReturn(path: string, leftAt: number, shortHeight: number, setHeight: (h: number) => void) {
    const router = createMemoryRouter([
      { path, element: <ScrollControls /> },
      { path: '/account', element: <ScrollControls /> },
    ], { initialEntries: [path] });
    render(<RouterProvider router={router} />);
    Object.defineProperty(window, 'scrollY', { configurable: true, value: leftAt });
    fireEvent.scroll(window);
    fireEvent.click(screen.getByRole('link', { name: 'Open account' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/account'));
    setHeight(shortHeight);
    fireEvent.click(screen.getByRole('button', { name: 'Back' }));
    await waitFor(() => expect(router.state.location.pathname).toBe(path));
    return router;
  }

  it('waits for the returning page to grow tall enough instead of parking at a clamped bottom', async () => {
    let scrollY = 0;
    let height = 4000;
    const positions: number[] = [];
    vi.stubGlobal('scrollTo', (first: number | ScrollToOptions, second?: number) => {
      const requested = typeof first === 'object' ? first.top ?? 0 : second ?? 0;
      scrollY = Math.max(0, Math.min(requested, height - window.innerHeight));
      positions.push(scrollY);
      Object.defineProperty(window, 'scrollY', { configurable: true, value: scrollY });
    });
    Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, get: () => height });
    window.requestAnimationFrame = callback => window.setTimeout(() => callback(performance.now()), 5);
    window.cancelAnimationFrame = handle => window.clearTimeout(handle);
    try {
      await leaveAndReturn('/scroll-test-grow', 2400, 1200, h => { height = h; });
      await new Promise(resolve => setTimeout(resolve, 60));
      expect(scrollY).toBe(0);
      height = 4000;
      await waitFor(() => expect(scrollY).toBe(2400));
      expect(positions).not.toContain(1200 - window.innerHeight);
    } finally {
      Reflect.deleteProperty(document.documentElement, 'scrollHeight');
    }
  });

  it('visitor input cancels a pending restore', async () => {
    let scrollY = 0;
    let height = 4000;
    vi.stubGlobal('scrollTo', (first: number | ScrollToOptions, second?: number) => {
      scrollY = typeof first === 'object' ? first.top ?? 0 : second ?? 0;
      Object.defineProperty(window, 'scrollY', { configurable: true, value: scrollY });
    });
    Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, get: () => height });
    window.requestAnimationFrame = callback => window.setTimeout(() => callback(performance.now()), 5);
    window.cancelAnimationFrame = handle => window.clearTimeout(handle);
    try {
      await leaveAndReturn('/scroll-test-input', 3000, 900, h => { height = h; });
      fireEvent.wheel(window);
      height = 4000;
      await new Promise(resolve => setTimeout(resolve, 60));
      expect(scrollY).toBe(0);
    } finally {
      Reflect.deleteProperty(document.documentElement, 'scrollHeight');
    }
  });

  it('mirrors positions to sessionStorage so Back can restore after a document load', async () => {
    vi.stubGlobal('scrollTo', (first: number | ScrollToOptions, second?: number) => {
      Object.defineProperty(window, 'scrollY', { configurable: true, value: typeof first === 'object' ? first.top ?? 0 : second ?? 0 });
    });
    window.requestAnimationFrame = callback => window.setTimeout(() => callback(performance.now()), 0);
    window.cancelAnimationFrame = handle => window.clearTimeout(handle);
    const router = createMemoryRouter([{ path: '/scroll-test-storage', element: <ScrollControls /> }], { initialEntries: ['/scroll-test-storage'] });
    render(<RouterProvider router={router} />);
    Object.defineProperty(window, 'scrollY', { configurable: true, value: 777 });
    fireEvent.scroll(window);
    await waitFor(() => expect(JSON.parse(sessionStorage.getItem('electrohub:scroll-positions') ?? '{}')).toMatchObject({ 'default:/scroll-test-storage': 777 }));
  });
});
