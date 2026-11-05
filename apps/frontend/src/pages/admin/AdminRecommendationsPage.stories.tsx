import { useState, type ReactNode } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { AdminRecommendationsPage } from './AdminRecommendationsPage';
import { recommendationKeys, type FeaturedPin, type RecommendationOverview, type SectionConfig } from '@/features/admin/recommendations/api';

/** Task 05.2 recommendation management with synthetic fixtures only (no API calls). Cached data is treated as fresh. */
const overview: RecommendationOverview = {
  period: '30d', since: '2026-10-06T00:00:00.000Z',
  totals: { impressions: 1280, clicks: 164, ctr: 0.128, fallbackImpressions: 420, fallbackShare: 0.328 },
  breakdown: [
    { surface: 'home', mode: 'POPULAR_PRODUCTS', strategy: 'MEASURED_POPULARITY', impressions: 860, clicks: 130, ctr: 0.151, fallback: false },
    { surface: 'home', mode: 'POPULAR_PRODUCTS', strategy: 'FALLBACK_NEW_ARRIVALS', impressions: 420, clicks: 34, ctr: 0.081, fallback: true },
  ],
};

const configurations: SectionConfig[] = [
  { surface: 'home', mode: 'POPULAR_PRODUCTS', enabled: true, itemLimit: 12, defaultLimit: 4, maxLimit: 12, version: 3, updatedAt: '2026-11-01T10:00:00.000Z', configured: true },
  { surface: 'home', mode: 'RECOMMENDED_FOR_YOU', enabled: true, itemLimit: 8, defaultLimit: 4, maxLimit: 12, version: 1, updatedAt: null, configured: true },
  { surface: 'cart', mode: 'FREQUENTLY_BOUGHT_TOGETHER', enabled: false, itemLimit: 6, defaultLimit: 4, maxLimit: 12, version: 2, updatedAt: '2026-11-02T09:30:00.000Z', configured: true },
];

const pin = (id: string, name: string, position: number, state: FeaturedPin['state']): FeaturedPin => ({
  id, productId: `product-${id}`, surface: 'home', position, startsAt: null, endsAt: null, enabled: state !== 'PAUSED', version: 1, state,
  eligible: state !== 'INELIGIBLE', product: { id: `product-${id}`, name, slug: name.toLowerCase().replace(/\s+/g, '-'), sku: `SYN-${position}` },
});

const featured = { data: [
  pin('a', 'Synthetic Wireless Headphones', 0, 'ACTIVE'),
  pin('b', 'Synthetic Mechanical Keyboard', 1, 'PAUSED'),
  pin('c', 'Synthetic USB-C Hub', 2, 'INELIGIBLE'),
], meta: { maxPerSurface: 8 } };

function seededClient() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Number.POSITIVE_INFINITY } } });
  client.setQueryData(recommendationKeys.overview('30d'), overview);
  client.setQueryData(recommendationKeys.configurations, configurations);
  client.setQueryData(recommendationKeys.featured(), featured);
  return client;
}

function Seeded({ tab, children }: { tab: string; children: ReactNode }) {
  const [client] = useState(seededClient);
  return <QueryClientProvider client={client}>
    <MemoryRouter initialEntries={[`/admin/recommendations?tab=${tab}`]}>{children}</MemoryRouter>
  </QueryClientProvider>;
}

const meta = {
  title: 'Admin/Recommendations Page',
  component: AdminRecommendationsPage,
  parameters: { layout: 'padded' },
} satisfies Meta<typeof AdminRecommendationsPage>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Overview: Story = { render: () => <Seeded tab="overview"><AdminRecommendationsPage /></Seeded> };
export const Strategies: Story = { render: () => <Seeded tab="strategies"><AdminRecommendationsPage /></Seeded> };
export const Featured: Story = { render: () => <Seeded tab="featured"><AdminRecommendationsPage /></Seeded> };
