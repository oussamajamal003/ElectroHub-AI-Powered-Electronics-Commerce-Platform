import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { usePageTitle } from './usePageTitle';
import { BRAND_TITLE, brandTitle, formatPageTitle } from '@/lib/pageTitle';

function Page({ heading, prefix }: { heading?: string; prefix?: string }) {
  usePageTitle('test-main', BRAND_TITLE, prefix);
  return <main id="test-main">{heading && <h1>{heading}</h1>}</main>;
}

describe('route document titles', () => {
  it('updates after a lazy heading arrives and when its data changes', async () => {
    const view = render(<MemoryRouter><Page /></MemoryRouter>);
    expect(document.title).toBe('ElectroHub — Electronics Commerce Platform');
    view.rerender(<MemoryRouter><Page heading="Product details" /></MemoryRouter>);
    await waitFor(() => expect(document.title).toBe('Product details | ElectroHub — Electronics Commerce Platform'));
    view.rerender(<MemoryRouter><Page heading="Aurora Headphones" /></MemoryRouter>);
    await waitFor(() => expect(document.title).toBe('Aurora Headphones | ElectroHub — Electronics Commerce Platform'));
  });
});

describe('title strategy', () => {
  it('prefixes admin headings once and keeps the brand on every title', async () => {
    const view = render(<MemoryRouter><Page heading="Dashboard" prefix="Admin" /></MemoryRouter>);
    await waitFor(() => expect(document.title).toBe('Admin Dashboard | ElectroHub — Electronics Commerce Platform'));
    view.rerender(<MemoryRouter><Page heading="Administrators" prefix="Admin" /></MemoryRouter>);
    await waitFor(() => expect(document.title).toBe('Administrators | ElectroHub — Electronics Commerce Platform'));
  });

  it('formats titles from the default brand or a configured store name', () => {
    expect(formatPageTitle('Cart')).toBe('Cart | ElectroHub — Electronics Commerce Platform');
    expect(formatPageTitle(null)).toBe(BRAND_TITLE);
    expect(brandTitle(undefined)).toBe(BRAND_TITLE);
    expect(brandTitle('ElectroHub')).toBe(BRAND_TITLE);
    expect(brandTitle('Volt Mart')).toBe('Volt Mart — Electronics Commerce Platform');
  });
});
