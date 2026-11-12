import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useNavigate } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';
import { ApiError } from '@/lib/api';
import { reportMutationFailure } from '@/lib/query';
import { ToastCenter } from './ToastCenter';
import { describeError, toastError } from './describeError';
import { DEDUPE_MS, MAX_VISIBLE, getToasts, toast } from './toastStore';

const raise = (run: () => void) => act(() => { run(); });

describe('toast store', () => {
  it('collapses identical toasts raised in a burst and replaces by id', () => {
    const first = toast.success('Saved');
    const second = toast.success('Saved');
    expect(second).toBe(first);
    expect(getToasts()).toHaveLength(1);
    toast.loading('Saving…', { id: 'save' });
    toast.success('Saved for real', { id: 'save' });
    expect(getToasts().filter(item => item.id === 'save')).toMatchObject([{ variant: 'success', title: 'Saved for real' }]);
  });

  it('allows the same message again once the dedupe window has passed', () => {
    vi.useFakeTimers();
    try {
      toast.info('Heads up');
      vi.advanceTimersByTime(DEDUPE_MS + 1);
      toast.info('Heads up');
      expect(getToasts()).toHaveLength(2);
    } finally { vi.useRealTimers(); }
  });

  it('keeps the queue bounded, dropping the oldest', () => {
    for (let index = 0; index < MAX_VISIBLE + 4; index += 1) toast.info(`Message ${index}`);
    const titles = getToasts().map(item => item.title);
    expect(titles).toHaveLength(MAX_VISIBLE);
    expect(titles.at(-1)).toBe(`Message ${MAX_VISIBLE + 3}`);
    expect(titles).not.toContain('Message 0');
  });

  it('ignores empty titles and gives loading toasts no auto-dismiss', () => {
    expect(toast.error('   ')).toBe('');
    toast.loading('Working…');
    expect(getToasts()[0]).toMatchObject({ variant: 'loading', duration: 0 });
  });
});

describe('ToastCenter', () => {
  it('renders every variant and dismisses with a labelled button', async () => {
    const user = userEvent.setup();
    render(<ToastCenter />);
    raise(() => { toast.success('Saved'); toast.warning('Careful'); toast.error('Broke'); });
    for (const text of ['Saved', 'Careful', 'Broke']) expect(await screen.findByText(text)).toBeInTheDocument();
    expect(document.querySelectorAll('[data-toast-variant]')).toHaveLength(3);
    const toasts = [...document.querySelectorAll<HTMLElement>('[data-toast-variant]')];
    expect(toasts.map(node => node.dataset.toastVariant)).toEqual(['success', 'warning', 'error']);
    await user.click(within(toasts[0]!).getByRole('button', { name: 'Dismiss notification' }));
    await waitFor(() => expect(screen.queryByText('Saved')).not.toBeInTheDocument());
    expect(getToasts().map(item => item.title)).toEqual(['Careful', 'Broke']);
  });

  it('runs a safe action once and closes the toast', async () => {
    const user = userEvent.setup();
    const retry = vi.fn();
    render(<ToastCenter />);
    raise(() => { toast.error('Failed', { description: 'Network hiccup', action: { label: 'Retry', onClick: retry } }); });
    await user.click(await screen.findByRole('button', { name: 'Retry' }));
    expect(retry).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(getToasts()).toHaveLength(0));
  });

  it('never steals focus and keeps a non-announced toast out of the live region', async () => {
    render(<><button>Before</button><ToastCenter /></>);
    screen.getByRole('button', { name: 'Before' }).focus();
    raise(() => { toast.success('Added to cart', { announce: false }); toast.error('Needs attention'); });
    await screen.findByText('Added to cart');
    expect(screen.getByRole('button', { name: 'Before' })).toHaveFocus();
    const silent = screen.getByText('Added to cart').closest('[data-radix-toast-announce-exclude]');
    expect(silent).not.toBeNull();
    expect(screen.getByText('Needs attention').closest('[data-radix-toast-announce-exclude]')).toBeNull();
  });

  it('renders a single viewport even when another provider is mounted', async () => {
    render(<><ToastCenter /><ToastCenter /></>);
    raise(() => { toast.info('Once'); });
    await screen.findByText('Once');
    expect(screen.getAllByText('Once')).toHaveLength(1);
    expect(document.querySelectorAll('[data-testid="toast-viewport"]')).toHaveLength(1);
  });

  it('drops pending toasts when the route changes but keeps finished ones', async () => {
    const user = userEvent.setup();
    function Nav() { const navigate = useNavigate(); return <button onClick={() => navigate('/next')}>Go</button>; }
    render(<MemoryRouter><Nav /><ToastCenter /></MemoryRouter>);
    raise(() => { toast.loading('Uploading…'); toast.success('Done earlier'); });
    await screen.findByText('Uploading…');
    await user.click(screen.getByRole('button', { name: 'Go' }));
    await waitFor(() => expect(screen.queryByText('Uploading…')).not.toBeInTheDocument());
    expect(screen.getByText('Done earlier')).toBeInTheDocument();
  });
});

describe('error feedback', () => {
  const api = (status: number, message = 'Server said no') => new ApiError(status, message);

  it('differentiates failures and never calls a 403 a network outage', () => {
    expect(describeError(api(403), 'edit this order')).toMatchObject({ kind: 'forbidden', title: "You don't have permission to edit this order" });
    expect(describeError(api(409), 'save')).toMatchObject({ kind: 'conflict', retryable: false });
    expect(describeError(api(429), 'save')).toMatchObject({ kind: 'rate-limited', retryable: true });
    expect(describeError(api(503), 'save')).toMatchObject({ kind: 'unavailable', retryable: true });
    expect(describeError(api(401), 'save')).toMatchObject({ kind: 'unauthorized' });
    expect(describeError(api(404), 'save')).toMatchObject({ kind: 'not-found' });
    expect(describeError(new TypeError('Failed to fetch'), 'save')).toMatchObject({ kind: 'offline' });
  });

  it('never surfaces raw exception text, and can prefer a sanitized server message for forms', () => {
    const leaked = describeError(new Error('SELECT * FROM users; password=hunter2'), 'save');
    expect(JSON.stringify(leaked)).not.toMatch(/SELECT|hunter2/);
    expect(describeError(api(401, 'Current password is incorrect.'), 'change your password', { preferServerMessage: true }))
      .toMatchObject({ kind: 'validation', description: 'Current password is incorrect.' });
    expect(describeError(api(500, 'boom'), 'save', { preferServerMessage: true }).kind).toBe('unavailable');
  });

  it('offers Retry only for transient failures', () => {
    const retry = vi.fn();
    toastError(api(503), 'save', { retry });
    expect(getToasts().at(-1)?.action?.label).toBe('Retry');
    toastError(api(403), 'save', { retry });
    expect(getToasts().at(-1)?.action).toBeUndefined();
  });

  it('reports mutation failures once per kind, and skips validation, 401, aborts and silent mutations', () => {
    reportMutationFailure(api(422, 'Name is required'), { action: 'save the product' });
    reportMutationFailure(api(400, 'Bad'));
    reportMutationFailure(api(401, 'Expired'));
    reportMutationFailure(new DOMException('aborted', 'AbortError'));
    reportMutationFailure(api(500), { silent: true });
    expect(getToasts()).toHaveLength(0);
    reportMutationFailure(api(403), { action: 'delete this category' });
    reportMutationFailure(api(403), { action: 'delete this category' });
    expect(getToasts()).toMatchObject([{ variant: 'warning', title: "You don't have permission to delete this category" }]);
    reportMutationFailure(api(500), { action: 'save the product' });
    expect(getToasts().at(-1)).toMatchObject({ variant: 'error', title: "Couldn't save the product: service temporarily unavailable" });
  });
});
