/* eslint-disable react-refresh/only-export-components */
import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react';
import { createPortal } from 'react-dom';
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { Link, useLocation, useMatch } from 'react-router-dom';
import { useAuth } from '@/features/auth/context/AuthContext';
import { ApiError, apiClient } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import { Toast, ToastProvider, ToastViewport, ToastTitle, ToastDescription, ToastClose } from '@/components/ui/Toast';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { ProductImage } from '@/components/ui/ProductImage';
import { CheckCircle2, Clock3, XCircle } from 'lucide-react';
import { DismissFailedPurchase } from './DismissFailedPurchase';
import { PAYMENTS_UNAVAILABLE_MESSAGE, isPaymentsDisabledError, usePaymentCapability } from './paymentCapability';
import { Dialog, DialogContent, DialogDescription, DialogTitle, DialogTrigger } from '@/components/ui/Dialog';
import { Alert } from '@/components/ui/Alert';
import { forgetPresentedSubmittedPurchase, readSubmittedPurchase } from './state';
import { hasVerifiedPayment, isResolvedPayment } from './paymentPresentation';
import type { PaymentOutcome } from './types';
import { endPaymentObservation, isPreviousPaymentResult, observedPaymentIds, observePaymentSnapshot, usePaymentObservations } from './paymentObservation';
import styles from './Checkout.module.scss';
export interface SavedPurchase { attemptId: string; scope: string; state: string; classification?: string; total: string; currency: string;
  pending: boolean; unread: boolean; orderReference: string | null; submittedAt?: string | null; updatedAt?: string | null; retryAllowed?: boolean; confirmationStarted?: boolean; cancelable?: boolean; items: { name: string; quantity: number; imageUrl?: string | null }[] }
/** Reject older backend versions; verified capture also survives delayed pre-capture reads. Refunds remain observable. */
export function retainPaidPurchases(previous: SavedPurchase[], incoming: SavedPurchase[]) {
  const existing = new Map(previous.map(item => [item.attemptId, item]));
  const captured = new Map(previous.filter(item => item.state === 'PAID' && item.classification !== 'UNKNOWN').map(item => [item.attemptId, item]));
  return incoming.map(item => {
    const old = existing.get(item.attemptId);
    // A retry may legitimately change the same attempt; compare backend versions,
    // rather than pinning a decline forever or accepting a delayed earlier read.
    if (old && Date.parse(old.updatedAt ?? '') > Date.parse(item.updatedAt ?? '')) return old;
    const paid = captured.get(item.attemptId);
    return paid && !['PAID', 'REFUND_PENDING', 'REFUNDED', 'COMPENSATION_PENDING', 'COMPENSATED'].includes(item.state) ? paid : item;
  });
}
/** Publish backend-verified outcomes across routes without changing Cart B, drafts or notification ownership. */
export function synchronizePaymentOutcome(owner: string, outcome: PaymentOutcome, client: QueryClient) {
  const key = ['payment-purchases', owner];
  if (isResolvedPayment(outcome) && !outcome.recoveryActive &&
    ['DECLINED', 'CANCELED', 'COMPENSATED', 'REFUNDED'].includes(outcome.state)) {
    client.setQueryData<{ data: SavedPurchase[] }>(key, previous => {
      if (!previous) return previous;
      return { ...previous, data: previous.data.map(old => {
        if (old.attemptId !== outcome.attemptId || old.state === 'PAID' ||
          Date.parse(old.updatedAt ?? '') > Date.parse(outcome.updatedAt ?? '')) return old;
        return { ...old, state: outcome.state, classification: outcome.state === 'DECLINED' ? 'DECLINED' : 'FAILED',
          updatedAt: outcome.updatedAt, pending: false, retryAllowed: outcome.retryAllowed === true,
          // Notification freshness/acknowledgment belongs to the purchases endpoint.
          unread: old.state === outcome.state ? old.unread : false };
      }) };
    });
  }
  if (hasVerifiedPayment(outcome) && outcome.confirmation) {
    const confirmation = outcome.confirmation;
    client.setQueryData<{ data: SavedPurchase[] }>(key, previous => {
      const old = previous?.data.find(item => item.attemptId === outcome.attemptId);
      const settled: SavedPurchase = { ...old, attemptId: outcome.attemptId, scope: outcome.scope ?? old?.scope ?? 'CART_CHECKOUT',
        state: 'PAID', classification: 'SUCCEEDED', total: outcome.total, currency: outcome.currency,
        // Capture proof establishes status, not whether another browser already read its notification.
        // Only the purchases endpoint may introduce a new unread outcome.
        pending: false, unread: old?.state === 'PAID' ? old.unread : false, retryAllowed: false,
        orderReference: confirmation.orderReference, submittedAt: outcome.submittedAt, updatedAt: outcome.updatedAt ?? old?.updatedAt,
        items: old?.items ?? confirmation.items.map(item => ({ name: item.productName, quantity: item.quantity, imageUrl: item.imageUrl })) };
      return { data: [...(previous?.data.filter(item => item.attemptId !== outcome.attemptId) ?? []), settled] };
    });
    client.setQueryData(queryKeys.orders.confirmation(owner, confirmation.orderReference), { data: confirmation });
    endPaymentObservation(owner, outcome.attemptId);
    void client.invalidateQueries({ queryKey: ['orders'] });
  }
  void client.invalidateQueries({ queryKey: key });
}
export function usePaymentPurchases(observe = false) {
  const { user, isSessionVerified } = useAuth();
  const client = useQueryClient();
  usePaymentObservations();
  const query = useQuery({ queryKey: ['payment-purchases', user?.id ?? ''],
    queryFn: async ({ signal }) => {
      // Bound each read, not the lifetime of a durable unresolved purchase.
      // A deadline preserves the last known state and never declares financial failure.
      const result = await apiClient<{ data: SavedPurchase[] }>('/api/checkout/payment-attempts', {
        signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]),
      });
      if (!Array.isArray(result.data)) throw new Error('Saved purchases are unavailable.');
      if (result.data.some(unresolved)) requestOverdueRecovery(user?.id ?? '');
      const previous = client.getQueryData<{ data: SavedPurchase[] }>(['payment-purchases', user?.id ?? '']);
      return { ...result, data: retainPaidPurchases(previous?.data ?? [], result.data) };
    },
    // A read is idempotent: retry only a transport failure, timeout or 5xx twice (e.g. a dev server restarting). A 4xx decision or a
    // malformed contract is not retried.
    enabled: Boolean(user && isSessionVerified), retry: (count, error) => count < 2 && (error instanceof ApiError
      ? error.status === 0 || error.status >= 500 : error instanceof TypeError || error instanceof DOMException),
    retryDelay: count => Math.min(4_000, 1_000 * 2 ** count), staleTime: 10_000, refetchOnMount: 'always', refetchOnWindowFocus: 'always', refetchOnReconnect: 'always',
    refetchInterval: query => observe && document.visibilityState === 'visible'
      ? pendingPollInterval(query.state.data?.data ?? [], Date.now(), firstObserved, followingPurchases(user?.id ?? '', query.state.data?.data ?? [])) ||
        (query.state.status === 'error' ? 15_000 : false) : false });
  useEffect(() => { query.data?.data.forEach(item => observePaymentSnapshot(user?.id ?? '', item)); }, [query.data, user?.id]);
  return query;
}
const unresolved = (item: SavedPurchase) => item.pending && !['DECLINED', 'FAILED'].includes(item.classification ?? item.state);
/**
 * The purchases list GET is read-only (Task 03.8). While unresolved purchases are visible, ask the backend (an explicit, owner-scoped POST)
 * to reconcile any that the durable runner left overdue. At most once per 30 s per account; the backend only claims due work under its lease.
 */
const lastRecoveryRequest = new Map<string, number>();
export function requestOverdueRecovery(userId: string, now = Date.now()) {
  const last = lastRecoveryRequest.get(userId);
  if (!userId || (last !== undefined && now - last < 30_000)) return;
  lastRecoveryRequest.set(userId, now);
  void apiClient('/api/checkout/payment-attempts/recover-overdue', { method: 'POST', data: {} }).catch(() => undefined);
}
const firstObserved = new Map<string, number>();
// A late/empty list must not stop discovery of a confirmed submission. Once a
// row exists, its backend outcome supersedes this discovery-only pointer.
function followingPurchases(owner: string, rows: SavedPurchase[]) {
  const following = observedPaymentIds(owner);
  for (const scope of ['CART_CHECKOUT', 'BUY_NOW'] as const) {
    const id = readSubmittedPurchase(owner, scope);
    if (id && !rows.some(item => item.attemptId === id)) following.add(id);
  }
  return following;
}
/**
 * Late results stay discoverable with no time cap: one bounded read at a time, backing off by how long this tab
 * has been watching the newest unresolved purchase (15 s → 60 s → 120 s). Client-observed time avoids server/client
 * clock skew. Focus, visibility, reconnect and navigation also re-read. A hidden or suspended tab is not polled;
 * it re-reads when it becomes active again.
 */
export function pendingPollInterval(rows: SavedPurchase[], now = Date.now(), observed = firstObserved, following = new Set<string>()): number | false {
  const pending = new Set([...rows.filter(unresolved).map(item => item.attemptId), ...following]);
  if (!pending.size) return false;
  for (const id of pending) if (!observed.has(id)) observed.set(id, now);
  const age = now - Math.max(...[...pending].map(id => observed.get(id) ?? now));
  return age < 5 * 60_000 ? 15_000 : age < 30 * 60_000 ? 60_000 : 120_000;
}
const resultKind = (item: SavedPurchase) => item.classification === 'UNKNOWN' ? null :
  item.classification === 'SUCCEEDED' || !item.classification && item.state === 'PAID' ? 'success' :
    ['DECLINED', 'FAILED'].includes(item.classification ?? item.state) || !item.classification && ['CANCELED', 'COMPENSATED', 'REFUNDED'].includes(item.state) ? 'failure' : null;
type NoticeIdentity = Pick<SavedPurchase, 'attemptId' | 'state'>;
const noticeKey = (owner: string, item: NoticeIdentity) => `electrohub.payment-notice.${owner}.${item.attemptId}.${item.state}`;
function markPresented(owner: string, item: NoticeIdentity, client: ReturnType<typeof useQueryClient>) {
  const key = noticeKey(owner, item);
  forgetPresentedSubmittedPurchase(owner, item.attemptId, item.state);
  client.setQueryData<string[]>(['payment-notice-presented', owner], previous => [...new Set([...(previous ?? []), key])].slice(-100));
  try { localStorage.setItem(key, 'shown'); } catch { /* Query cache deduplicates this tab; durable destinations remain available. */ }
}
// Presence belongs to an exact route entry and attempt. A previous checkout's
// registration cannot suppress its outcome while a different checkout is open.
const onScreen = new Map<string, number>(); const presenceListeners = new Set<() => void>(); let presenceVersion = 0;
const paymentRouteKey = (location: { key: string; pathname: string; search: string }) => JSON.stringify([location.key, location.pathname, location.search]);
const paymentScreenKey = (route: string, attemptId: string) => JSON.stringify([route, attemptId]);
const isPresentedPayment = (route: string, item: Pick<SavedPurchase, 'attemptId' | 'orderReference'>, confirmationReference?: string) =>
  onScreen.has(paymentScreenKey(route, item.attemptId)) || Boolean(item.orderReference && item.orderReference === confirmationReference);
const presenceChanged = () => { presenceVersion++; for (const listener of presenceListeners) listener(); };
const subscribePresence = (listener: () => void) => { presenceListeners.add(listener); return () => { presenceListeners.delete(listener); }; };
const subscribeVisibility = (listener: () => void) => { document.addEventListener('visibilitychange', listener); return () => document.removeEventListener('visibilitychange', listener); };
export function usePresentedPaymentAttempt(attemptId: string | null | undefined) {
  const route = paymentRouteKey(useLocation());
  useLayoutEffect(() => {
    if (!attemptId) return;
    const key = paymentScreenKey(route, attemptId);
    onScreen.set(key, (onScreen.get(key) ?? 0) + 1); presenceChanged();
    return () => { const count = (onScreen.get(key) ?? 1) - 1; if (count) onScreen.set(key, count); else onScreen.delete(key); presenceChanged(); };
  }, [attemptId, route]);
}
/** Only these authoritative outcomes are ever notified; anything else (pending, UNKNOWN, entry states) never is. */
export const isNotifiableOutcome = (item: Pick<SavedPurchase, 'state' | 'classification'>) =>
  item.classification === 'SUCCEEDED' || item.classification === 'DECLINED' || item.classification === 'FAILED' || !item.classification && ['PAID', 'DECLINED', 'CANCELED'].includes(item.state);
/**
 * Checkout's verified-paid handoff. The global PaymentNotifications toast is the single owner of the "Order confirmed" notification:
 * Checkout only announces the authoritative PAID result once (owner + attempt), and also acknowledges it so the background
 * observation path can never show it a second time. Refresh, polling, remounts and route changes never re-announce.
 */
const ORDER_CONFIRMED_EVENT = 'electrohub:order-confirmed';
const announcedOrders = new Set<string>();
export interface OrderConfirmedAnnouncement { owner: string; attemptId: string; orderReference: string }
export function announceOrderConfirmed(detail: OrderConfirmedAnnouncement) {
  const key = `${detail.owner}:${detail.attemptId}`;
  if (!detail.owner || !detail.orderReference || announcedOrders.has(key)) return;
  announcedOrders.add(key);
  window.dispatchEvent(new CustomEvent<OrderConfirmedAnnouncement>(ORDER_CONFIRMED_EVENT, { detail }));
}
export const ORDER_CONFIRMED_TITLE = 'Order confirmed! 🎉';
export const ORDER_CONFIRMED_TEXT = 'Your payment was successful. Your order is ready to view.';

/** The customer saw this authoritative outcome in Checkout: never toast it later, here or in another browser. Once per tab (query client). */
export function acknowledgePaymentOutcome(owner: string, outcome: NoticeIdentity, client: ReturnType<typeof useQueryClient>) {
  if (document.visibilityState === 'hidden') return;
  const key = noticeKey(owner, outcome);
  const acknowledged = client.getQueryData<string[]>(['payment-notice-acknowledged', owner]) ?? [];
  markPresented(owner, outcome, client);
  if (acknowledged.includes(key)) return;
  client.setQueryData<string[]>(['payment-notice-acknowledged', owner], [...acknowledged, key].slice(-100));
  void apiClient(`/api/checkout/payment-attempts/${outcome.attemptId}/read`, { method: 'POST', data: { state: outcome.state } })
    .then(() => client.invalidateQueries({ queryKey: ['payment-purchases', owner] }))
    .catch(() => { /* Local acknowledgement already prevents a duplicate here; the outcome stays in Cart/Orders. */ });
}
export function PendingPurchases() {
  const query = usePaymentPurchases(); const { user } = useAuth();
  const actionable = Boolean(query.data?.data.some(item => resultKind(item) === 'failure'));
  // Only asked when a payment action (Remove, Try Again) could be offered.
  const paymentsDisabled = usePaymentCapability(actionable) === false;
  const previous = useRef<{ owner?: string; items: SavedPurchase[] }>({ items: [] });
  // Terminal outcomes are monotonic for this view: a late or stale read can never return a settled attempt to Pending.
  const settled = useRef(new Set<string>());
  const [exiting, setExiting] = useState<SavedPurchase[]>([]);
  const client = useQueryClient();
  // Called only after the server confirmed the dismissal. Removes just that card from the verified list, then re-reads it.
  const dismissFailed = (attemptId: string) => {
    const key = ['payment-purchases', user?.id ?? ''];
    client.setQueryData<{ data: SavedPurchase[] }>(key, old => old ? { ...old, data: old.data.filter(item => item.attemptId !== attemptId) } : old);
    void client.invalidateQueries({ queryKey: key });
    // The card that had focus is gone; move focus to the section it belonged to.
    window.setTimeout(() => document.getElementById('saved-purchases-heading')?.focus(), 0);
  };
  useLayoutEffect(() => {
    if (previous.current.owner !== user?.id) { previous.current = { owner: user?.id, items: [] }; settled.current.clear(); setExiting([]); }
    if (!query.data) return;
    const outcomes = query.data.data.filter(item => resultKind(item) && !settled.current.has(item.attemptId) && previous.current.items.some(old => old.attemptId === item.attemptId && !resultKind(old)));
    if (outcomes.length) {
      setExiting(current => [...current, ...outcomes.filter(item => !current.some(old => old.attemptId === item.attemptId))]);
      if (outcomes.some(item => resultKind(item) === 'success')) void client.invalidateQueries({ queryKey: ['orders'] });
    }
    // A decline can be retried using the SAME attempt. Only capture is monotonic here.
    for (const item of query.data.data) if (resultKind(item) === 'success') settled.current.add(item.attemptId);
    previous.current.items = query.data.data;
  }, [query.data, user?.id, client]);
  useEffect(() => {
    if (!exiting.length) return;
    // The card exit only animates; the global toast owns presentation and acknowledgement.
    const timer = window.setTimeout(() => setExiting([]), 450);
    return () => window.clearTimeout(timer);
  }, [exiting]);
  // Most customers have no saved purchases: announce the read without flashing a placeholder above the Cart.
  if (query.isLoading) return <p className={styles.visuallyHidden} role="status">Loading saved purchases…</p>;
  if (query.isError && !query.data) return <div className={styles.inlineNotice} role="status"><p>Saved purchases could not be loaded. Your Cart is unaffected.</p>
    <Button size="small" variant="outline" onClick={() => void query.refetch()} isLoading={query.isFetching} disabled={query.isFetching}>Retry</Button></div>;
  const checking = (item: SavedPurchase) => isPreviousPaymentResult(user?.id ?? '', item);
  const pending = query.data?.data.filter(item => (item.pending && !resultKind(item) || checking(item)) && !settled.current.has(item.attemptId)) ?? [];
  const failed = query.data?.data.filter(item => resultKind(item) === 'failure' && !checking(item) && !settled.current.has(item.attemptId) && !exiting.some(old => old.attemptId === item.attemptId)) ?? [];
  return <>
    {query.isError && <div className={styles.inlineNotice} role="status"><p>Saved purchases could not be updated. The last verified status is shown; we’ll check again automatically.</p></div>}
    {(pending.length > 0 || exiting.length > 0) && <section className={styles.pendingPurchases} aria-labelledby="pending-purchases-heading"><h2 id="pending-purchases-heading">Pending purchases</h2>
      <p className={styles.purchaseSectionNote}>These payments are being confirmed. They aren’t part of your Cart total.</p>
      <ul className={styles.purchaseList}>
        {pending.map(item => <li key={item.attemptId}><PurchaseCard item={item} checking={checking(item)} /></li>)}
        {exiting.map(item => <li className={styles.purchaseExit} key={item.attemptId}><div><PurchaseCard item={item} exit /></div></li>)}
      </ul>
    </section>}
    {failed.length > 0 && <section className={styles.savedPurchaseHistory} aria-labelledby="saved-purchases-heading"><h2 id="saved-purchases-heading" tabIndex={-1}>Failed payments</h2>
      <p className={styles.purchaseSectionNote}>These purchases didn’t complete. They’re kept separate from your Cart.</p>
      <ul className={styles.purchaseList}>{failed.map(item => <li key={item.attemptId}><PurchaseCard item={item} onDismissed={dismissFailed} actionsDisabled={paymentsDisabled} /></li>)}</ul></section>}
  </>;
}
const money = (value: string, currency: string) => new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(Number(value));
/** An unresolved purchase this old is no longer an ordinary wait: say so plainly and give a reference for support. */
export const STALE_PENDING_PURCHASE_MS = 45 * 60_000;
/** One Cart-style card per purchase identity; every line of a multi-item purchase stays grouped under it. */
function PurchaseCard({ item, exit = false, checking = false, onDismissed, actionsDisabled = false }: { item: SavedPurchase; exit?: boolean; checking?: boolean; onDismissed?: (attemptId: string) => void; actionsDisabled?: boolean }) {
  const kind = checking ? null : resultKind(item); const names = item.items.map(line => line.name).join(', ');
  const tone = kind === 'success' ? 'success' : kind === 'failure' ? 'failure' : 'pending';
  // Unresolved is never terminal and never an invitation to pay again: the backend alone resolves it, so these cards only observe.
  const stale = !kind && Boolean(item.submittedAt) && Date.now() - Date.parse(item.submittedAt ?? '') > STALE_PENDING_PURCHASE_MS;
  // A submitted purchase is never a saved card entry: every unresolved card is Processing and only offers a status check.
  const verification = item.state === 'ACTION_REQUIRED' && item.classification === 'AWAITING_CUSTOMER_ACTION';
  const status = kind === 'success' ? 'Payment confirmed' : kind === 'failure' ? 'Payment failed'
    : item.classification === 'UNKNOWN' ? 'Awaiting confirmation' : 'Processing';
  const note = kind === 'success' ? 'Your order is confirmed and available in Orders.'
    : kind === 'failure' ? item.state === 'REFUNDED' ? 'This payment was refunded. Its purchase details are saved separately from your Cart.'
      : item.state === 'DECLINED' ? item.retryAllowed ? 'Nothing was charged. Your items and delivery details are saved for this purchase.' : 'Nothing was charged. This purchase can’t be paid again.'
        : 'This purchase did not complete. Its details are saved separately from your Cart.'
      : checking ? 'We’re checking the payment you just submitted. Please don’t pay again.'
        : stale ? `Payment confirmation needs attention. Check payment status for the latest result. Please don’t pay again. Support reference: ${item.attemptId.slice(0, 8).toUpperCase()}.`
        : item.classification === 'UNKNOWN' ? 'We’re still confirming this payment. Please don’t pay again.'
          : verification ? 'Your bank asked for an extra verification step. Check payment status to continue. Please don’t pay again.'
            // Submitted, but no card confirmation is known to have started: never claim a charge is being processed.
            : item.cancelable ? 'Card payment didn’t start for this purchase, and nothing was charged. You can cancel it and check out again.'
            : item.state === 'AWAITING_INPUT' && !item.confirmationStarted ? 'Checking the status of this purchase. Please don’t pay again.'
            : 'We’re confirming this payment with our payment provider.';
  // Every failed-payment card carries the trash icon (Task 03.6 acceptance); eligibility is enforced again by the server on Remove.
  const dismissible = Boolean(onDismissed) && !exit && tone === 'failure';
  return <article className={styles.purchaseCard} data-tone={tone} data-purchase={item.attemptId} data-outcome={exit ? kind ?? undefined : undefined}
    data-dismissible={dismissible ? 'true' : undefined}
    aria-label={`${tone === 'failure' ? 'Failed payment' : tone === 'success' ? 'Confirmed payment' : 'Pending payment'} for ${names}`}>
    <div className={styles.purchaseCardItems}>{item.items.map((line, index) => <div className={styles.purchaseCardItem} key={index}>
      <ProductImage src={line.imageUrl ?? undefined} alt="" containerClassName={styles.purchaseCardImage} />
      <div className={styles.purchaseCardCopy}><strong>{line.name}</strong><span>Qty: {line.quantity}</span></div>
    </div>)}</div>
    <div className={styles.purchaseCardMeta}>
      {dismissible && onDismissed && <DismissFailedPurchase attemptId={item.attemptId} label={names} onDismissed={onDismissed} unavailableReason={actionsDisabled ? PAYMENTS_UNAVAILABLE_MESSAGE : undefined} />}
      <Badge variant={tone === 'failure' ? 'error' : tone === 'success' ? 'success' : item.classification === 'UNKNOWN' ? 'warning' : 'info'} size="sm" role={exit ? 'status' : undefined}
        icon={tone === 'failure' ? <XCircle size={14} aria-hidden="true" /> : tone === 'success' ? <CheckCircle2 size={14} aria-hidden="true" /> : <Clock3 size={14} aria-hidden="true" />}>{status}</Badge>
      <strong className={styles.purchaseCardTotal}>{money(item.total, item.currency)}</strong>
      {tone === 'pending' && !exit && <span className={styles.purchaseProgress} aria-hidden="true"><span /></span>}
      <p>{note}</p>
      {tone === 'pending' && !exit && <Link className={styles.secondaryLink} to={`/checkout?purchase=${encodeURIComponent(item.attemptId)}`}>Check payment status</Link>}
      {tone === 'pending' && !exit && item.cancelable && !actionsDisabled && <CancelPurchase item={item} label={names} />}
      {tone === 'failure' && !exit && item.retryAllowed && !actionsDisabled && <Link className={styles.primaryLink} to="/checkout?step=payment" state={{ retryPurchase: item.attemptId }}
        aria-label={`Try Again: pay for ${names} again`}>Try Again</Link>}
    </div>
  </article>;
}
/**
 * Cancel purchase: a rare, server-verified exception (cancelable comes only from the backend). The server re-verifies against Stripe and under
 * row locks; it never cancels a payment that may be in progress or paid. Returning items to the Cart is an explicit customer choice.
 */
/**
 * The cancel endpoint often answers CANCEL_PENDING: the provider cancellation completes moments later (same request's follow-up
 * processing or the durable worker). Wait for the server's own terminal answer (bounded) before restoring or refreshing anything.
 */
export const CANCEL_CONFIRM_POLL_MS = 1_500;
export const CANCEL_CONFIRM_TIMEOUT_MS = 45_000;
export async function awaitCancellation(attemptId: string, initialState: string, now = () => Date.now(),
  sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms))): Promise<string> {
  let state = initialState;
  const deadline = now() + CANCEL_CONFIRM_TIMEOUT_MS;
  while (state === 'CANCEL_PENDING' && now() < deadline) {
    await sleep(CANCEL_CONFIRM_POLL_MS);
    try { state = (await apiClient<{ data: { state: string } }>(`/api/checkout/payment-attempts/${attemptId}`, { signal: AbortSignal.timeout(15_000) })).data.state; }
    catch { /* A failed status read is not a result; keep waiting within the deadline. */ }
  }
  return state;
}

function CancelPurchase({ item, label }: { item: SavedPurchase; label: string }) {
  const { user } = useAuth(); const client = useQueryClient();
  const [open, setOpen] = useState(false); const [busy, setBusy] = useState(false); const [error, setError] = useState('');
  const [returnItems, setReturnItems] = useState(item.scope !== 'BUY_NOW');
  const refreshOnClose = useRef(false);
  const cancel = async () => {
    if (busy || !user) return;
    setBusy(true); setError('');
    try {
      const result = await apiClient<{ data: { state: string } }>(`/api/checkout/payment-attempts/${item.attemptId}/cancel`, { method: 'POST', data: {},
        signal: AbortSignal.timeout(45_000) });
      const state = await awaitCancellation(item.attemptId, result.data.state);
      let restoreFailed = false;
      // Items return to the Cart only once the provider cancellation is confirmed (restore() re-verifies it and is idempotent).
      if (returnItems && item.scope !== 'BUY_NOW' && state === 'CANCELED') {
        await apiClient(`/api/checkout/payment-attempts/${item.attemptId}/restore`, { method: 'POST', data: {}, signal: AbortSignal.timeout(45_000) })
          .catch(() => { restoreFailed = true; });
      }
      await client.invalidateQueries({ queryKey: queryKeys.cart.current(user.id) });
      if (state === 'CANCEL_PENDING') { setError('Cancellation was requested and is still being confirmed with our payment provider. Nothing was charged. This purchase will update shortly.'); return; }
      // The dialog lives inside this card: keep the card (and the truthful message) until the customer closes it.
      if (restoreFailed) { refreshOnClose.current = true; setError('The purchase was cancelled, but its items could not be returned to your Cart. Add them again from the store.'); return; }
      // Fresh server truth; invalidation cancels any older in-flight read so a stale "Processing" cannot come back.
      await client.invalidateQueries({ queryKey: ['payment-purchases', user.id] });
      setOpen(false);
    } catch (failure) {
      setError(isPaymentsDisabledError(failure) ? PAYMENTS_UNAVAILABLE_MESSAGE
        : failure instanceof ApiError && failure.code === 'PAYMENT_CANCEL_NOT_ALLOWED' ? 'This purchase can’t be cancelled now. Its payment may be in progress; check its payment status.'
          : 'The purchase could not be cancelled right now. Nothing was changed. Please try again.');
    } finally { setBusy(false); }
  };
  const changeOpen = (next: boolean) => {
    if (busy) return;
    setOpen(next);
    if (!next && (refreshOnClose.current || error) && user) { refreshOnClose.current = false; void client.invalidateQueries({ queryKey: ['payment-purchases', user.id] }); }
  };
  return <Dialog open={open} onOpenChange={changeOpen}>
    <DialogTrigger asChild><Button size="small" variant="outline" aria-label={`Cancel purchase: ${label}`} onClick={() => setError('')}>Cancel purchase</Button></DialogTrigger>
    <DialogContent hideCloseButton onInteractOutside={event => { if (busy) event.preventDefault(); }} onEscapeKeyDown={event => { if (busy) event.preventDefault(); }}>
      <DialogTitle>Cancel this purchase?</DialogTitle>
      <DialogDescription>Card payment didn’t start for this purchase and nothing was charged. Cancelling it lets you check out again. Your purchase history is kept.</DialogDescription>
      {item.scope !== 'BUY_NOW' && <label><input type="checkbox" checked={returnItems} onChange={event => setReturnItems(event.target.checked)} disabled={busy} /> Return its items to my Cart</label>}
      {error && <Alert variant="error">{error}</Alert>}
      <div className={styles.inlineActions}>
        <Button variant="outline" onClick={() => changeOpen(false)} disabled={busy}>Keep purchase</Button>
        <Button variant="destructive" onClick={() => void cancel()} isLoading={busy} disabled={busy}>Cancel purchase</Button>
      </div>
    </DialogContent>
  </Dialog>;
}
/** Server acknowledgement persists across browsers. Updates never navigate or install checkout state. */
export function PaymentNotifications() {
  const { user } = useAuth(); const client = useQueryClient(); const query = usePaymentPurchases(true);
  const location = useLocation(); const { pathname } = location; const route = paymentRouteKey(location);
  const confirmationReference = useMatch('/checkout/confirmation/:orderReference')?.params.orderReference;
  const delivered = useRef(new Set<string>());
  const presentations = useRef(new Map<string, () => void>());
  const [updates, setUpdates] = useState<SavedPurchase[]>([]);
  const [error, setError] = useState('');
  const paidSeen = useRef(new Set<string>());
  const observation = usePaymentObservations();
  const presence = useSyncExternalStore(subscribePresence, () => presenceVersion);
  // A hidden tab never presents or records a notice: nobody can see it, and its local key would silence the visible tab.
  const tabVisible = useSyncExternalStore(subscribeVisibility, () => document.visibilityState !== 'hidden');
  // Navigation is a natural moment to learn a late result: re-read when something is still pending and the last read is not fresh.
  useEffect(() => {
    if (!query.data?.data.length || query.isFetching || Date.now() - query.dataUpdatedAt < 10_000) return;
    void query.refetch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);
  const [confirmed, setConfirmed] = useState<OrderConfirmedAnnouncement | null>(null);
  useEffect(() => { setUpdates([]); setError(''); setConfirmed(null); delivered.current.clear(); paidSeen.current.clear(); }, [user?.id]);
  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent<OrderConfirmedAnnouncement>).detail;
      if (detail && user?.id && detail.owner === user.id) setConfirmed(detail);
    };
    window.addEventListener(ORDER_CONFIRMED_EVENT, listener);
    return () => window.removeEventListener(ORDER_CONFIRMED_EVENT, listener);
  }, [user?.id]);
  useEffect(() => {
    const succeeded = query.data?.data.filter(item => item.state === 'PAID' && resultKind(item) === 'success' && !paidSeen.current.has(item.attemptId)) ?? [];
    if (!succeeded.length) return;
    succeeded.forEach(item => paidSeen.current.add(item.attemptId));
    // Orders must refresh even if this result was already read, hidden, or shown inside Checkout.
    void client.invalidateQueries({ queryKey: ['orders'] });
  }, [query.data, client]);
  useEffect(() => {
    setUpdates(previous => previous.filter(item => !isPresentedPayment(route, item, confirmationReference) && !isPreviousPaymentResult(user?.id ?? '', item) &&
      !(item.state !== 'PAID' && query.data?.data.some(latest => latest.attemptId === item.attemptId && resultKind(latest) === 'success'))));
  }, [query.data, user?.id, observation, route, confirmationReference, presence]);
  // Record presentation after React commits the toast. This also deduplicates
  // remounts in this tab when localStorage is unavailable. Server acknowledgement
  // remains explicit on dismissal; Orders/Saved purchases retain the outcome.
  useEffect(() => {
    if (!user) return;
    for (const item of updates) {
      if (isPresentedPayment(route, item, confirmationReference)) continue;
      markPresented(user.id, item, client);
      const key = noticeKey(user.id, item);
      presentations.current.get(key)?.(); presentations.current.delete(key);
    }
  }, [updates, user, route, confirmationReference, presence, client]);
  useEffect(() => {
    if (!user || !tabVisible) return;
    let active = true;
    const claims = new Set<string>();
    const activePresentations = presentations.current;
    const deliveredKeys = delivered.current;
    for (const item of query.data?.data ?? []) {
      if (!item.unread || !isNotifiableOutcome(item) || isPresentedPayment(route, item, confirmationReference) || isPreviousPaymentResult(user.id, item)) continue;
      const key = `electrohub.payment-notice.${user.id}.${item.attemptId}.${item.state}`;
      const show = () => {
        if (!active || isPresentedPayment(route, item, confirmationReference)) return false;
        if (delivered.current.has(key) || client.getQueryData<string[]>(['payment-notice-presented', user.id])?.includes(key)) return false;
        try { if (localStorage.getItem(key)) return false; } catch { /* In-memory deduplication is still available. */ }
        delivered.current.add(key);
        setUpdates(previous => previous.some(update => update.attemptId === item.attemptId && update.state === item.state) ? previous : [...previous, item]);
        // Payment outcomes never invalidate or overwrite Cart B or Checkout B.
        if (item.state === 'PAID') void client.invalidateQueries({ queryKey: ['orders'] });
        return true;
      };
      if (navigator.locks) void navigator.locks.request(key, async () => {
        if (!active) return;
        let release!: () => void;
        const committed = new Promise<void>(resolve => { release = resolve; });
        claims.add(key); activePresentations.set(key, release);
        if (show()) await committed;
        activePresentations.delete(key); claims.delete(key);
      }).catch(() => { if (active) show(); }); else show();
    }
    return () => {
      active = false;
      // A route/customer change can interrupt presentation. Release every owned
      // claim; do not acknowledge a toast that never reached its destination.
      const interrupted = [...claims];
      for (const key of interrupted) { activePresentations.get(key)?.(); activePresentations.delete(key); deliveredKeys.delete(key); }
      // A toast already committed and recorded as presented stays up; only one that never reached the screen is withdrawn.
      if (interrupted.length) setUpdates(previous => previous.filter(update => {
        const key = noticeKey(user.id, update);
        return !interrupted.includes(key) || client.getQueryData<string[]>(['payment-notice-presented', user.id])?.includes(key);
      }));
    };
  }, [query.data, user, client, route, confirmationReference, presence, tabVisible, observation]);
  const close = (item: SavedPurchase) => {
    if (user) markPresented(user.id, item, client);
    setUpdates(previous => previous.filter(update => update !== item));
    void apiClient(`/api/checkout/payment-attempts/${item.attemptId}/read`, { method: 'POST', data: { state: item.state } })
      .then(() => client.invalidateQueries({ queryKey: ['payment-purchases', user?.id ?? ''] }))
      .catch(() => setError('Payment update acknowledgement could not be saved. Your purchase remains available in Cart or Orders.'));
  };
  return createPortal(<ToastProvider duration={5000}>{error && <Toast open type="foreground" duration={5000} variant="error" onOpenChange={open => { if (!open) setError(''); }}>
    <ToastTitle>{error}</ToastTitle><ToastClose aria-label="Dismiss acknowledgement notice" /></Toast>}
    {confirmed && <Toast key={`confirmed:${confirmed.attemptId}`} open duration={5000} variant="success" onOpenChange={open => { if (!open) setConfirmed(null); }}>
      <ToastTitle>{ORDER_CONFIRMED_TITLE}</ToastTitle><ToastDescription>{ORDER_CONFIRMED_TEXT}</ToastDescription>
      <Link to={`/orders/${confirmed.orderReference}`}>View Order</Link>
      <ToastClose aria-label="Dismiss order confirmation" />
    </Toast>}
    {updates.filter(item => !isPresentedPayment(route, item, confirmationReference) && !(confirmed && item.attemptId === confirmed.attemptId)).map(item =>
    <Toast key={`${item.attemptId}:${item.state}`} open duration={5000} variant={item.state === 'PAID' ? 'success' : 'error'} onOpenChange={open => { if (!open) close(item); }}>
      <ToastTitle>{item.state === 'PAID' ? ORDER_CONFIRMED_TITLE : 'Payment was not completed. Your saved purchase details are kept in your Cart history.'}</ToastTitle>
      {item.state === 'PAID' && <ToastDescription>{ORDER_CONFIRMED_TEXT}</ToastDescription>}
      <Link to={item.orderReference ? `/orders/${item.orderReference}` : '/cart'}>{item.orderReference ? 'View Order' : 'View saved purchase'}</Link>
      <ToastClose aria-label="Dismiss payment notification" />
    </Toast>)}<ToastViewport className={styles.paymentToasts} /></ToastProvider>, document.body);
}
