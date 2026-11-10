import { render, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { usePageTitle } from './usePageTitle';

function Page({ heading }: { heading?: string }) {
  usePageTitle('test-main', 'ElectroHub');
  return <main id="test-main">{heading && <h1>{heading}</h1>}</main>;
}

describe('route document titles', () => {
  it('updates after a lazy heading arrives and when its data changes', async () => {
    const view = render(<MemoryRouter><Page /></MemoryRouter>);
    expect(document.title).toBe('ElectroHub');
    view.rerender(<MemoryRouter><Page heading="Product details" /></MemoryRouter>);
    await waitFor(() => expect(document.title).toBe('Product details | ElectroHub'));
    view.rerender(<MemoryRouter><Page heading="Aurora Headphones" /></MemoryRouter>);
    await waitFor(() => expect(document.title).toBe('Aurora Headphones | ElectroHub'));
  });
});
