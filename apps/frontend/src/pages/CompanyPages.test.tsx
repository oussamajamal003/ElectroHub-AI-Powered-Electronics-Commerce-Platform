import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ApiError } from '@/lib/api';
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
  addressLine1: '1 Main St', addressLine2: null, city: 'Boston', region: 'MA', postalCode: '02110', country: 'US', businessHours: 'Mon–Fri, 9–6', currency: 'USD' as const };
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
    const contactLinks = screen.getAllByRole('link', { name: 'Contact us' });
    expect(contactLinks).toHaveLength(2);
    for (const link of contactLinks) expect(link).toHaveAttribute('href', '/contact');
  });

  it('makes no unsupported business claims on About', () => {
    render(<MemoryRouter><AboutPage /></MemoryRouter>);
    expect(document.body.textContent).not.toMatch(/certified|fast shipping|expert support|founded|since \d{4}|\d+\+? (customers|stores|employees)|guarantee/i);
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
    const contactLinks = screen.getAllByRole('link', { name: 'Contact us' });
    expect(contactLinks).toHaveLength(2);
    for (const link of contactLinks) expect(link).toHaveAttribute('href', '/contact');
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
    expect(screen.getByText('Mon–Fri, 9–6')).toBeInTheDocument();
  });

  it('shows only configured details and an honest empty state when nothing is published', () => {
    vi.mocked(useStorefrontProfile).mockReturnValue({ data: { ...profile, supportEmail: null, supportPhone: null, addressLine1: null, city: null, region: null,
      postalCode: null, country: null, businessHours: null }, isPending: false, isError: false } as ReturnType<typeof useStorefrontProfile>);
    renderContact();
    expect(screen.queryByRole('link', { name: /@/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/support@example\.com|XX XXX/)).not.toBeInTheDocument();
    expect(screen.getByText(/have not been published yet/i)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send Message' })).toBeEnabled();
  });

  it('shows hours only when configured', () => {
    vi.mocked(useStorefrontProfile).mockReturnValue({ data: { ...profile, businessHours: null }, isPending: false, isError: false } as ReturnType<typeof useStorefrontProfile>);
    renderContact();
    expect(screen.queryByRole('heading', { name: 'Business hours' })).not.toBeInTheDocument();
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

  it('shows example placeholders that are never submitted as values', () => {
    renderContact();
    const expected = { Name: 'Enter your full name', Email: 'you@example.com', Subject: 'How can we help you?',
      Message: 'Tell us how we can help. Include your order number if relevant.' };
    for (const [label, placeholder] of Object.entries(expected)) {
      const control = document.getElementById(`contact-${label}`);
      expect(control).toHaveAttribute('placeholder', placeholder);
      expect(control).toHaveValue('');
    }
  });

  it('validates contact and reports successful delivery only after the request resolves', async () => {
    renderContact();
    fireEvent.click(screen.getByRole('button', { name: 'Send Message' }));
    expect(screen.getByText('Name is required.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Test User' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'test@example.com' } });
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Question' } });
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'Hello there, I have a question.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send Message' }));
    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent('Your message was sent to our support team.'));
    expect(sendContactMessage).toHaveBeenCalledWith({ name: 'Test User', email: 'test@example.com', subject: 'Question', message: 'Hello there, I have a question.', website: '' }, expect.any(Object));
    // The form is cleared after a real success so the same message cannot be re-sent by accident.
    expect(screen.getByLabelText('Message')).toHaveValue('');
  });

  it('rejects whitespace-only, too-short, overlong and malformed input before any request, and focuses the first problem', () => {
    renderContact();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '   ' } });
    fireEvent.change(screen.getByLabelText('Email'), { target: { value: 'not-an-email' } });
    fireEvent.change(screen.getByLabelText('Subject'), { target: { value: 'Hi' } });
    fireEvent.change(screen.getByLabelText('Message'), { target: { value: 'short' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send Message' }));
    expect(screen.getByText('Name is required.')).toBeInTheDocument();
    expect(screen.getByText('Enter a valid email address.')).toBeInTheDocument();
    expect(screen.getByText('Message must be at least 10 characters.')).toBeInTheDocument();
    expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Name')).toHaveFocus();
    expect(sendContactMessage).not.toHaveBeenCalled();
  });

  it('does not send twice while a submission is pending', async () => {
    let resolve!: (value: { data: { accepted: true } }) => void;
    vi.mocked(sendContactMessage).mockReturnValue(new Promise(done => { resolve = done; }));
    renderContact();
    for (const [label, value] of [['Name', 'Test User'], ['Email', 'test@example.com'], ['Subject', 'Question'], ['Message', 'Hello there, I have a question.']] as const) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    }
    fireEvent.click(screen.getByRole('button', { name: 'Send Message' }));
    const pending = await screen.findByRole('button', { name: 'Sending…' });
    expect(pending).toBeDisabled();
    fireEvent.submit(pending.closest('form')!);
    resolve({ data: { accepted: true } });
    await waitFor(() => expect(screen.getByRole('status')).toBeInTheDocument());
    expect(sendContactMessage).toHaveBeenCalledTimes(1);
  });

  it('forwards a filled honeypot value unchanged so the server can discard it', async () => {
    renderContact();
    for (const [label, value] of [['Name', 'Bot'], ['Email', 'bot@example.com'], ['Subject', 'Offer'], ['Message', 'Buy now, great offer here.']] as const) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    }
    fireEvent.change(document.getElementById('contact-website')!, { target: { value: 'https://spam.example' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send Message' }));
    await waitFor(() => expect(sendContactMessage).toHaveBeenCalledWith(expect.objectContaining({ website: 'https://spam.example' }), expect.any(Object)));
  });

  it('shows a safe retryable message when contact delivery fails', async () => {
    vi.mocked(sendContactMessage).mockRejectedValue(new Error('secret provider failure'));
    renderContact();
    for (const [label, value] of [['Name', 'Test User'], ['Email', 'test@example.com'], ['Subject', 'Question'], ['Message', 'Hello there, I have a question.']] as const) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    }
    fireEvent.click(screen.getByRole('button', { name: 'Send Message' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent('We could not send your message. Your message is still here — please try again.'));
    expect(screen.queryByText('secret provider failure')).not.toBeInTheDocument();
  });

  it.each([
    [new ApiError(503, 'Something went wrong. Please try again later.', undefined, 'CONTACT_NOT_CONFIGURED'), 'Our support inbox isn’t set up yet, so your message could not be delivered.'],
    [new ApiError(503, 'Something went wrong. Please try again later.', undefined, 'CONTACT_UNAVAILABLE'), 'Our email service didn’t accept your message, so it was not sent.'],
    [new ApiError(429, 'Too many requests.', undefined, 'RATE_LIMITED'), 'You’ve sent several messages in a short time. Please wait a minute, then try again.'],
    [new ApiError(0, 'Network error'), 'We couldn’t reach ElectroHub. Check your connection'],
  ])('explains what actually happened for %s, keeps the typed message and never claims success', async (error, expected) => {
    vi.mocked(sendContactMessage).mockRejectedValue(error);
    renderContact();
    for (const [label, value] of [['Name', 'Test User'], ['Email', 'test@example.com'], ['Subject', 'Question'], ['Message', 'Hello there, I have a question.']] as const) {
      fireEvent.change(screen.getByLabelText(label), { target: { value } });
    }
    fireEvent.click(screen.getByRole('button', { name: 'Send Message' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(expected));
    expect(screen.getByLabelText('Message')).toHaveValue('Hello there, I have a question.');
    expect(screen.queryByText(/Your message was sent/)).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send Message' })).toBeEnabled();     // retry is one click away
  });

  it('does not pre-emptively claim delivery is impossible without a support mailbox: verified administrators are the server-side fallback', () => {
    vi.mocked(useStorefrontProfile).mockReturnValue({ data: { ...profile, supportEmail: null }, isPending: false, isError: false } as unknown as ReturnType<typeof useStorefrontProfile>);
    renderContact();
    expect(screen.queryByTestId('contact-inbox-missing')).toBeNull();
    expect(screen.getByRole('button', { name: 'Send Message' })).toBeEnabled();
    expect(screen.queryByText(/The form is the quickest way/)).not.toBeInTheDocument();
  });
});
