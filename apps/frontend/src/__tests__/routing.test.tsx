import { render, screen, cleanup } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, it, expect, afterEach } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { AppRoutes } from '../routes';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

const queryClient = new QueryClient();

const renderWithProviders = (initialRoute = '/') => {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={[initialRoute]}>
        <AppRoutes />
      </MemoryRouter>
    </QueryClientProvider>
  );
};

describe('Routing Foundation', () => {
  afterEach(cleanup);
  it('renders HomePage on the root route "/"', async () => {
    renderWithProviders('/');
    expect(await screen.findByRole('heading', { level: 1, name: /Next-gen tech,\s*delivered to you/ })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Shop Now' })).toHaveAttribute('href', '/products');
  });

  it('renders NotFoundPage on an unknown route', async () => {
    renderWithProviders('/unknown-route-that-does-not-exist');
    expect(await screen.findByText('404')).toBeInTheDocument();
    expect(await screen.findByText('Page Not Found')).toBeInTheDocument();
  });
});
