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

function Seeded({ reports, children }: { reports: Record<string, unknown>; children: ReactNode }) {
  const [client] = useState(() => seededClient(reports));
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
