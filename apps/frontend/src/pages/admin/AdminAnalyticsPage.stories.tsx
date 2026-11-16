import { useState, type ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AdminAnalyticsPage } from './AdminAnalyticsPage';
import { analyticsKeys } from '@/features/admin/analytics/api';
import * as fx from '@/features/admin/analytics/fixtures';

/** Task 05.2 analytics page with synthetic fixtures (no API calls). Query data is seeded into the cache as fresh. */
function seededClient(reports: Record<string, unknown>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  for (const [endpoint, value] of Object.entries(reports)) client.setQueryData(analyticsKeys.report(endpoint, '30d'), value);
  return client;
}

function loadingClient() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  for (const endpoint of ['overview', 'products', 'categories', 'inventory', 'recommendations', 'image-search', 'deliveries', 'customers']) {
    const queryKey = analyticsKeys.report(endpoint, '30d');
    const query = client.getQueryCache().build(client, {
      queryKey,
      queryFn: () => new Promise<never>(() => {}),
    });
    void query.fetch();
  }
  return client;
}

function partialErrorClient() {
  const client = seededClient(populated);
  const queryKey = analyticsKeys.report('categories', '30d');
  client.setQueryDefaults(queryKey, { retryOnMount: false });
  const query = client.getQueryCache().build(client, {
    queryKey,
    queryFn: () => Promise.reject(new Error('Synthetic category report failure')),
  });
  query.setState({
    ...query.state,
    data: undefined,
    error: new Error('Synthetic category report failure'),
    errorUpdatedAt: Date.now(),
    status: 'error',
    fetchStatus: 'idle',
  });
  return client;
}

function Seeded({ reports, children, clientFactory = () => seededClient(reports) }: { reports: Record<string, unknown>; children: ReactNode; clientFactory?: () => QueryClient }) {
  const [client] = useState(clientFactory);
  return <QueryClientProvider client={client}>
    <MemoryRouter initialEntries={['/admin/analytics?period=30d']}>{children}</MemoryRouter>
  </QueryClientProvider>;
}

const populated = {
  overview: fx.overviewFixture, products: fx.productsFixture, categories: fx.categoriesFixture, inventory: fx.inventoryFixture,
  recommendations: fx.recommendationsFixture, 'image-search': fx.imageSearchFixture, deliveries: fx.deliveriesFixture, customers: fx.customersFixture,
};

const emptyOverview = { ...fx.overviewFixture, data: { ...fx.overviewFixture.data, byCurrency: [], revenueSeries: { granularity: 'DAY' as const, buckets: [], byCurrency: [] } } };
const empty = {
  ...populated,
  overview: emptyOverview,
  products: { ...fx.productsFixture, data: { ...fx.productsFixture.data, byUnits: [], byAmount: [] } },
  categories: { ...fx.categoriesFixture, data: { ...fx.categoriesFixture.data, categories: [] } },
  'image-search': { ...fx.imageSearchFixture, data: { ...fx.imageSearchFixture.data, requests: 0, trackingSince: null } },
};

const longLabels = {
  ...populated,
  products: {
    ...fx.productsFixture,
    data: { ...fx.productsFixture.data, byUnits: fx.productsFixture.data.byUnits.map((row, index) => ({ ...row, name: index === 0 ? 'Professional Noise Cancelling Studio Monitor Headphones with Extended Warranty' : row.name })) },
  },
  categories: {
    ...fx.categoriesFixture,
    data: { ...fx.categoriesFixture.data, categories: fx.categoriesFixture.data.categories.map((row, index) => ({ ...row, name: index === 0 ? 'Professional Audio and Studio Monitoring Equipment' : row.name })) },
  },
  recommendations: {
    ...fx.recommendationsFixture,
    data: { ...fx.recommendationsFixture.data, breakdown: { ...fx.recommendationsFixture.data.breakdown, bySurface: [{ surface: 'Personalized recommendations on the product detail page', impressions: 800, clicks: 60, ctr: 0.075 }] } },
  },
};

const meta = {
  title: 'Admin/Analytics',
  component: AdminAnalyticsPage,
  parameters: { layout: 'fullscreen' },
  decorators: [Story => <div style={{ padding: 24, background: '#f8fafc', minHeight: '100vh' }}><Story /></div>],
} satisfies Meta<typeof AdminAnalyticsPage>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = {
  render: () => <Seeded reports={populated}><AdminAnalyticsPage /></Seeded>,
};

export const NoActivity: Story = {
  render: () => <Seeded reports={empty}><AdminAnalyticsPage /></Seeded>,
};

export const AllSectionsLoading: Story = {
  render: () => <Seeded reports={{}} clientFactory={loadingClient}><AdminAnalyticsPage /></Seeded>,
};

export const PartialReportError: Story = {
  render: () => <Seeded reports={populated} clientFactory={partialErrorClient}><AdminAnalyticsPage /></Seeded>,
};

export const LongLabels: Story = {
  render: () => <Seeded reports={longLabels}><AdminAnalyticsPage /></Seeded>,
};
