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
});
