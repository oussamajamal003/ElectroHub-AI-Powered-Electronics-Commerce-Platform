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
  it('renders HomePage on the root route "/"', () => {
    renderWithProviders('/');
    expect(screen.getByText('ElectroHub')).toBeInTheDocument();
    expect(screen.getByText('AI-Powered Electronics Commerce Platform')).toBeInTheDocument();
  });

  it('renders NotFoundPage on an unknown route', () => {
    renderWithProviders('/unknown-route-that-does-not-exist');
    expect(screen.getByText('404')).toBeInTheDocument();
    expect(screen.getByText('Page Not Found')).toBeInTheDocument();
  });
});
