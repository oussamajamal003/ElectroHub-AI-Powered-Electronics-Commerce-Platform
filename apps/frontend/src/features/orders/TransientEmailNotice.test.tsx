import { act, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { NOTICE_LIFETIME_MS, resetEmailNoticeWindows } from './emailNoticeWindow';
import { TransientEmailNotice } from './TransientEmailNotice';
import { OrdersAccessGate } from './OrdersAccessGate';

const auth = { isAuthenticated: true, isInitializing: false, isLoggingOut: false, sessionUnavailable: false, retrySession: vi.fn() };
vi.mock('@/features/auth/context/AuthContext', () => ({ useAuth: () => auth }));

const fresh = () => ({ orderReference: 'ORD-1', createdAt: new Date().toISOString(), paymentState: 'PAID' as const, status: 'CONFIRMED',
  emailConfirmation: { state: 'QUEUED' as const, updatedAt: '' } });
const queued = /confirmations are queued/;

beforeEach(() => { vi.useFakeTimers(); resetEmailNoticeWindows(); Object.assign(auth, { isAuthenticated: true, isLoggingOut: false, isInitializing: false }); });
afterEach(() => { vi.useRealTimers(); });

describe('TransientEmailNotice lifetime (Task 03.8)', () => {
  it('shows for a new paid order and is removed completely at exactly 60 seconds', () => {
    const { container } = render(<TransientEmailNotice ownerId="u1" order={fresh()} />);
    expect(screen.getByText(queued)).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(NOTICE_LIFETIME_MS - 1); });
    expect(screen.getByText(queued)).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(1); });
    expect(screen.queryByText(queued)).not.toBeInTheDocument();
    expect(container).toBeEmptyDOMElement(); // no wrapper, so no layout gap
  });

  it('does not restart on rerender or refetch with new data, and reflects the truthful state while visible', () => {
    const order = fresh();
    const { rerender } = render(<TransientEmailNotice ownerId="u1" order={order} />);
    act(() => { vi.advanceTimersByTime(40_000); });
    rerender(<TransientEmailNotice ownerId="u1" order={{ ...order, emailConfirmation: { state: 'SENT', updatedAt: 'x' } }} />);
    expect(screen.getAllByText(/confirmations have been sent/).length).toBeGreaterThan(0); // visible text plus the polite live-region announcement
    act(() => { vi.advanceTimersByTime(20_000); });
    expect(screen.queryAllByText(/confirmations have been sent/)).toHaveLength(0);
  });

  it('keeps the remaining lifetime across navigation (remount) and never returns once expired', () => {
    const order = fresh();
    const first = render(<TransientEmailNotice ownerId="u1" order={order} />);
    act(() => { vi.advanceTimersByTime(45_000); });
    first.unmount();
    const second = render(<TransientEmailNotice ownerId="u1" order={order} />);
    expect(screen.getByText(queued)).toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(15_000); });
    expect(screen.queryByText(queued)).not.toBeInTheDocument();
    second.unmount();
    render(<TransientEmailNotice ownerId="u1" order={order} />);
    expect(screen.queryByText(queued)).not.toBeInTheDocument();
  });

  it('never starts for a historical order, an unpaid order, a cancelled order, or without an owner', () => {
    const { container } = render(<>
      <TransientEmailNotice ownerId="u1" order={{ ...fresh(), createdAt: '2020-01-01T00:00:00.000Z' }} />
      <TransientEmailNotice ownerId="u1" order={{ ...fresh(), orderReference: 'ORD-2', paymentState: 'PENDING' }} />
      <TransientEmailNotice ownerId="u1" order={{ ...fresh(), orderReference: 'ORD-3', status: 'CANCELLED' }} />
      <TransientEmailNotice ownerId="" order={{ ...fresh(), orderReference: 'ORD-4' }} />
    </>);
    expect(container).toBeEmptyDOMElement();
  });

  it('does not reuse a previous account\'s expired window, and signing out removes a visible notice immediately', () => {
    const order = fresh();
    const { rerender } = render(<TransientEmailNotice ownerId="u1" order={order} />);
    expect(screen.getByText(queued)).toBeInTheDocument();
    rerender(<TransientEmailNotice ownerId="" order={order} />);
    expect(screen.queryByText(queued)).not.toBeInTheDocument();
    act(() => { vi.advanceTimersByTime(NOTICE_LIFETIME_MS); });
    rerender(<TransientEmailNotice ownerId="u1" order={order} />);
    expect(screen.queryByText(queued)).not.toBeInTheDocument(); // u1's window already expired
  });

  it('expiry performs no network call', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    render(<TransientEmailNotice ownerId="u1" order={fresh()} />);
    act(() => { vi.advanceTimersByTime(NOTICE_LIFETIME_MS * 2); });
    expect(fetchSpy).not.toHaveBeenCalled();
    fetchSpy.mockRestore();
  });
});

describe('OrdersAccessGate during logout (Task 03.8)', () => {
  const gate = () => render(<MemoryRouter><OrdersAccessGate title="My Orders" loading={<p>loading</p>}><p>private orders</p></OrdersAccessGate></MemoryRouter>);

  it('shows neither private data nor "Sign In Required" while an explicit logout is in progress', () => {
    Object.assign(auth, { isAuthenticated: false, isLoggingOut: true });
    gate();
    expect(screen.queryByText('Sign In Required')).not.toBeInTheDocument();
    expect(screen.queryByText('private orders')).not.toBeInTheDocument();
  });

  it('hides stale private data from the first moment of logout, before the session clears', () => {
    Object.assign(auth, { isAuthenticated: true, isLoggingOut: true });
    gate();
    expect(screen.queryByText('private orders')).not.toBeInTheDocument();
  });

  it('a genuinely unauthenticated visitor still gets the protected Sign In Required state', () => {
    Object.assign(auth, { isAuthenticated: false, isLoggingOut: false });
    gate();
    expect(screen.getByText('Sign In Required')).toBeInTheDocument();
    expect(screen.queryByText('private orders')).not.toBeInTheDocument();
  });
});
