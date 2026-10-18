import { useLayoutEffect, useState } from 'react';
import type { Meta, StoryObj } from '@storybook/react-vite';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { AuthProvider } from '@/features/auth/context/AuthContext';
import type { User } from '@/features/auth/types';
import { OrderStatus, type OrderStatusType } from '@/components/ui/OrderStatus';
import { PaymentStatus, type PaymentStatusType } from '@/components/ui/PaymentStatus';
import { OrdersPage } from '@/pages/customer/OrdersPage';
import { OrderDetailsPage } from './OrderDetailsPage';
import { manyItemsDetails, manyItemsSummary, orderDetails, orderSummary, ordersPage } from './fixtures';
import { readPage } from './presentation';
import type { OrderDetails, OrderSummary } from './types';

/*
 * Stories render the real providers and pages. The only substitution is the network boundary: a scoped
 * window.fetch stub (installed for the life of one story) answers the session and order endpoints that the
 * real AuthProvider and page queries call. Nothing else is mocked, and nothing reaches a real API.
 */

type Session = 'signed-in' | 'signed-out' | 'unavailable';
type Reply = { status: number; body?: unknown } | 'pending';
type Api = (url: URL) => Reply;
interface Scenario { session?: Session; api?: Api }

const storyUser: User = { id: 'story-customer', email: 'story.customer@example.test', firstName: 'Alex', lastName: 'Morgan', role: 'CUSTOMER' };
const ok = (body: unknown): Reply => ({ status: 200, body });
const fail = (status: number, message: string): Reply => ({ status, body: { error: { code: 'STORY_ERROR', message } } });
const listOf = (orders: OrderSummary[], total = orders.length): Api => url => ok(ordersPage(orders, readPage(url.searchParams.get('page')), total));
const detailOf = (details: OrderDetails): Api => () => ok({ data: details });
const pending: Api = () => 'pending';
const unavailable: Api = () => fail(503, 'Unavailable');

function respond({ session = 'signed-in', api }: Scenario, url: URL): Reply {
  if (url.pathname === '/api/auth/refresh') {
    if (session === 'signed-out') return fail(401, 'Unauthorized');
    if (session === 'unavailable') return fail(503, 'Unavailable');
    return ok({ accessToken: 'story-access-token' });
  }
  if (url.pathname === '/api/auth/me') return ok({ user: storyUser });
  if (url.pathname.startsWith('/api/orders')) return api ? api(url) : fail(404, 'Not found');
  return fail(404, 'Not found');
}

/** Installs the scoped network stub before the providers' effects run, and restores the original fetch on unmount. */
function StubNetwork({ scenario }: { scenario: Scenario }) {
  useLayoutEffect(() => {
    const original = window.fetch;
    window.fetch = (input: RequestInfo | URL) => {
      const url = new URL(input instanceof Request ? input.url : String(input), window.location.origin);
      const reply = respond(scenario, url);
      if (reply === 'pending') return new Promise<Response>(() => undefined);
      return Promise.resolve(new Response(reply.body === undefined ? null : JSON.stringify(reply.body),
        { status: reply.status, headers: { 'Content-Type': 'application/json' } }));
    };
    return () => { window.fetch = original; };
  }, [scenario]);
  return null;
}

const identityKeys = ['electrohub:cached-user', 'electrohub:header-identity'];
/** Clears remembered identity so each story starts from a known session state. */
function clearStoredIdentity() {
  for (const key of identityKeys) {
    try { sessionStorage.removeItem(key); localStorage.removeItem(key); } catch { /* Storage can be unavailable. */ }
  }
}
const createStoryClient = () => new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity }, mutations: { retry: false } } });
const noScenario: Scenario = {};

interface OrdersStageProps { path?: string; scenario?: Scenario }

/** Real AuthProvider and real OrdersPage / OrderDetailsPage behind the router, with the network stubbed per story. */
function OrdersStage({ path = '/orders', scenario = noScenario }: OrdersStageProps) {
  const [client] = useState(() => { clearStoredIdentity(); return createStoryClient(); });
  return <>
    <StubNetwork scenario={scenario} />
    <QueryClientProvider client={client}>
      <AuthProvider>
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route path="/orders" element={<OrdersPage />} />
            <Route path="/orders/:orderReference" element={<OrderDetailsPage />} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </QueryClientProvider>
  </>;
}

const meta = {
  title: 'Customer/Order Management',
  component: OrdersStage,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof OrdersStage>;

export default meta;
type Story = StoryObj<typeof meta>;

const listPath = '/orders';
const manyOrders = Array.from({ length: 10 }, (_, index) => orderSummary(index + 1));
const details = orderDetails();
const detailPath = `/orders/${encodeURIComponent(details.orderReference)}`;
const variant = (overrides: Partial<OrderDetails>) => orderDetails(overrides);

// History
export const Loading: Story = { args: { path: listPath, scenario: { api: pending } } };
export const Empty: Story = { args: { path: listPath, scenario: { api: listOf([]) } } };
export const OneOrder: Story = { args: { path: listPath, scenario: { api: listOf([orderSummary(1)]) } } };
export const ManyOrdersWithPagination: Story = { args: { path: listPath, scenario: { api: listOf(manyOrders, 25) } } };
export const LongReferenceAndPreviews: Story = { args: { path: listPath, scenario: { api: listOf([manyItemsSummary(1), manyItemsSummary(2)]) } } };
export const MixedStatuses: Story = {
  args: { path: listPath, scenario: { api: listOf([
    orderSummary(1, { status: 'AWAITING_CAPTURE', paymentState: 'PENDING' }),
    orderSummary(2, { status: 'CANCELLED', paymentState: 'REFUNDED' }),
    orderSummary(3, { status: 'CONFIRMED', paymentState: 'UNPROCESSED', card: null }),
    orderSummary(4, { status: 'DELIVERED', paymentState: 'PAID' }),
    orderSummary(5, { status: 'CANCELLED', paymentState: 'FAILED' }),
  ]) } },
};
export const LoadError: Story = { args: { path: listPath, scenario: { api: unavailable } } };
export const SignedOut: Story = { args: { path: listPath, scenario: { session: 'signed-out' } } };
/** Session verification exhausts its bounded retries (about 6 seconds) before this state appears. */
export const SessionUnavailable: Story = { args: { path: listPath, scenario: { session: 'unavailable' } } };

// Details
export const PaidConfirmed: Story = { args: { path: detailPath, scenario: { api: detailOf(details) } } };
export const Preparing: Story = { args: { path: detailPath, scenario: { api: detailOf(variant({ status: 'PREPARING' })) } } };
export const OutForDelivery: Story = { args: { path: detailPath, scenario: { api: detailOf(variant({ status: 'OUT_FOR_DELIVERY' })) } } };
export const Delivered: Story = { args: { path: detailPath, scenario: { api: detailOf(variant({ status: 'DELIVERED' })) } } };
/** Stored compensation outcome: fulfillment Cancelled, payment Failed (independent facts). */
export const CancelledPaymentFailed: Story = { args: { path: detailPath, scenario: { api: detailOf(variant({ status: 'CANCELLED', paymentState: 'FAILED', card: null, payment: { paidAt: null, refundedAt: null } })) } } };
export const CancelledRefunded: Story = { args: { path: detailPath, scenario: { api: detailOf(variant({ status: 'CANCELLED', paymentState: 'REFUNDED', payment: { paidAt: '2026-09-04T12:01:00.000Z', refundedAt: '2026-09-06T09:30:00.000Z' } })) } } };
export const AwaitingCapture: Story = { args: { path: detailPath, scenario: { api: detailOf(variant({ status: 'AWAITING_CAPTURE', paymentState: 'PENDING', card: null, payment: { paidAt: null, refundedAt: null } })) } } };
export const PaymentPending: Story = { args: { path: detailPath, scenario: { api: detailOf(variant({ paymentState: 'PENDING', payment: { paidAt: null, refundedAt: null } })) } } };
export const LegacyUnprocessed: Story = { args: { path: detailPath, scenario: { api: detailOf(variant({ paymentState: 'UNPROCESSED', card: null, payment: null })) } } };
export const ManyItemsLongAddress: Story = { args: { path: detailPath, scenario: { api: detailOf(manyItemsDetails()) } } };
export const PaidShipping: Story = { args: { path: detailPath, scenario: { api: detailOf(variant({ shippingCost: '9.99', total: '1109.98' })) } } };
export const MissingCardMetadata: Story = { args: { path: detailPath, scenario: { api: detailOf(variant({ card: null })) } } };
export const DetailsLoading: Story = { args: { path: detailPath, scenario: { api: pending } } };
export const NotFound: Story = { args: { path: detailPath, scenario: { api: () => fail(404, 'Order not found.') } } };
export const DetailsLoadError: Story = { args: { path: detailPath, scenario: { api: unavailable } } };

// Badges
const orderStatuses: OrderStatusType[] = ['confirmed', 'preparing', 'out_for_delivery', 'delivered', 'cancelled', 'awaiting_capture', 'unknown'];
const paymentStatuses: PaymentStatusType[] = ['pending', 'paid', 'failed', 'refunded', 'unprocessed', 'unknown'];

function BadgeGallery() {
  const sizes = ['medium', 'small'] as const;
  return <div style={{ display: 'grid', gap: '1.5rem', padding: '1.5rem' }}>
    {sizes.map(size => <section key={size} aria-label={`${size} badges`} style={{ display: 'grid', gap: '0.75rem' }}>
      <h2 style={{ fontSize: '1rem', margin: 0 }}>{size === 'medium' ? 'Medium' : 'Small'}</h2>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
        {orderStatuses.map(status => <OrderStatus key={`order-${status}`} status={status} size={size} />)}
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
        {paymentStatuses.map(status => <PaymentStatus key={`payment-${status}`} status={status} size={size} />)}
      </div>
    </section>)}
  </div>;
}

export const StatusBadges: Story = {
  parameters: { layout: 'padded' },
  render: () => <BadgeGallery />,
};
