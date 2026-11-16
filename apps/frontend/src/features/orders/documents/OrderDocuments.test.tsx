import { cloneElement, type ReactElement } from 'react';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError, apiBinary, apiClient, type BinaryDocument } from '@/lib/api';
import { OrderDocumentsPanel } from './OrderDocumentsPanel';
import { OrderDocumentsChooser } from './OrderDocumentsChooser';
import { documentErrorMessage } from './useOrderDocuments';
import type { OrderDocumentEntry, OrderDocumentsDto } from './types';

const authState = vi.hoisted(() => ({ user: { id: 'user-a' } as { id: string } | null, isSessionVerified: true, isLoggingOut: false }));

vi.mock('@/lib/api', async importOriginal => ({
  ...await importOriginal<typeof import('@/lib/api')>(),
  apiClient: vi.fn(),
  apiBinary: vi.fn(),
}));
vi.mock('@/features/auth/context/AuthContext', () => ({
  useAuth: () => ({ user: authState.user, isSessionVerified: authState.isSessionVerified, isLoggingOut: authState.isLoggingOut }),
}));

const ORDER = 'ORD-X';
const INVOICE_NAME = 'Order invoice (non-tax)';
const PREVIEW_URL = 'blob:electrohub/mock';
const createObjectURL = vi.fn(() => PREVIEW_URL);
const revokeObjectURL = vi.fn();
let anchorClicks: { href: string; download: string }[] = [];

function entry(kind: OrderDocumentEntry['kind'], label: string, overrides: Partial<OrderDocumentEntry> = {}): OrderDocumentEntry {
  return {
    kind, label, description: `${label} for this order.`, availability: 'AVAILABLE', reasonCode: null,
    mediaType: 'application/pdf', filename: null, contentVersion: 'v1.x', templateVersion: '1', policy: 'COMMERCIAL_V1',
    issuedAt: null, purchaseDate: '2026-09-04T00:00:00.000Z', paidAt: '2026-09-04T00:00:00.000Z',
    previewPath: `/api/orders/${ORDER}/documents/${kind}?disposition=inline`,
    downloadPath: `/api/orders/${ORDER}/documents/${kind}?disposition=attachment`,
    ...overrides,
  };
}
const available = (): OrderDocumentsDto => ({ orderReference: ORDER, documents: [
  entry('invoice', INVOICE_NAME), entry('receipt', 'Payment receipt'), entry('summary', 'Order summary'),
] });
const pending = (): OrderDocumentsDto => ({ orderReference: ORDER, documents: [
  entry('invoice', INVOICE_NAME, { availability: 'UNAVAILABLE', reasonCode: 'PAYMENT_NOT_CONFIRMED', previewPath: null, downloadPath: null }),
  entry('receipt', 'Payment receipt', { availability: 'UNAVAILABLE', reasonCode: 'PAYMENT_NOT_CONFIRMED', previewPath: null, downloadPath: null }),
  entry('summary', 'Order summary'),
] });
const binary = (): BinaryDocument => ({ blob: new Blob(['%PDF-1.7'], { type: 'application/pdf' }), byteLength: 8,
  filename: 'ElectroHub-ORD-X-invoice.pdf', contentVersion: 'v1.x' });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

/** Renders inside the real providers; `update` re-renders the same tree so the mutable auth state is read again. */
function renderUi(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const tree = (node: ReactElement) => <QueryClientProvider client={client}><MemoryRouter>{node}</MemoryRouter></QueryClientProvider>;
  const view = render(tree(ui));
  // cloneElement yields a new element object; re-rendering the identical element would let React bail out and skip reading the mutable auth state.
  return { client, ...view, update: () => view.rerender(tree(cloneElement(ui))) };
}
const panel = (variant: 'confirmation' | 'details' | 'chooser' = 'details') => <OrderDocumentsPanel orderReference={ORDER} variant={variant} />;
const viewButton = (label = INVOICE_NAME) => screen.getByRole('button', { name: `View PDF: ${label}, order ${ORDER}` });
const downloadButton = (label = INVOICE_NAME) => screen.getByRole('button', { name: `Download PDF: ${label}, order ${ORDER}` });

beforeEach(() => {
  vi.mocked(apiClient).mockReset();
  vi.mocked(apiClient).mockResolvedValue({ data: available() });
  vi.mocked(apiBinary).mockReset();
  vi.mocked(apiBinary).mockResolvedValue(binary());
  createObjectURL.mockClear();
  revokeObjectURL.mockClear();
  URL.createObjectURL = createObjectURL as unknown as typeof URL.createObjectURL;
  URL.revokeObjectURL = revokeObjectURL;
  anchorClicks = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    anchorClicks.push({ href: this.href, download: this.download });
  });
  authState.user = { id: 'user-a' };
  authState.isSessionVerified = true;
  authState.isLoggingOut = false;
});

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(navigator, 'pdfViewerEnabled');
});

describe('OrderDocumentsPanel variants and states', () => {
  it('uses the confirmation and details headings', async () => {
    const first = renderUi(panel('confirmation'));
    expect(await screen.findByRole('heading', { name: 'Your documents' })).toBeInTheDocument();
    first.unmount();
    renderUi(panel('details'));
    expect(await screen.findByRole('heading', { name: 'Documents' })).toBeInTheDocument();
  });

  it('shows a labelled loading status with no actions and no empty-state copy while metadata is pending', async () => {
    vi.mocked(apiClient).mockReturnValue(new Promise(() => {}));
    renderUi(panel());
    expect(screen.getByRole('status', { name: 'Loading documents' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^(View|Download) PDF:/ })).toBeNull();
    expect(screen.queryByText(/No documents/i)).toBeNull();
  });

  it('renders View and Download buttons with exact names for every available document', async () => {
    renderUi(panel());
    for (const label of [INVOICE_NAME, 'Payment receipt', 'Order summary']) {
      expect(await screen.findByRole('button', { name: `View PDF: ${label}, order ${ORDER}` })).toBeEnabled();
      expect(screen.getByRole('button', { name: `Download PDF: ${label}, order ${ORDER}` })).toBeEnabled();
    }
    expect(apiClient).toHaveBeenCalledWith(`/api/orders/${ORDER}/documents`, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('explains pending invoice and receipt without working actions while the summary stays available', async () => {
    vi.mocked(apiClient).mockResolvedValue({ data: pending() });
    renderUi(panel());
    await screen.findByRole('button', { name: `View PDF: Order summary, order ${ORDER}` });
    expect(screen.getAllByText('Available after a successful payment is recorded for this order.')).toHaveLength(2);
    expect(screen.queryByRole('button', { name: /PDF: Order invoice/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /PDF: Payment receipt/ })).toBeNull();
    expect(downloadButton('Order summary')).toBeEnabled();
  });

  it('shows a row-independent error with Retry, and Retry refetches metadata', async () => {
    vi.mocked(apiClient).mockRejectedValueOnce(new ApiError(0, 'Unable to connect. Please try again.'));
    renderUi(panel());
    expect(await screen.findByRole('alert')).toHaveTextContent('Documents could not be loaded. Your order is not affected.');
    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));
    await screen.findByRole('button', { name: `View PDF: ${INVOICE_NAME}, order ${ORDER}` });
    expect(apiClient).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['session not verified', () => { authState.isSessionVerified = false; }],
    ['logout in progress', () => { authState.isLoggingOut = true; }],
    ['no user', () => { authState.user = null; }],
  ])('does not request metadata when the %s', async (_label, setState) => {
    setState();
    renderUi(panel());
    await act(async () => { await Promise.resolve(); });
    expect(apiClient).not.toHaveBeenCalled();
  });
});

describe('preview (View)', () => {
  it('opens the dialog immediately with a scoped loading state, then shows the blob-backed iframe', async () => {
    const pdf = deferred<BinaryDocument>();
    vi.mocked(apiBinary).mockReturnValueOnce(pdf.promise);
    renderUi(panel());
    fireEvent.click(await screen.findByRole('button', { name: `View PDF: ${INVOICE_NAME}, order ${ORDER}` }));
    const dialog = screen.getByRole('dialog', { name: INVOICE_NAME });
    expect(within(dialog).getByText('Preparing your PDF…')).toBeInTheDocument();
    expect(apiBinary).toHaveBeenCalledWith(`/api/orders/${ORDER}/documents/invoice?disposition=inline`,
      expect.objectContaining({ fallbackFilename: 'ElectroHub-ORD-X-invoice.pdf', signal: expect.any(AbortSignal) }));
    await act(async () => pdf.resolve(binary()));
    const frame = await screen.findByTitle(`${INVOICE_NAME} for order ${ORDER}`);
    expect(frame.tagName).toBe('IFRAME');
    expect(frame).toHaveAttribute('src', PREVIEW_URL);
    expect(createObjectURL).toHaveBeenCalledTimes(1);
  });

  it('revokes the preview URL on close', async () => {
    const user = userEvent.setup();
    renderUi(panel());
    await user.click(await screen.findByRole('button', { name: `View PDF: ${INVOICE_NAME}, order ${ORDER}` }));
    await screen.findByTitle(`${INVOICE_NAME} for order ${ORDER}`);
    await user.click(screen.getByRole('button', { name: 'Close preview' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(revokeObjectURL).toHaveBeenCalledWith(PREVIEW_URL);
  });

  // KNOWN BUG (expected to fail): DocumentPreviewDialog has no DialogTrigger, so Radix has no triggerRef to restore focus to.
  // On close, focus falls to document.body instead of the View button (DocumentPreviewDialog.tsx Dialog/DialogContent, spec 10.5).
  it('returns focus to the View button when the preview closes', async () => {
    const user = userEvent.setup();
    renderUi(panel());
    const view = await screen.findByRole('button', { name: `View PDF: ${INVOICE_NAME}, order ${ORDER}` });
    await user.click(view);
    await screen.findByTitle(`${INVOICE_NAME} for order ${ORDER}`);
    await user.click(screen.getByRole('button', { name: 'Close preview' }));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(view).toHaveFocus();
  });

  it('shows a working Download fallback and no iframe when the browser has no inline PDF viewer', async () => {
    Object.defineProperty(navigator, 'pdfViewerEnabled', { value: false, configurable: true });
    renderUi(panel());
    fireEvent.click(await screen.findByRole('button', { name: `View PDF: ${INVOICE_NAME}, order ${ORDER}` }));
    const dialog = await screen.findByRole('dialog', { name: INVOICE_NAME });
    expect(await within(dialog).findByText('This browser can’t show PDFs inside the page.')).toBeInTheDocument();
    expect(dialog.querySelector('iframe')).toBeNull();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Download PDF' }));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(anchorClicks).toEqual([{ href: PREVIEW_URL, download: 'ElectroHub-ORD-X-invoice.pdf' }]);
  });
});

describe('download', () => {
  it('fetches the attachment path with the canonical fallback name, starts a download and announces it politely', async () => {
    renderUi(panel());
    fireEvent.click(await screen.findByRole('button', { name: `Download PDF: ${INVOICE_NAME}, order ${ORDER}` }));
    await screen.findByText(`${INVOICE_NAME} PDF download started.`);
    expect(apiBinary).toHaveBeenCalledWith(`/api/orders/${ORDER}/documents/invoice?disposition=attachment`,
      expect.objectContaining({ fallbackFilename: 'ElectroHub-ORD-X-invoice.pdf' }));
    expect(createObjectURL).toHaveBeenCalledTimes(1);
    expect(anchorClicks).toEqual([{ href: PREVIEW_URL, download: 'ElectroHub-ORD-X-invoice.pdf' }]);
    expect(screen.getByText(`${INVOICE_NAME} PDF download started.`).closest('[aria-live]')).toHaveAttribute('aria-live', 'polite');
    expect(document.body).not.toHaveTextContent(/saved/i);
  });

  it('issues exactly one request for a rapid double activation', async () => {
    const pdf = deferred<BinaryDocument>();
    vi.mocked(apiBinary).mockReturnValue(pdf.promise);
    renderUi(panel());
    const button = await screen.findByRole('button', { name: `Download PDF: ${INVOICE_NAME}, order ${ORDER}` });
    act(() => { fireEvent.click(button); fireEvent.click(button); });
    expect(apiBinary).toHaveBeenCalledTimes(1);
    await act(async () => pdf.resolve(binary()));
    await screen.findByText(`${INVOICE_NAME} PDF download started.`);
    expect(anchorClicks).toHaveLength(1);
  });

  it('disables every other document action while one request is busy', async () => {
    const pdf = deferred<BinaryDocument>();
    vi.mocked(apiBinary).mockReturnValueOnce(pdf.promise);
    renderUi(panel());
    fireEvent.click(await screen.findByRole('button', { name: `Download PDF: ${INVOICE_NAME}, order ${ORDER}` }));
    expect(screen.getByRole('button', { name: `Download PDF: ${INVOICE_NAME}, order ${ORDER}` })).toBeDisabled();
    expect(viewButton(INVOICE_NAME)).toBeDisabled();
    expect(viewButton('Payment receipt')).toBeDisabled();
    expect(downloadButton('Order summary')).toBeDisabled();
    await act(async () => pdf.resolve(binary()));
    await waitFor(() => expect(viewButton('Payment receipt')).toBeEnabled());
  });
});

describe('error handling', () => {
  it('shows the 409 row message and refetches metadata so the list is corrected', async () => {
    vi.mocked(apiBinary).mockRejectedValueOnce(new ApiError(409, 'Gone.', undefined, 'DOCUMENT_NOT_AVAILABLE'));
    renderUi(panel());
    fireEvent.click(await screen.findByRole('button', { name: `Download PDF: ${INVOICE_NAME}, order ${ORDER}` }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'This document is no longer available for this order. The list has been updated.');
    await waitFor(() => expect(apiClient).toHaveBeenCalledTimes(2));
  });

  it.each([
    [422, 'This document can’t be generated from the recorded order details. Your order details on this page are unaffected.'],
    [429, 'Too many document requests. Please wait a moment and try again.'],
    [503, 'Documents are temporarily unavailable. Please try again shortly.'],
    [0, 'Unable to connect. Check your connection and try again.'],
  ])('shows the matching message for HTTP status %i', async (status, message) => {
    vi.mocked(apiBinary).mockRejectedValueOnce(new ApiError(status, 'internal detail'));
    renderUi(panel());
    fireEvent.click(await screen.findByRole('button', { name: `Download PDF: ${INVOICE_NAME}, order ${ORDER}` }));
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.queryByText('internal detail')).toBeNull();
    expect(anchorClicks).toHaveLength(0);
  });

  it('a 429 starts a visible cooldown that disables further document actions', async () => {
    vi.mocked(apiBinary).mockRejectedValueOnce(new ApiError(429, 'Slow down.'));
    renderUi(panel());
    fireEvent.click(await screen.findByRole('button', { name: `Download PDF: ${INVOICE_NAME}, order ${ORDER}` }));
    expect(await screen.findByText('Please wait a few seconds before requesting another document.')).toBeInTheDocument();
    expect(viewButton('Order summary')).toBeDisabled();
  });
});

describe('documentErrorMessage', () => {
  it.each([
    ['a non-ApiError', new Error('boom'), 'The document could not be prepared. Please try again.'],
    ['an invalid-response code', new ApiError(200, 'x', undefined, 'DOCUMENT_INVALID_RESPONSE'), 'The document could not be loaded. Please try again.'],
    ['status 0', new ApiError(0, 'x'), 'Unable to connect. Check your connection and try again.'],
    ['status 401', new ApiError(401, 'x'), 'Your session has expired. Please sign in again.'],
    ['status 404', new ApiError(404, 'x'), 'This order could not be found for your account.'],
    ['status 409', new ApiError(409, 'x'), 'This document is no longer available for this order. The list has been updated.'],
    ['status 422', new ApiError(422, 'x'), 'This document can’t be generated from the recorded order details. Your order details on this page are unaffected.'],
    ['status 429', new ApiError(429, 'x'), 'Too many document requests. Please wait a moment and try again.'],
    ['status 503 without a timeout code', new ApiError(503, 'x'), 'Documents are temporarily unavailable. Please try again shortly.'],
    ['status 503 with the timeout code', new ApiError(503, 'x', undefined, 'DOCUMENT_GENERATION_TIMEOUT'), 'The document took too long to prepare. Please try again.'],
    ['an unmapped status', new ApiError(500, 'x'), 'The document could not be prepared. Please try again.'],
  ])('maps %s to its user message', (_label, error, message) => {
    expect(documentErrorMessage(error)).toBe(message);
  });
});

describe('late responses after session changes', () => {
  it('discards a download that resolves after an account switch: no object URL and no announcement', async () => {
    const pdf = deferred<BinaryDocument>();
    vi.mocked(apiBinary).mockReturnValueOnce(pdf.promise);
    const view = renderUi(panel());
    fireEvent.click(await screen.findByRole('button', { name: `Download PDF: ${INVOICE_NAME}, order ${ORDER}` }));
    authState.user = { id: 'user-b' };
    view.update();
    await act(async () => pdf.resolve(binary()));
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(anchorClicks).toHaveLength(0);
    expect(screen.queryByText(`${INVOICE_NAME} PDF download started.`)).toBeNull();
  });

  it('closes a loading preview on logout and never creates its object URL', async () => {
    const pdf = deferred<BinaryDocument>();
    vi.mocked(apiBinary).mockReturnValueOnce(pdf.promise);
    const view = renderUi(panel());
    fireEvent.click(await screen.findByRole('button', { name: `View PDF: ${INVOICE_NAME}, order ${ORDER}` }));
    expect(screen.getByRole('dialog', { name: INVOICE_NAME })).toBeInTheDocument();
    authState.isLoggingOut = true;
    view.update();
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await act(async () => pdf.resolve(binary()));
    expect(createObjectURL).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('OrderDocumentsChooser', () => {
  it('makes no metadata request until the Documents trigger opens the dialog, then lists the three rows', async () => {
    const user = userEvent.setup();
    renderUi(<OrderDocumentsChooser orderReference={ORDER} />);
    await act(async () => { await Promise.resolve(); });
    expect(apiClient).not.toHaveBeenCalled();
    await user.click(screen.getByRole('button', { name: `Documents for order ${ORDER}` }));
    const dialog = await screen.findByRole('dialog', { name: 'Documents' });
    expect(dialog).toHaveAccessibleDescription(`Order ${ORDER}`);
    expect(await within(dialog).findByRole('button', { name: `View PDF: ${INVOICE_NAME}, order ${ORDER}` })).toBeInTheDocument();
    expect(within(dialog).getAllByRole('listitem')).toHaveLength(3);
    expect(apiClient).toHaveBeenCalledTimes(1);
  });
});
