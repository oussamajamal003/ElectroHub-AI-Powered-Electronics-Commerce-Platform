import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiClient } from '@/lib/api';
import { createQueryClient } from '@/lib/query';
import { DiscoveryProvider } from './DiscoveryProvider';
import { useDiscovery } from './context';
import { MAX_IMAGE_BYTES, searchByImage, validateImageFile } from './imageSearch';

vi.mock('@/lib/api', async importOriginal => ({ ...await importOriginal<typeof import('@/lib/api')>(), apiClient: vi.fn() }));

// Sixteen categories: the console must render whatever the catalog API returns, never a hardcoded list.
const categories = Array.from({ length: 16 }, (_, index) => ({ id: `c${index}`, name: `Category ${index + 1}`, slug: `category-${index + 1}`,
  description: null, imageUrl: null, productCount: index === 15 ? 0 : index + 1 }));
const suggestions = [
  { id: 'p1', type: 'PRODUCT', label: 'Apple MacBook Air', slug: 'apple-macbook-air' },
  { id: 'p2', type: 'PRODUCT', label: 'Apple MacBook Pro', slug: 'apple-macbook-pro' },
  { id: 'b1', type: 'BRAND', label: 'Apple', slug: 'apple' },
  { id: 'c1', type: 'CATEGORY', label: 'Laptops', slug: 'laptops' },
];
const product = (id: string, name: string) => ({ id, name, slug: id, price: '199.00', compareAtPrice: null, discountPercent: null, description: null,
  averageRating: null, reviewCount: 0, currency: 'USD', availability: 'AVAILABLE', stockStatus: 'LOW_STOCK',
  category: { id: 'audio', name: 'Audio', slug: 'audio' }, brand: null, primaryImage: null });

function Location() { return <output data-testid="location">{useLocation().pathname + useLocation().search}</output>; }
function Trigger() {
  const discovery = useDiscovery();
  return <><button type="button" onClick={() => discovery?.open()}>Open search</button>
    <button type="button" onClick={() => discovery?.open({ mode: 'image' })}>Open photo search</button>
    <button type="button" onClick={() => discovery?.open({ mode: 'image', camera: true })}>Open camera</button></>;
}
const renderConsole = (disabled = false) => render(<QueryClientProvider client={createQueryClient()}>
  <MemoryRouter initialEntries={['/']}><DiscoveryProvider disabled={disabled}><Trigger /><Location /></DiscoveryProvider></MemoryRouter>
</QueryClientProvider>);
const imageFile = (name = 'headphones.png', type = 'image/png', size = 2048) => new File([new Uint8Array(size)], name, { type });

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  vi.mocked(apiClient).mockImplementation(async endpoint => {
    if (endpoint.startsWith('/api/categories')) return { data: categories, meta: { page: 1, pageSize: 100, total: categories.length } } as never;
    if (endpoint.startsWith('/api/search/suggestions')) return { data: suggestions } as never;
    throw new Error(`unexpected ${endpoint}`);
  });
  URL.createObjectURL = vi.fn(() => 'blob:preview');
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

describe('Discovery Console shell', () => {
  it('opens as a labelled dialog, focuses the combobox, closes on Escape and returns focus to the trigger', async () => {
    renderConsole();
    const trigger = screen.getByRole('button', { name: 'Open search' });
    trigger.focus();
    fireEvent.click(trigger);
    const dialog = await screen.findByRole('dialog', { name: 'Search ElectroHub' });
    const input = within(dialog).getByRole('combobox', { name: 'Search products' });
    await waitFor(() => expect(input).toHaveFocus());
    fireEvent.keyDown(input, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    await waitFor(() => expect(trigger).toHaveFocus());
  });

  it('toggles with Ctrl+K and Cmd+K but ignores the chord with extra modifiers or when disabled', async () => {
    renderConsole();
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true, shiftKey: true });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true });
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
    fireEvent.keyDown(document.body, { key: 'K', metaKey: true });
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
  });

  it('stays closed while the shell is locked', () => {
    renderConsole(true);
    fireEvent.keyDown(document.body, { key: 'k', ctrlKey: true });
    fireEvent.click(screen.getByRole('button', { name: 'Open search' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('shows every catalog category with products from the API, not a fixed list', async () => {
    renderConsole();
    fireEvent.click(screen.getByRole('button', { name: 'Open search' }));
    const list = await screen.findByRole('list', { name: 'Shop by category' });
    expect(within(list).getAllByRole('button')).toHaveLength(15);
    fireEvent.click(within(list).getByRole('button', { name: /Category 12/ }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/products?category=category-12'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('Discovery Console text search', () => {
  it('groups real suggestions, highlights the match and opens the keyboard-selected product', async () => {
    renderConsole();
    fireEvent.click(screen.getByRole('button', { name: 'Open search' }));
    const input = await screen.findByRole('combobox', { name: 'Search products' });
    fireEvent.change(input, { target: { value: 'macb' } });
    const listbox = await screen.findByRole('listbox', { name: 'Search suggestions' });
    expect(within(listbox).getByRole('group', { name: 'Products' })).toBeInTheDocument();
    expect(within(listbox).getByRole('group', { name: 'Brands' })).toBeInTheDocument();
    expect(within(listbox).getAllByRole('option')).toHaveLength(4);
    expect(listbox.querySelector('mark')).toHaveTextContent('MacB');
    expect(input).toHaveAttribute('aria-expanded', 'true');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    const options = within(listbox).getAllByRole('option');
    expect(options[1]).toHaveAttribute('aria-selected', 'true');
    expect(input).toHaveAttribute('aria-activedescendant', options[1]!.id);
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    fireEvent.keyDown(input, { key: 'ArrowUp' });
    expect(options[3]).toHaveAttribute('aria-selected', 'true');
    fireEvent.keyDown(input, { key: 'ArrowDown' });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/products/apple-macbook-air'));
    expect(vi.mocked(apiClient).mock.calls.filter(([endpoint]) => endpoint.startsWith('/api/search/suggestions'))).toHaveLength(1);
  });

  it('opens brands in the filtered catalog and submits free text to the /search URL contract', async () => {
    renderConsole();
    fireEvent.click(screen.getByRole('button', { name: 'Open search' }));
    fireEvent.change(await screen.findByRole('combobox'), { target: { value: 'apple' } });
    fireEvent.click(await screen.findByRole('option', { name: /^Apple Brand/ }));
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/products?brand=apple'));
    fireEvent.click(screen.getByRole('button', { name: 'Open search' }));
    const input = await screen.findByRole('combobox');
    fireEvent.change(input, { target: { value: '  sony   headphones ' } });
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/search?q=sony+headphones'));
  });

  it('keeps Enter usable when suggestions fail', async () => {
    vi.mocked(apiClient).mockImplementation(async endpoint => {
      if (endpoint.startsWith('/api/categories')) return { data: [], meta: { total: 0 } } as never;
      throw new ApiError(500, 'Something went wrong.');
    });
    renderConsole();
    fireEvent.click(screen.getByRole('button', { name: 'Open search' }));
    const input = await screen.findByRole('combobox');
    fireEvent.change(input, { target: { value: 'tv' } });
    expect(await screen.findByText(/Suggestions are unavailable right now/)).toBeInTheDocument();
    fireEvent.submit(input.closest('form')!);
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/search?q=tv'));
  });
});

describe('Discovery Console image search', () => {
  it('validates, previews, replaces and removes a photo without uploading it on selection', async () => {
    renderConsole();
    fireEvent.click(screen.getByRole('button', { name: 'Open photo search' }));
    const picker = await screen.findByLabelText('Choose a photo');
    fireEvent.change(picker, { target: { files: [imageFile('notes.txt', 'text/plain')] } });
    expect(screen.getByRole('status', { name: 'Photo search status' })).toHaveTextContent('isn’t a supported image');
    fireEvent.change(picker, { target: { files: [imageFile('huge.jpg', 'image/jpeg', MAX_IMAGE_BYTES + 1)] } });
    expect(screen.getByRole('status', { name: 'Photo search status' })).toHaveTextContent('too large');
    fireEvent.change(picker, { target: { files: [imageFile()] } });
    expect(await screen.findByAltText('Selected photo')).toHaveAttribute('src', 'blob:preview');
    expect(screen.getByText('headphones.png')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Choose a photo'), { target: { files: [imageFile('second.webp', 'image/webp')] } });
    expect(await screen.findByText('second.webp')).toBeInTheDocument();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:preview');
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(await screen.findByRole('heading', { name: 'Search with a photo' })).toBeInTheDocument();
    expect(vi.mocked(apiClient).mock.calls.some(([endpoint]) => endpoint.includes('image'))).toBe(false);
  });

  it('reports image search as unavailable without sending the photo while the endpoint is not enabled', async () => {
    vi.stubEnv('VITE_IMAGE_SEARCH_ENABLED', 'false');
    renderConsole();
    fireEvent.click(screen.getByRole('button', { name: 'Open photo search' }));
    expect(await screen.findByText(/Visual matching isn’t switched on yet/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Choose a photo'), { target: { files: [imageFile()] } });
    fireEvent.click(await screen.findByRole('button', { name: 'Search similar products' }));
    expect(await screen.findByRole('heading', { name: 'Image search isn’t available yet' })).toBeInTheDocument();
    expect(vi.mocked(apiClient).mock.calls.some(([endpoint]) => endpoint.includes('image'))).toBe(false);
    fireEvent.click(screen.getByRole('button', { name: 'Search by text' }));
    await waitFor(() => expect(screen.getByRole('combobox')).toHaveFocus());
  });

  it.each(['drop', 'paste'] as const)('%s validates input and only submits the selected photo on explicit search', async method => {
    vi.stubEnv('VITE_IMAGE_SEARCH_ENABLED', 'true');
    vi.mocked(apiClient).mockImplementation(async endpoint => {
      if (endpoint === '/api/search/image') return { data: { items: [] } } as never;
      return { data: [], meta: { total: 0 } } as never;
    });
    renderConsole();
    fireEvent.click(screen.getByRole('button', { name: 'Open photo search' }));
    const deliver = (file: File) => {
      if (method === 'paste') fireEvent.paste(document, { clipboardData: { files: [file] } });
      else fireEvent.drop(screen.getByRole('heading', { name: 'Search with a photo' }).parentElement!.parentElement!, { dataTransfer: { files: [file] } });
    };
    deliver(imageFile('bad.gif', 'image/gif'));
    expect(screen.getByRole('status', { name: 'Photo search status' })).toHaveTextContent('isn’t a supported image');
    deliver(imageFile('empty.png', 'image/png', 0));
    expect(screen.getByRole('status', { name: 'Photo search status' })).toHaveTextContent('empty');
    deliver(imageFile());
    expect(await screen.findByAltText('Selected photo')).toBeInTheDocument();
    expect(vi.mocked(apiClient).mock.calls.filter(([endpoint]) => endpoint === '/api/search/image')).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Search similar products' }));
    await waitFor(() => expect(screen.getByRole('status', { name: 'Photo search status' })).toHaveTextContent("We couldn't find a close match"));
    expect(screen.getByRole('heading', { name: "We couldn't find a close match" })).toBeInTheDocument();
    expect(screen.getByText('Try another photo or search by product name. You can also explore our catalog.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try another photo' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Search by text' })).toBeEnabled();
    expect(screen.getByRole('button', { name: 'Browse products' })).toBeInTheDocument();
    expect(vi.mocked(apiClient).mock.calls.filter(([endpoint]) => endpoint === '/api/search/image')).toHaveLength(1);
  });

  it.each([
    { status: 200, items: [product('one', 'One')], message: '1 visually similar product found' },
    { status: 200, items: [], message: "We couldn't find a close match" },
    { status: 503, items: [], message: 'Image search is unavailable right now' },
    { status: 504, items: [], message: 'The search took too long' },
    { status: 408, items: [], message: 'The search took too long' },
    { status: 500, items: [], message: 'Image search ran into a problem' },
    { status: 422, items: [], message: 'This photo couldn’t be read' },
  ])('announces $status/$message through one persistent region without duplicate alerts', async ({ status, items, message }) => {
    vi.stubEnv('VITE_IMAGE_SEARCH_ENABLED', 'true');
    let finish: (() => void) | undefined;
    vi.mocked(apiClient).mockImplementation(async endpoint => {
      if (endpoint !== '/api/search/image') return { data: [], meta: { total: 0 } } as never;
      await new Promise<void>(resolve => { finish = resolve; });
      if (status !== 200) throw new ApiError(status, 'controlled response');
      return { data: { items } } as never;
    });
    renderConsole();
    fireEvent.click(screen.getByRole('button', { name: 'Open photo search' }));
    const region = screen.getByRole('status', { name: 'Photo search status' });
    fireEvent.change(screen.getByLabelText('Choose a photo'), { target: { files: [imageFile()] } });
    fireEvent.click(screen.getByRole('button', { name: 'Search similar products' }));
    expect(region).toHaveTextContent('Finding visually similar products');
    expect(screen.getAllByRole('status')).toHaveLength(1);
    await act(async () => finish?.());
    await waitFor(() => expect(region).toHaveTextContent(message));
    expect(screen.getByRole('status', { name: 'Photo search status' })).toBe(region);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('says the photo was not saved (not "not sent") when an enabled service is offline', async () => {
    vi.stubEnv('VITE_IMAGE_SEARCH_ENABLED', 'true');
    vi.mocked(apiClient).mockImplementation(async endpoint => {
      if (endpoint === '/api/search/image') throw new ApiError(503, 'unavailable');
      return { data: [], meta: { total: 0 } } as never;
    });
    renderConsole();
    fireEvent.click(screen.getByRole('button', { name: 'Open photo search' }));
    fireEvent.change(await screen.findByLabelText('Choose a photo'), { target: { files: [imageFile()] } });
    fireEvent.click(await screen.findByRole('button', { name: 'Search similar products' }));
    expect(await screen.findByRole('heading', { name: 'Image search is unavailable right now' })).toBeInTheDocument();
    expect(screen.getByText(/It wasn’t saved/)).toBeInTheDocument();
    expect(screen.queryByText(/wasn’t sent anywhere/)).not.toBeInTheDocument();
  });

  it('renders real gateway results in relevance order with no similarity scores, then opens product details', async () => {
    vi.stubEnv('VITE_IMAGE_SEARCH_ENABLED', 'true');
    vi.mocked(apiClient).mockImplementation(async (endpoint, options) => {
      if (endpoint === '/api/search/image') {
        expect(options?.method).toBe('POST');
        expect(options?.data).toBeInstanceOf(FormData);
        return { data: { items: [product('studio-cans', 'Studio Cans'), product('travel-buds', 'Travel Buds')] } } as never;
      }
      return { data: [], meta: { total: 0 } } as never;
    });
    renderConsole();
    fireEvent.click(screen.getByRole('button', { name: 'Open photo search' }));
    fireEvent.change(await screen.findByLabelText('Choose a photo'), { target: { files: [imageFile()] } });
    fireEvent.click(await screen.findByRole('button', { name: 'Search similar products' }));
    const results = await screen.findByRole('region', { name: 'Visually similar products' });
    const cards = within(results).getAllByRole('link');
    expect(cards.map(card => card.getAttribute('href'))).toEqual(['/products/studio-cans', '/products/travel-buds']);
    expect(within(results).getByText('ordered by visual relevance', { exact: false })).toBeInTheDocument();
    expect(results.textContent).not.toMatch(/%|confidence|score/i);
    expect(within(results).getAllByText('Low stock')).toHaveLength(2);
    fireEvent.click(cards[0]!);
    await waitFor(() => expect(screen.getByTestId('location')).toHaveTextContent('/products/studio-cans'));
  });

  it('cancels an in-flight search and ignores its late answer', async () => {
    vi.stubEnv('VITE_IMAGE_SEARCH_ENABLED', 'true');
    let seenSignal: AbortSignal | undefined;
    vi.mocked(apiClient).mockImplementation(async (endpoint, options) => {
      if (endpoint === '/api/search/image') {
        seenSignal = options?.signal ?? undefined;
        return new Promise((_, reject) => seenSignal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))) as never;
      }
      return { data: [], meta: { total: 0 } } as never;
    });
    renderConsole();
    fireEvent.click(screen.getByRole('button', { name: 'Open photo search' }));
    fireEvent.change(await screen.findByLabelText('Choose a photo'), { target: { files: [imageFile()] } });
    fireEvent.click(await screen.findByRole('button', { name: 'Search similar products' }));
    expect(screen.getByRole('status', { name: 'Photo search status' })).toHaveTextContent('Finding visually similar products…');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(seenSignal?.aborted).toBe(true));
    expect(await screen.findByRole('button', { name: 'Search similar products' })).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: /problem|too long/ })).not.toBeInTheDocument();
  });

  it('maps gateway failures to honest states', async () => {
    vi.stubEnv('VITE_IMAGE_SEARCH_ENABLED', 'true');
    const signal = new AbortController().signal;
    const answer = async (failure: unknown) => { vi.mocked(apiClient).mockRejectedValueOnce(failure); return (await searchByImage(imageFile(), signal)).status; };
    expect(await answer(new ApiError(503, 'unavailable'))).toBe('unavailable');
    expect(await answer(new ApiError(404, 'missing'))).toBe('unavailable');
    expect(await answer(new ApiError(413, 'large'))).toBe('invalid');
    expect(await answer(new ApiError(500, 'boom'))).toBe('error');
    vi.mocked(apiClient).mockResolvedValueOnce({ data: { items: [{ score: 0.9 }] } });
    expect((await searchByImage(imageFile(), signal)).status).toBe('error');
    expect(validateImageFile(imageFile('empty.png', 'image/png', 0))).toBe('empty');
  });
});

describe('Discovery Console camera', () => {
  const originalMediaDevices = navigator.mediaDevices;
  afterEach(() => { vi.restoreAllMocks(); Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: originalMediaDevices }); });
  const stubCamera = (getUserMedia: () => Promise<MediaStream>) => {
    Object.defineProperty(window, 'isSecureContext', { configurable: true, value: true });
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: { getUserMedia: vi.fn(getUserMedia) } });
  };

  it('offers upload when camera permission is denied', async () => {
    stubCamera(() => Promise.reject(new DOMException('denied', 'NotAllowedError')));
    renderConsole();
    fireEvent.click(screen.getByRole('button', { name: 'Open camera' }));
    expect(await screen.findByRole('heading', { name: 'Camera access is blocked' })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Camera status' })).toHaveTextContent('Camera access is blocked');
    expect(screen.getAllByRole('status')).toHaveLength(1);
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledWith(expect.objectContaining({ audio: false }));
    expect(screen.getByRole('button', { name: 'Upload a photo' })).toBeInTheDocument();
  });

  it('names a busy camera, offers Retry camera and does not reprompt on its own', async () => {
    stubCamera(() => Promise.reject(new DOMException('in use', 'NotReadableError')));
    renderConsole();
    fireEvent.click(screen.getByRole('button', { name: 'Open camera' }));
    expect(await screen.findByRole('heading', { name: 'The camera is in use' })).toBeInTheDocument();
    expect(screen.getAllByText(/NotReadableError/).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Upload a photo' })).toBeInTheDocument();
    expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Retry camera' }));
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(2));
  });

  it('does not require a rear camera on desktop and falls back from an over-constrained request', async () => {
    const calls: unknown[] = [];
    stubCamera(((constraints: unknown) => { calls.push(constraints); return calls.length === 1 ? Promise.reject(new DOMException('x', 'OverconstrainedError')) : Promise.reject(new DOMException('gone', 'NotFoundError')); }) as never);
    renderConsole();
    fireEvent.click(screen.getByRole('button', { name: 'Open camera' }));
    expect(await screen.findByRole('heading', { name: 'No camera available' })).toBeInTheDocument();
    expect(JSON.stringify(calls[0])).not.toContain('facingMode');
    expect(calls[1]).toEqual({ video: true, audio: false });
  });

  it('reports a stream that never delivers a frame instead of leaving a black preview', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const stop = vi.fn();
    stubCamera(() => Promise.resolve({ getTracks: () => [{ stop }] } as unknown as MediaStream));
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    renderConsole();
    fireEvent.click(screen.getByRole('button', { name: 'Open camera' }));
    await screen.findByLabelText('Live camera preview');
    await act(async () => { await vi.advanceTimersByTimeAsync(8100); });
    expect(await screen.findByRole('heading', { name: 'The camera sent no picture' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry camera' })).toBeInTheDocument();
    expect(stop).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('does not report a live preview for a muted track and shows the no-picture recovery state', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const stop = vi.fn();
    const track = Object.assign(new EventTarget(), { stop, muted: true });
    stubCamera(() => Promise.resolve({ getTracks: () => [track], getVideoTracks: () => [track] } as unknown as MediaStream));
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLVideoElement.prototype, 'videoWidth', 'get').mockReturnValue(640);
    renderConsole();
    fireEvent.click(screen.getByRole('button', { name: 'Open camera' }));
    await screen.findByLabelText('Live camera preview');
    fireEvent.loadedData(screen.getByLabelText('Live camera preview'));
    expect(screen.getByRole('button', { name: 'Take photo' })).toBeDisabled();
    await act(async () => { await vi.advanceTimersByTimeAsync(8100); });
    expect(await screen.findByRole('heading', { name: 'The camera sent no picture' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry camera' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Upload a photo' })).toBeInTheDocument();
    expect(stop).toHaveBeenCalled();
    vi.useRealTimers();
  });

  it('requests video only after the press and stops every track when the console closes', async () => {
    const stop = vi.fn();
    stubCamera(() => Promise.resolve({ getTracks: () => [{ stop }] } as unknown as MediaStream));
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    renderConsole();
    expect(navigator.mediaDevices.getUserMedia).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Open camera' }));
    expect(await screen.findByLabelText('Live camera preview')).toBeInTheDocument();
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(1));
    await act(async () => { fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' }); });
    expect(await screen.findByRole('heading', { name: 'Search with a photo' })).toBeInTheDocument();
    expect(stop).toHaveBeenCalled();
  });

  it('captures, stops the camera, retakes and selects a photo without uploading', async () => {
    const stop = vi.fn();
    stubCamera(() => Promise.resolve({ getTracks: () => [{ stop }] } as unknown as MediaStream));
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLVideoElement.prototype, 'videoWidth', 'get').mockReturnValue(640);
    vi.spyOn(HTMLVideoElement.prototype, 'videoHeight', 'get').mockReturnValue(480);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(new Blob(['capture'], { type: 'image/jpeg' })));
    renderConsole();
    fireEvent.click(screen.getByRole('button', { name: 'Open camera' }));
    const shutter = await screen.findByRole('button', { name: 'Take photo' });
    await waitFor(() => expect(shutter).toBeEnabled());
    fireEvent.click(shutter);
    expect(await screen.findByAltText('Captured photo')).toBeInTheDocument();
    expect(stop).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Retake' }));
    await waitFor(() => expect(navigator.mediaDevices.getUserMedia).toHaveBeenCalledTimes(2));
    expect(URL.revokeObjectURL).toHaveBeenCalled();
    fireEvent.click(await screen.findByRole('button', { name: 'Take photo' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Use this photo' }));
    expect(await screen.findByAltText('Selected photo')).toBeInTheDocument();
    expect(stop).toHaveBeenCalledTimes(2);
    expect(vi.mocked(apiClient).mock.calls.some(([endpoint]) => endpoint === '/api/search/image')).toBe(false);
  });

  it('advises a retake for a very dark capture but still allows using it', async () => {
    stubCamera(() => Promise.resolve({ getTracks: () => [{ stop: vi.fn() }] } as unknown as MediaStream));
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLVideoElement.prototype, 'videoWidth', 'get').mockReturnValue(640);
    vi.spyOn(HTMLVideoElement.prototype, 'videoHeight', 'get').mockReturnValue(480);
    const dark = new Uint8ClampedArray(32 * 24 * 4).fill(20);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
      { drawImage: vi.fn(), getImageData: () => ({ data: dark }) } as unknown as CanvasRenderingContext2D);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => callback(new Blob(['capture'], { type: 'image/jpeg' })));
    renderConsole();
    fireEvent.click(screen.getByRole('button', { name: 'Open camera' }));
    const shutter = await screen.findByRole('button', { name: 'Take photo' });
    await waitFor(() => expect(shutter).toBeEnabled());
    fireEvent.click(shutter);
    expect(await screen.findByText('This photo looks dark. For better matches, retake it in brighter light.')).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Camera status' })).toHaveTextContent('It looks dark');
    fireEvent.click(screen.getByRole('button', { name: 'Use this photo' }));
    expect(await screen.findByAltText('Selected photo')).toBeInTheDocument();
  });

  it('does not create a retained image URL if canvas encoding finishes after closing the camera', async () => {
    const stop = vi.fn();
    stubCamera(() => Promise.resolve({ getTracks: () => [{ stop }] } as unknown as MediaStream));
    vi.spyOn(HTMLMediaElement.prototype, 'play').mockResolvedValue(undefined);
    vi.spyOn(HTMLVideoElement.prototype, 'videoWidth', 'get').mockReturnValue(640);
    vi.spyOn(HTMLVideoElement.prototype, 'videoHeight', 'get').mockReturnValue(480);
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D);
    let encoded: BlobCallback | undefined;
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(callback => { encoded = callback; });
    renderConsole();
    fireEvent.click(screen.getByRole('button', { name: 'Open camera' }));
    const shutter = await screen.findByRole('button', { name: 'Take photo' });
    await waitFor(() => expect(shutter).toBeEnabled());
    fireEvent.click(shutter);
    fireEvent.keyDown(screen.getByRole('combobox'), { key: 'Escape' });
    await act(async () => encoded?.(new Blob(['late'], { type: 'image/jpeg' })));
    expect(stop).toHaveBeenCalledTimes(1);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
    expect(screen.queryByAltText('Captured photo')).not.toBeInTheDocument();
  });
});
