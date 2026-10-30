import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { RecommendationSectionRail } from './RecommendationSectionRail';

vi.mock('../useStoreCardActions', () => ({ useStoreCardActions: () => ({ navigate: vi.fn(), cardActions: {} }) }));
vi.mock('../tracking', () => ({ useImpressionTracking: () => ({ observe: () => () => undefined, click: vi.fn() }) }));
vi.mock('../queries', () => ({ recordRecommendationClick: vi.fn() }));

const wrap = (node: React.ReactNode) => <MemoryRouter>{node}</MemoryRouter>;

describe('RecommendationSectionRail loading copy', () => {
  it('renders a headingless skeleton when the heading depends on the server strategy', () => {
    render(wrap(<RecommendationSectionRail id="similar" loading />));
    expect(screen.queryByRole('heading')).toBeNull();
    expect(screen.getByRole('status', { name: 'Loading recommendations' })).toBeInTheDocument();
  });
  it('uses the supplied heading only when the caller says it is final', () => {
    render(wrap(<RecommendationSectionRail id="popular" loading loadingTitle="Popular Products" />));
    expect(screen.getByRole('heading', { name: 'Popular Products' })).toBeInTheDocument();
  });
  it('renders nothing when there is no section and nothing is loading or failed', () => {
    const { container } = render(wrap(<RecommendationSectionRail id="none" />));
    expect(container).toBeEmptyDOMElement();
  });
  it('keeps the error state under a neutral title rather than a guessed section name', () => {
    render(wrap(<RecommendationSectionRail id="err" error />));
    expect(screen.getByRole('heading', { name: 'Recommendations' })).toBeInTheDocument();
    expect(screen.getByText(/unavailable right now/i)).toBeInTheDocument();
  });
});
