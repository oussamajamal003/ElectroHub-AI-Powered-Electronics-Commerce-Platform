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
    const title = await screen.findAllByText('ElectroHub');
    expect(title.length).toBeGreaterThan(0);
    expect(await screen.findByText('AI-Powered Electronics Commerce Platform')).toBeInTheDocument();
  });

  it('renders NotFoundPage on an unknown route', async () => {
    renderWithProviders('/unknown-route-that-does-not-exist');
    expect(await screen.findByText('404')).toBeInTheDocument();
    expect(await screen.findByText('Page Not Found')).toBeInTheDocument();
  });
});
