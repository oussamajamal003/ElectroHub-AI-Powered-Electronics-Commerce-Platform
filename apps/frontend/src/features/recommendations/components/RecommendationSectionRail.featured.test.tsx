import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import type { ProductSummary } from '@/features/products/types';
import { railCopy } from '../labels';
import type { RecommendationSection } from '../types';
import { RecommendationSectionRail } from './RecommendationSectionRail';

vi.mock('../useStoreCardActions', () => ({ useStoreCardActions: () => ({ navigate: vi.fn(), cardActions: {} }) }));
vi.mock('../tracking', () => ({ useImpressionTracking: () => ({ observe: () => () => undefined, click: vi.fn() }) }));
vi.mock('../queries', () => ({ recordRecommendationClick: vi.fn() }));

const product = (id: string, name: string): ProductSummary => ({
  id, name, description: null, slug: name.toLowerCase().replace(/\s+/g, '-'), price: '100.00', compareAtPrice: null, discountPercent: null,
  averageRating: null, reviewCount: 0, currency: 'USD', availability: 'AVAILABLE', category: { id: 'c', name: 'Audio', slug: 'audio' },
  brand: null, primaryImage: null,
});

const pinned = product('5a9ff5e6-9d4c-4dbe-9b8c-6f2b5d4e3a55', 'Pinned Headphones');
const organic = product('8f2813b4-a388-44d3-b51e-5d4c40386677', 'Organic Speaker');

const section = (overrides: Partial<RecommendationSection> = {}): RecommendationSection => ({
  mode: 'POPULAR_PRODUCTS', surface: 'home', strategy: 'MEASURED_POPULARITY', isPersonalized: false, isFallback: false, fallbackReason: null,
  modelVersion: null, embeddingVersion: null, algorithmVersion: 'popularity-v1', context: null, impressionToken: null,
  items: [{ rank: 1, product: pinned, featured: true }, { rank: 2, product: organic }], ...overrides,
});

describe('RecommendationSectionRail featured placement', () => {
  it('labels only the administrator-pinned card as Featured, in text, and keeps the organic card unlabelled', () => {
    render(<MemoryRouter><RecommendationSectionRail id="popular" section={section()} /></MemoryRouter>);
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.getByText('Pinned Headphones').closest('li')).toHaveTextContent('Featured');
    expect(screen.getByText('Organic Speaker').closest('li')).not.toHaveTextContent('Featured');
  });

  it('shows a merchandised-only section under the Featured heading with a truthful description', () => {
    const merchandised = section({ strategy: 'MERCHANDISED_PIN', isFallback: true, fallbackReason: 'NO_MEASURED_DEMAND', algorithmVersion: 'merchandised-pin-v1',
      items: [{ rank: 1, product: pinned, featured: true }] });
    render(<MemoryRouter><RecommendationSectionRail id="popular" section={merchandised} /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'Featured' })).toBeInTheDocument();
    expect(screen.getByText('Selected by our store team.')).toBeInTheDocument();
  });

  it('never gives a merchandised section a measured-demand title', () => {
    expect(railCopy(section({ strategy: 'MERCHANDISED_PIN', items: [{ rank: 1, product: pinned, featured: true }] }))?.title).toBe('Featured');
    expect(railCopy(section({ strategy: 'MERCHANDISED_PIN', items: [{ rank: 1, product: pinned, featured: true }] }))?.description).not.toMatch(/last 30 days/);
  });
});
