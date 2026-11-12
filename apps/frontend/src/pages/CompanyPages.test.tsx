import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AboutPage } from './AboutPage';
import { ContactPage } from './ContactPage';
import { sendContactMessage, useStorefrontProfile } from '@/features/storefront/api';

vi.mock('@/features/storefront/api', () => ({
  useStorefrontProfile: vi.fn(), sendContactMessage: vi.fn(),
}));

const profile = { storeName: 'Northstar', supportEmail: 'help@example.test', supportPhone: '+1 555 111 2222',
  addressLine1: '1 Main St', addressLine2: null, city: 'Boston', region: 'MA', postalCode: '02110', country: 'US', currency: 'USD' as const };
const renderContact = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={client}><MemoryRouter><ContactPage /></MemoryRouter></QueryClientProvider>);
};

describe('company pages', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(useStorefrontProfile).mockReturnValue({ data: profile, isPending: false, isError: false } as ReturnType<typeof useStorefrontProfile>);
    vi.mocked(sendContactMessage).mockResolvedValue({ data: { accepted: true } });
  });

  it('shows About content and a Products CTA', () => {
    render(<MemoryRouter><AboutPage /></MemoryRouter>);
    expect(screen.getByRole('heading', { name: 'Technology made simple.' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Explore Products' })).toHaveAttribute('href', '/products');
  });

  it('serves every About image as AVIF and WebP with descriptive alt text', () => {
    const { container } = render(<MemoryRouter><AboutPage /></MemoryRouter>);
    const images = screen.getAllByRole('img');
    expect(images.length).toBeGreaterThanOrEqual(9);
    for (const image of images) {
      expect(image.getAttribute('alt')?.length).toBeGreaterThan(10);
      expect(image).toHaveAttribute('width', '800');
      expect(image).toHaveAttribute('height', '800');
      expect(image.getAttribute('src')).toMatch(/^\/images\/about\/[a-z-]+-800\.webp$/);
    }
    const pictures = container.querySelectorAll('picture');
    expect(pictures).toHaveLength(images.length);
    for (const picture of pictures) {
      expect(picture.querySelector('source[type="image/avif"]')?.getAttribute('srcset')).toMatch(/-480\.avif 480w, .*-800\.avif 800w$/);
      expect(picture.querySelector('source[type="image/webp"]')).not.toBeNull();
    }
    // Only the two above-the-fold mosaic tiles load eagerly.
    expect(images.filter(image => image.getAttribute('loading') === 'eager')).toHaveLength(2);
  });

  it('makes no unverifiable company claims on About', () => {
    const { container } = render(<MemoryRouter><AboutPage /></MemoryRouter>);
    const text = container.textContent ?? '';
    for (const claim of [/certified/i, /award/i, /expert/i, /verified buyer/i, /\d+\s*(k|\+|%|million|customers|years)/i, /tested for/i, /fast shipping/i]) {
      expect(text).not.toMatch(claim);
    }
    expect(screen.getByRole('link', { name: 'Contact us' })).toHaveAttribute('href', '/contact');
  });

  it('shows only the contact methods that are configured', () => {
    vi.mocked(useStorefrontProfile).mockReturnValue({ data: { ...profile, supportPhone: null, addressLine1: null, city: null, region: null, postalCode: null, country: null },
      isPending: false, isError: false } as unknown as ReturnType<typeof useStorefrontProfile>);
    renderContact();
    expect(screen.getByRole('heading', { name: 'Email', level: 3 })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Phone', level: 3 })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Location', level: 3 })).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Send us a message', level: 3 })).toBeNull();
  });

  it('shows a composed empty state instead of blank space when no contact details are configured', () => {
    vi.mocked(useStorefrontProfile).mockReturnValue({ data: { storeName: 'Northstar', supportEmail: null, supportPhone: null, addressLine1: null, addressLine2: null,
      city: null, region: null, postalCode: null, country: null, currency: 'USD' }, isPending: false, isError: false } as unknown as ReturnType<typeof useStorefrontProfile>);
    renderContact();
    expect(screen.getByRole('heading', { name: 'Send us a message', level: 3 })).toBeInTheDocument();
    expect(screen.getByText(/Direct contact details have not been published yet/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /@/ })).toBeNull();
    expect(screen.getByRole('button', { name: 'Send Message' })).toBeEnabled();
  });

  it('uses saved store details as semantic contact addresses and dynamically displays the name', () => {
    renderContact();
    expect(screen.getByText('Questions about Northstar? Get in touch with our team.')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'help@example.test' })).toHaveAttribute('href', 'mailto:help@example.test');
    expect(screen.getByRole('link', { name: '+1 555 111 2222' })).toHaveAttribute('href', 'tel:+15551112222');
    expect(screen.getByText('1 Main St, Boston, MA, 02110, US')).toBeInTheDocument();
  });

  it('shows profile loading and recoverable profile error states', () => {
    vi.mocked(useStorefrontProfile).mockReturnValue({ data: undefined, isPending: true, isError: false } as ReturnType<typeof useStorefrontProfile>);
    const { rerender } = renderContact();
    expect(screen.getByRole('status')).toHaveTextContent('Loading store contact details');
    vi.mocked(useStorefrontProfile).mockReturnValue({ data: undefined, isPending: false, isError: true } as ReturnType<typeof useStorefrontProfile>);
    rerender(<QueryClientProvider client={new QueryClient()}><MemoryRouter><ContactPage /></MemoryRouter></QueryClientProvider>);
    expect(screen.getByRole('alert')).toHaveTextContent('You can still send a message using the form');
  });

  it('keeps the last known public details visible when a background refresh fails', () => {
    vi.mocked(useStorefrontProfile).mockReturnValue({ data: profile, isPending: false, isError: true, isFetching: false } as unknown as ReturnType<typeof useStorefrontProfile>);
    renderContact();
    expect(screen.getByRole('link', { name: 'help@example.test' })).toHaveAttribute('href', 'mailto:help@example.test');
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('validates contact and reports successful delivery only after the request resolves', async () => {
    renderContact();
    fireEvent.click(screen.getByRole('button', { name: 'Send Message' }));
    expect(screen.getByText('Name is required.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Test User' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Question' } });
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Hello' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send Message' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Your message has been sent.'));
    expect(sendContactMessage).toHaveBeenCalledWith({ name: 'Test User', email: 'test@example.com', subject: 'Question', message: 'Hello' }, expect.any(Object));
  });

  it('shows a safe retryable message when contact delivery fails', async () => {
    vi.mocked(sendContactMessage).mockRejectedValue(new Error('secret provider failure'));
    renderContact();
    for (const [label, value] of [['Name', 'Test User'], ['Email', 'test@example.com'], ['Subject', 'Question'], ['Message', 'Hello']] as const) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    }
    fireEvent.click(screen.getByRole('button', { name: 'Send Message' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('We could not send your message. Please try again.'));
    expect(screen.queryByText('secret provider failure')).not.toBeInTheDocument();
  });
});
