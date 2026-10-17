import { useCallback, useEffect, useReducer, useRef, useState, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { announceConfirmation } from './confirmationSignal';
import { PAYMENTS_UNAVAILABLE_MESSAGE, isPaymentsDisabledError, usePaymentCapability } from './paymentCapability';
import { useAuth } from '@/features/auth/context/AuthContext';
import { useCart } from '@/features/cart/context';
import { ApiError, apiClient } from '@/lib/api';
import { catalogSignal, queryKeys, shouldRetry } from '@/lib/query';
import { Button } from '@/components/ui/Button';
import { ElectroHubLoader } from '@/components/ui/ElectroHubLoader/ElectroHubLoader';
import { allowedStep, clearDraft, draftWasSubmitted, forgetSubmittedPurchase, newDraft, readDraft, readSubmittedPurchase, readPurchaseEntry, rememberPurchaseEntries, rememberSubmittedPurchase, saveDraft, shippingErrors, withoutCardEntry } from './state';
import { clearBuyNow, readBuyNow } from './buyNow';
import type { CheckoutDraft, CheckoutQuote, CheckoutScope, CheckoutStep, PaymentOutcome, PaymentSetup, SubmissionAttempt } from './types';
import { CheckoutProcessing, CheckoutStepper, DeliveryStep, OrderSummary, PaymentSetupPending, PaymentStep, ReviewStep, ShippingStep } from './CheckoutComponents';
import { SavedPurchaseCheckout } from './SavedPurchaseCheckout';
import { acknowledgePaymentOutcome, isNotifiableOutcome, synchronizePaymentOutcome, usePresentedPaymentAttempt } from './PaymentPurchases';
import { StripePaymentSession, type PaymentEntryActions } from './StripePaymentSession';
import { prefetchStripe } from './stripeClient';
import { PaymentRecovery } from './PaymentRecovery';
import { RestoredPurchase } from './RestoredPurchase';
import { markPaymentTiming } from './paymentTiming';
import { CHECKOUT_RECOVERY_WINDOW_MS, hasVerifiedPayment, isResolvedPayment, matchesPaymentAttempt } from './paymentPresentation';
import { usePaymentLock } from './PaymentLockContext';
import styles from './Checkout.module.scss';
import type { CartData } from '@/features/cart/types';

const endpoint = '/api/checkout/payment-attempts';
const closed = (state: string) => ['DECLINED', 'AWAITING_INPUT', 'CANCELED', 'COMPENSATED', 'REFUNDED'].includes(state);
const waitingForEntry = (payment: PaymentOutcome) => payment.state === 'PREPARING' ||
  payment.recoveryActive && ['AWAITING_INPUT', 'ACTION_REQUIRED'].includes(payment.state);
class PaymentEntryValidationError extends Error {}
class StalePaymentAttemptResult extends Error {}
export function CheckoutPage({ scope = 'CART_CHECKOUT' }: { scope?: CheckoutScope } = {}) {
  const { user, isSessionVerified } = useAuth(); const location = useLocation(); const navigate = useNavigate();
  const entry = useRef<{ key: string; purchase: string | null }>({ key: '', purchase: null });
  const entryKey = `${user?.id ?? ''}:${scope}:${location.key}`;
  // Snapshot once on entry, not when the active submission writes its binding:
  // confirming Stripe Elements must remain mounted until the customer leaves.
  if (entry.current.key !== entryKey) entry.current = { key: entryKey, purchase: user ? readPurchaseEntry(user.id, scope, location.key) : null };
  const explicitPurchase = new URLSearchParams(location.search).get('purchase');
  const purchase = explicitPurchase ?? entry.current.purchase;
  useEffect(() => {
    if (isSessionVerified && user && !explicitPurchase && entry.current.purchase) {
      navigate({ pathname: location.pathname, search: `?purchase=${encodeURIComponent(entry.current.purchase)}` }, { replace: true });
    }
  }, [isSessionVerified, user, explicitPurchase, location.pathname, location.key, navigate]);
  if (purchase) {
    if (!isSessionVerified || !user) return <ElectroHubLoader page />;
    // Explicit purchase identity never initializes Checkout B or its card entry.
    const valid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(purchase);
    const unavailable = <div className={styles.page}><h1>We couldn’t find this saved purchase</h1><Link to="/cart">Return to Cart</Link></div>;
    return valid ? <RestoredPurchase key={`${user.id}:${purchase}`} attemptId={purchase} scope={scope} userId={user.id} fallback={unavailable} /> : unavailable;
  }
  // Try Again for a submitted failed purchase: its own saved snapshot, never the active Cart or this scope's draft.
  const retryPurchase = (location.state as { retryPurchase?: unknown } | null)?.retryPurchase;
  if (typeof retryPurchase === 'string' && retryPurchase) return <SavedPurchaseCheckout key={`${user?.id ?? 'guest'}:${retryPurchase}`} attemptId={retryPurchase} />;
  return <CheckoutSession key={`${user?.id ?? 'guest'}:${scope}`} scope={scope} />;
}

function CheckoutSession({ scope }: { scope: CheckoutScope }) {
  const { user, isSessionVerified } = useAuth(); const cart = useCart();
  const location = useLocation(); const historyEntries = useRef(new Set<string>());
  historyEntries.current.add(location.key);
  const navigate = useNavigate(); const client = useQueryClient(); const userId = user?.id ?? '';
  const { setPaymentState, isLocked } = usePaymentLock();
  const [params, setParams] = useSearchParams();
  const isBuyNow = scope === 'BUY_NOW';
  const buyNow = isBuyNow ? readBuyNow() : null;
  const latestBuyNow = useRef(buyNow); latestBuyNow.current = buyNow;
  const returnPath = isBuyNow ? '/checkout/buy-now' as const : '/checkout' as const;
  const [restored] = useState(() => {
    const saved = readDraft(userId, scope);
    // A submitted purchase is owned by its saved snapshot; this mount is a new purchase with a clean draft.
    if (saved.attempt?.submitted === true) return { draft: newDraft(), cardReentry: false };
    if (saved.attempt && (!isBuyNow && cart.data?.items.length && saved.attempt.request.expectedRevision !== cart.data.revision)) {
      return { draft: { ...saved, attempt: null, paymentComplete: false, reviewReached: false }, cardReentry: false };
    }
    // A reload loses the card entry and client secret; Review is not restorable, Payment is.
    // reviewReached survives the downgrade, so a remount of the same reload still explains why card entry is shown again.
    return { draft: withoutCardEntry(saved), cardReentry: saved.paymentComplete || saved.reviewReached === true };
  });
  const [cardReentry, setCardReentry] = useState(restored.cardReentry);
  const [draft, dispatchDraft] = useReducer((previous: CheckoutDraft, patch: Partial<CheckoutDraft>) => ({ ...previous, ...patch }), restored.draft);
  const draftRef = useRef(draft);
  const update = useCallback((patch: Partial<CheckoutDraft>) => {
    draftRef.current = { ...draftRef.current, ...patch };
    dispatchDraft(patch);
  }, []);
  const draftOwner = useRef(userId);
  const isMounted = useRef(true);
  const [pending, setPending] = useState(false); const [settingUp, setSettingUp] = useState(false); const [setupPending, setSetupPending] = useState(false);
  const [setupEpoch, setSetupEpoch] = useState(0);
  const [recoveryCheckStarted, setRecoveryCheckStarted] = useState(false);
  const [refreshingPrerequisites, setRefreshingPrerequisites] = useState(false);
  const [message, setMessage] = useState(''); const [setupError, setSetupError] = useState<string | null>(null); const [secret, setSecret] = useState<string | null>(null);
  // Environment restriction (payment isolation): known up front from the capability read, or learned from a 503 PAYMENT_MUTATIONS_DISABLED.
  const [paymentsRefused, setPaymentsRefused] = useState(false);
  const activeSecret = useRef<string | null>(secret);
  activeSecret.current = secret;
  const [outcome, setOutcome] = useState<PaymentOutcome | null>(null);
  const acknowledged = useRef('');
  const [setupBlocker, setSetupBlocker] = useState<{ id: string; key: string; generation: number; started: number } | null>(null);
  const resumedBlocker = useRef('');
  const latestCart = useRef(cart); latestCart.current = cart;
  const latestOutcome = useRef(outcome); latestOutcome.current = outcome;
  const retryBusy = useRef(false);
  const prerequisiteBusy = useRef(false);
  const recoveredPrerequisite = useRef('');
  const restoredPurchase = useRef<string | null>(null);
  const activeItems = cart.data?.items.length ?? 0;
  useEffect(() => { if (activeItems) restoredPurchase.current = null; }, [activeItems]);
  const entry = useRef<PaymentEntryActions>(null); const busy = useRef(false); const setupBusy = useRef(false);
  const identity = useRef(userId); identity.current = userId;
  const pollStarted = useRef(Date.now()); const setupPollStarted = useRef(0);
  const autoSetup = useRef(''); const handled = useRef(''); const initialRecovery = useRef(false);
  const setupGeneration = useRef(0);
  const entryRecoveryRequested = useRef(false);
  const entryRecoveryUsed = useRef(false);
  // True only after this mount itself submitted payment; a fresh mount never re-presents an old terminal outcome.
  const interactive = useRef(false);
  const step = allowedStep(params.get('step'), draft);
  // Asked only where checkout setup could start; a refusal learned from a 503 also counts.
  const paymentCapability = usePaymentCapability(['payment', 'review'].includes(step));
  const paymentsUnavailable = paymentCapability === false || paymentsRefused;
  const recoveryCartReady = interactive.current || isBuyNow || Boolean(cart.data && !cart.isLoading && !cart.isError && !cart.isMutating &&
    (!cart.data.items.length || cart.data.revision === draft.attempt?.request.expectedRevision));
  const recovering = recoveryCartReady && Boolean(draft.attempt?.status === 'unknown' || (draft.attempt?.status === 'pending' && !pending));
  useEffect(() => { if (step === 'payment') markPaymentTiming('payment-step-entered'); }, [step]);
  useEffect(() => { void prefetchStripe(); }, []);
  useEffect(() => {
    if (step === 'shipping') {
      interactive.current = false;
    }
  }, [step]);
  useEffect(() => {
    if (pending) {
      window.scrollTo({ top: 0, behavior: 'instant' });
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    }
  }, [pending]);
  useEffect(() => {
    if (recovering) {
      window.scrollTo({ top: 0, behavior: 'instant' });
      document.documentElement.scrollTop = 0;
      document.body.scrollTop = 0;
    }
  }, [recovering]);
  useEffect(() => {
    if (!pending && !recovering && isLocked) {
      setPaymentState('IDLE');
    }
  }, [pending, recovering, isLocked, setPaymentState]);
  const quote = useQuery({ queryKey: queryKeys.checkout.current(userId, isBuyNow ? `buy-now:${buyNow?.productId ?? ''}:${buyNow?.quantity ?? 0}` : cart.data?.revision ?? ''),
    queryFn: context => apiClient<{ data: CheckoutQuote }>(isBuyNow && buyNow
      ? `/api/checkout?scope=BUY_NOW&productId=${encodeURIComponent(buyNow.productId)}&quantity=${buyNow.quantity}` : '/api/checkout', { signal: catalogSignal(context) }),
    enabled: isSessionVerified && draftOwner.current === userId && !recovering && (isBuyNow ? Boolean(buyNow)
      : Boolean(cart.data?.items.length) && !cart.isMutating && !cart.mergeError), staleTime: 30_000, refetchOnMount: 'always' });
  const currentQuote = quote.data?.data;
  const quotePresent = Boolean(currentQuote);
  const viewCart = isBuyNow ? currentQuote?.summary : cart.data;
  const delivery = currentQuote?.deliveryMethods.find(method => method.id === draft.deliveryMethod);
  const request = { shipping: Object.fromEntries(Object.entries(draft.shipping).map(([key, value]) => [key, value.trim()])) as CheckoutDraft['shipping'],
    deliveryMethod: draft.deliveryMethod, paymentMethod: 'CARD' as const, expectedRevision: currentQuote?.cartRevision ?? '',
    ...(isBuyNow && buyNow ? { scope: 'BUY_NOW' as const, buyNow } : {}) };
  const requestChanged = Boolean(draft.attempt && JSON.stringify(draft.attempt.request) !== JSON.stringify(request));
  const changed = !isBuyNow && Boolean(currentQuote && currentQuote.cartRevision !== cart.data?.revision);
  const scopeBlocked = isBuyNow ? !viewCart?.canCheckout : !cart.data?.canCheckout || cart.isMutating || cart.isError || Boolean(cart.mergeError);
  const blocked = !isSessionVerified || !currentQuote?.eligible || changed || quote.isError || quote.isFetching || scopeBlocked || requestChanged;
  const unavailable = currentQuote?.blockers.some(item => item.availability === 'OUT_OF_STOCK');
  const prerequisiteError = quote.isError ? 'Unable to calculate order totals. Please refresh to continue.'
    : !isBuyNow && cart.mergeError ? cart.mergeError
    : !isBuyNow && cart.isError ? 'Current Cart availability could not be verified. Refresh Cart and totals to continue.'
    : changed ? 'Your Cart changed after totals were calculated. Refresh Cart and totals to continue.'
    : currentQuote && !currentQuote.eligible ? unavailable ? 'A Cart item is out of stock. Review your Cart or refresh totals.'
      : 'Your Cart needs review before payment. Check quantities, availability and current prices.'
    : viewCart && !viewCart.canCheckout ? 'Cart availability is not verified. Refresh Cart and totals before continuing.'
    : currentQuote && !delivery ? 'Choose an available delivery method before entering payment details.' : null;
  const refreshPrerequisites = async () => {
    if (prerequisiteBusy.current || refreshingPrerequisites) return false;
    prerequisiteBusy.current = true;
    const generation = setupGeneration.current; const owner = userId;
    const purchase = JSON.stringify(latestBuyNow.current);
    const current = () => isMounted.current && identity.current === owner && generation === setupGeneration.current &&
      JSON.stringify(latestBuyNow.current) === purchase;
    setRefreshingPrerequisites(true);
    try {
      if (!isBuyNow) await cart.retry();
      if (!current()) return;
      const cartKey = queryKeys.cart.current(userId);
      const latest = client.getQueryData<{ data: CartData }>(cartKey)?.data ?? latestCart.current.data;
      const cacheState = client.getQueryState(cartKey);
      if (!isBuyNow && (!latest?.canCheckout || cacheState?.status === 'error' || !cacheState && latestCart.current.isError)) {
        throw new Error('Cart availability could not be verified. Review Cart before continuing.');
      }
      const item = latestBuyNow.current;
      const key = queryKeys.checkout.current(userId, isBuyNow ? `buy-now:${item?.productId ?? ''}:${item?.quantity ?? 0}` : latest!.revision);
      await client.cancelQueries({ queryKey: ['checkout', userId] });
      await client.fetchQuery({ queryKey: key, staleTime: 0, retry: shouldRetry, retryDelay: 300,
        queryFn: context => apiClient<{ data: CheckoutQuote }>(isBuyNow && item
          ? `/api/checkout?scope=BUY_NOW&productId=${encodeURIComponent(item.productId)}&quantity=${item.quantity}` : '/api/checkout', { signal: catalogSignal(context) }) });
      if (!current()) return;
      autoSetup.current = '';
      setMessage('');
      return true;
    } catch { if (current()) setMessage('Checkout details could not be refreshed. Please try again.'); return false; }
    finally { prerequisiteBusy.current = false; if (isMounted.current && identity.current === owner) setRefreshingPrerequisites(false); }
  };
  useEffect(() => {
    if (!['delivery', 'payment'].includes(step) || recovering || pending || settingUp || refreshingPrerequisites || !isSessionVerified) return;
    const transient = quote.isError && quote.error instanceof ApiError && (quote.error.status === 0 || quote.error.status >= 500);
    if (!changed && !transient) return;
    const key = `${scope}:${userId}:${cart.data?.revision ?? ''}:${JSON.stringify(buyNow)}`;
    if (recoveredPrerequisite.current === key) return;
    recoveredPrerequisite.current = key;
    void refreshPrerequisites();
    // At most one automatic metadata recovery per purchase snapshot; no payment POST retry.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, recovering, pending, settingUp, refreshingPrerequisites, isSessionVerified, changed, quote.isError, quote.error, scope, userId, cart.data?.revision, buyNow?.productId, buyNow?.quantity]);
  useEffect(() => {
    if (step !== 'payment') return;
    markPaymentTiming('payment-prerequisites', { quotePresent, quoteEligible: Boolean(currentQuote?.eligible),
      quoteError: quote.isError, quoteFetching: quote.isFetching, cartEligible: Boolean(viewCart?.canCheckout),
      cartMutating: cart.isMutating, cartError: cart.isError, mergeError: Boolean(cart.mergeError), revisionChanged: changed,
      requestChanged, secretPresent: Boolean(secret), settingUp, setupPending, recovering });
  }, [step, quotePresent, currentQuote?.eligible, quote.isError, quote.isFetching, viewCart?.canCheckout,
    cart.isMutating, cart.isError, cart.mergeError, changed, requestChanged, secret, settingUp, setupPending, recovering]);
  const go = (next: CheckoutStep) => setParams({ step: next });
  // A refreshed review step needs a delivery that the loaded quote still offers. If it cannot be matched, return the
  // customer to the delivery step instead of leaving the loader on screen indefinitely.
  useEffect(() => {
    if (step !== 'review' || !currentQuote || delivery || quote.isFetching || refreshingPrerequisites) return;
    setParams({ step: 'delivery' }, { replace: true });
  }, [step, currentQuote, delivery, quote.isFetching, refreshingPrerequisites, setParams]);
  const persist = useCallback((patch: Partial<CheckoutDraft>) => {
    if (draftOwner.current !== userId) return false;
    if (!saveDraft(userId, { ...draftRef.current, ...patch }, scope)) { setMessage('Checkout recovery could not be saved. Enable session storage before paying.'); return false; }
    update(patch); return true;
  }, [userId, scope, update]);
  useEffect(() => {
    const attempt = draftRef.current.attempt;
    if (isBuyNow || pending || recovering || retryBusy.current || !cart.data?.items.length || !attempt || cart.data.revision === attempt.request.expectedRevision) return;
    setupGeneration.current++;
    persist({ attempt: null, paymentComplete: false, reviewReached: false });
    setSecret(null); setOutcome(null); setSetupError(null); setMessage(''); setSetupPending(false); setRecoveryCheckStarted(false);
    autoSetup.current = ''; initialRecovery.current = false; setPaymentState('IDLE');
    setParams({ step: 'shipping' }, { replace: true });
  }, [cart.data, isBuyNow, pending, recovering, persist, setParams, setPaymentState]);
  /** Drops only stale frontend terminal presentation. Backend PaymentAttempt history and idempotency records are untouched. */
  const dismissTerminal = (resetStep = true) => {
    forgetSubmittedPurchase(userId, scope);
    persist(draftRef.current.attempt?.submitted ? newDraft() : { attempt: null, paymentComplete: false, reviewReached: false });
    setSecret(null); setOutcome(null); setMessage(''); setSetupError(null); setSetupPending(false); setRecoveryCheckStarted(false);
    autoSetup.current = resetStep ? '' : JSON.stringify(request); setPaymentState('IDLE');
    if (resetStep) setParams({ step: 'shipping' }, { replace: true });
  };
  const clearTerminalBeforeLeaving = () => {
    // Leaving a submitted purchase's result: its details stay with that saved purchase, not the next checkout.
    const next = draftWasSubmitted(draftRef.current) ? newDraft() : { ...draftRef.current, attempt: null, paymentComplete: false, reviewReached: false };
    if (!saveDraft(userId, next, scope)) return false;
    forgetSubmittedPurchase(userId, scope);
    draftRef.current = next;
    setupGeneration.current++;
    return true;
  };
  const syncPaymentLock = (payment: PaymentOutcome) => {
    if (!payment.recoveryActive) {
      setPaymentState('IDLE');
      return;
    }
    setPaymentState(payment.state === 'CAPTURE_PENDING' ? 'CAPTURE_PENDING' : 'COMMITTING_ORDER');
  };
  useEffect(() => { if (params.get('step') !== step) setParams({ step }, { replace: true }); }, [params, step, setParams]);
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'auto' }); }, [step]);
  useEffect(() => { if (draftOwner.current === userId) saveDraft(userId, draftRef.current, scope); }, [userId, draft, scope]);
  const endSession = useCallback(() => {
    isMounted.current = false;
  }, []);
  useEffect(() => {
    isMounted.current = true;
    return endSession;
  }, [endSession]);
  useEffect(() => {
    return () => {
      void client.cancelQueries({ queryKey: queryKeys.payments.status(userId, draftRef.current.attempt?.paymentAttemptId ?? '') });
    };
  }, [client, userId]);
  useEffect(() => {
    if (draftOwner.current === userId) return;
    clearDraft(draftOwner.current, scope); draftOwner.current = userId;
    autoSetup.current = ''; handled.current = ''; initialRecovery.current = false; interactive.current = false; pollStarted.current = Date.now();
    setRecoveryCheckStarted(false);
    // Same rule as the first mount: a submitted purchase belongs to its saved snapshot, so this checkout starts clean.
    const restoredDraft = readDraft(userId, scope);
    const nextDraft = restoredDraft.attempt?.submitted === true ? newDraft() : withoutCardEntry(restoredDraft);
    draftRef.current = nextDraft;
    dispatchDraft(nextDraft); setSecret(null); setOutcome(null); setMessage(''); setSetupError(null);
  }, [userId, scope]);
  useEffect(() => {
    if (params.has('payment_intent_client_secret') || params.has('payment_intent') || params.has('redirect_status')) setParams({ step: 'review' }, { replace: true });
  }, [params, setParams]);
  const install = async (operation: () => Promise<PaymentOutcome>, expectedAttemptId: string): Promise<PaymentOutcome | null> => {
    const startedFor = userId;
    const expected = draftRef.current.attempt;
    const generation = setupGeneration.current;
    const current = () => isMounted.current && identity.current === startedFor && draftOwner.current === startedFor &&
      generation === setupGeneration.current && draftRef.current.attempt?.paymentAttemptId === expectedAttemptId;
    let result: PaymentOutcome;
    try { result = await operation(); }
    catch (error) { if (!current() || error instanceof StalePaymentAttemptResult) return null; throw error; }
    if (expected && result.attemptId === expectedAttemptId && matchesPaymentAttempt(expected, result)) synchronizePaymentOutcome(startedFor, result, client);
    const attempt = draftRef.current.attempt;
    if (!current() || !attempt || !matchesPaymentAttempt(attempt, result)) return null;
    if (!result.submittedAt && !isBuyNow && latestCart.current.data?.items.length && latestCart.current.data.revision !== attempt.request.expectedRevision) return null;
    if (result.committed || ['COMPENSATED', 'REFUNDED'].includes(result.state)) await latestCart.current.retry();
    // A delayed poll/reconciliation for an old attempt must not replace the new
    // checkout's state or navigate it to a different attempt's confirmation.
    if (!current()) return null;
    const refreshedCart = client.getQueryData<{ data: CartData }>(queryKeys.cart.current(startedFor))?.data;
    if (!result.submittedAt && !isBuyNow && refreshedCart?.items.length && refreshedCart.revision !== attempt.request.expectedRevision) return null;
    if (closed(result.state) && !result.recoveryActive && recovering && !interactive.current) {
      // A fresh entry reconciles durable history, but terminal history belongs to the
      // previous presentation session. Clear it before it can render as a failure screen.
      dismissTerminal();
      return result;
    }
    const verifiedPaid = hasVerifiedPayment(result);
    // Do not render the recovery panel's temporary success projection before
    // navigating to the canonical, backend-backed Order Confirmed route.
    if (!verifiedPaid) setOutcome(result);
    if (result.state === 'DECLINED') setMessage('');
    syncPaymentLock(result);
    if (verifiedPaid && result.confirmation) {
      markPaymentTiming('confirmation-navigation', { attemptId: result.attemptId });
      const orderRef = result.confirmation.orderReference;
      acknowledgePaymentOutcome(userId, result, client);
      clearDraft(userId, scope); forgetSubmittedPurchase(userId, scope); setSecret(null); if (isBuyNow) clearBuyNow();
      setPaymentState('IDLE');
      if (result.confirmation) {
        client.setQueryData(queryKeys.orders.confirmation(userId, result.confirmation.orderReference), { data: result.confirmation });
      }
      void client.invalidateQueries({ queryKey: queryKeys.products.all, refetchType: 'none' });
      navigate(`/checkout/confirmation/${orderRef}`, { replace: true });
    }
    return result;
  };
  const setup = async () => {
    if (!isMounted.current || setupBusy.current || !isSessionVerified || recovering || quote.isFetching || !currentQuote?.eligible || !delivery || scopeBlocked || changed || refreshingPrerequisites) return;
    const generation = setupGeneration.current;
    const startedFor = userId;
    const correlationId = crypto.randomUUID();
    let setupAttemptKey: string | null = null;
    markPaymentTiming('payment-setup-start', { correlationId });
    setupBusy.current = true; setSettingUp(true); setMessage(''); setSetupError(null);
    try {
      let saved = draft.attempt;
      if (saved && requestChanged) {
        if (!saved.paymentAttemptId) {
          const restored = await apiClient<{ data: PaymentSetup }>(endpoint, { method: 'POST', headers: { 'Idempotency-Key': saved.key }, data: saved.request });
          if (!isMounted.current || generation !== setupGeneration.current || identity.current !== startedFor || !matchesPaymentAttempt(saved, restored.data)) return;
          saved = { ...saved, paymentAttemptId: restored.data.attemptId }; persist({ attempt: saved });
        }
        const oldId = saved.paymentAttemptId;
        if (!oldId) throw new Error('Saved payment attempt could not be restored.');
        const currentStatus = (await apiClient<{ data: PaymentOutcome }>(`${endpoint}/${oldId}`)).data;
        if (!isMounted.current || generation !== setupGeneration.current || identity.current !== startedFor || currentStatus.attemptId !== oldId) return;
        if (currentStatus.state === 'PAID' || closed(currentStatus.state)) {
          persist({ attempt: null, paymentComplete: false });
          setSecret(null); saved = null;
        } else {
          // Changed UI details are not authorization to cancel a financially
          // protected attempt. Observe it separately; do not install its outcome.
          setSecret(null);
          setSetupBlocker({ id: oldId, key: saved.key, generation, started: Date.now() });
          setSetupError('An existing payment is unresolved. Checking its status before starting another payment.');
          autoSetup.current = '';
          return;
        }
      }
      const attempt: SubmissionAttempt = saved ?? { key: crypto.randomUUID(), request, status: 'setup' };
      setupAttemptKey = attempt.key;
      if (!persist({ attempt })) {
        autoSetup.current = '';
        setSetupError('Checkout recovery could not be saved. Enable session storage before paying.');
        return;
      }
      markPaymentTiming('payment-request-start', { correlationId });
      const response = await apiClient<{ data: PaymentSetup }>(endpoint, { method: 'POST', headers: { 'Idempotency-Key': attempt.key, 'X-Request-ID': correlationId }, data: attempt.request });
      markPaymentTiming('payment-request-response', { correlationId });
      markPaymentTiming('payment-setup-response', { correlationId });
      if (!isMounted.current || identity.current !== startedFor || generation !== setupGeneration.current || draftRef.current.attempt?.key !== attempt.key) {
        return;
      }
      if (!matchesPaymentAttempt(attempt, response.data)) throw new Error('Payment session identity mismatch.');
      if (!isBuyNow && latestCart.current.data?.revision !== attempt.request.expectedRevision) return;
      const needsEntry = requestChanged || !secret;
      persist({ attempt: { ...attempt, paymentAttemptId: response.data.attemptId, ...(response.data.intentId ? { intentId: response.data.intentId } : {}),
        ...(response.data.cartIdentity ? { cartIdentity: response.data.cartIdentity } : {}), status: 'setup' }, ...(needsEntry ? { paymentComplete: false } : {}) });
      const clientSecret = !response.data.committed && ['AWAITING_INPUT', 'ACTION_REQUIRED'].includes(response.data.state)
        ? response.data.clientSecret : null;
      if (clientSecret) markPaymentTiming('client-secret-received');
      setOutcome(response.data); setSecret(clientSecret); setSetupError(null);
      if (needsEntry && step === 'review' && clientSecret) go('payment');
      if (!clientSecret) {
        if (waitingForEntry(response.data)) {
          const statusKey = queryKeys.payments.status(userId, response.data.attemptId);
          client.removeQueries({ queryKey: statusKey, exact: true });
          if (!setupPollStarted.current || attempt.paymentAttemptId !== response.data.attemptId) setupPollStarted.current = Date.now();
          setSetupPending(true);
        } else if (['DECLINED', 'CANCELED', 'COMPENSATED', 'REFUNDED'].includes(response.data.state)) {
          initialRecovery.current = true;
          if (draftRef.current.attempt) persist({ attempt: { ...draftRef.current.attempt, status: 'unknown' } });
          setRecoveryCheckStarted(true);
          // One safe replacement for a verified pre-purchase terminal attempt.
          // Revalidate prerequisites through the same retry path; never replace
          // an authorized/committed/uncertain operation or loop on failures.
          if (!interactive.current && !entryRecoveryUsed.current && !response.data.recoveryActive && !response.data.committed &&
            ['DECLINED', 'CANCELED'].includes(response.data.state)) {
            entryRecoveryUsed.current = true; entryRecoveryRequested.current = true;
            setRefreshingPrerequisites(true);
          }
        } else if (response.data.recoveryActive || ['AUTHORIZED', 'CAPTURE_PENDING', 'PROCESSING', 'CANCEL_PENDING', 'REFUND_PENDING', 'INCIDENT', 'PAID'].includes(response.data.state)) {
          initialRecovery.current = true;
          if (draftRef.current.attempt) persist({ attempt: { ...draftRef.current.attempt, status: 'unknown' } });
          setRecoveryCheckStarted(true);
        } else {
          autoSetup.current = '';
          setSetupError('Secure payment setup could not finish. Your saved attempt is safe. Retry payment setup to resume it.');
        }
      } else {
        setSetupPending(false);
        setupPollStarted.current = 0;
      }
    } catch (error) {
      if (!isMounted.current || generation !== setupGeneration.current || identity.current !== startedFor ||
        (setupAttemptKey && draftRef.current.attempt?.key !== setupAttemptKey)) return;
      autoSetup.current = '';
      setSetupPending(false);
      const isConflict = error instanceof ApiError && (error.code === 'PAYMENT_RECOVERY_PENDING' || /another payment attempt/i.test(error.message));
      if (isConflict && error instanceof ApiError && error.data && typeof error.data === 'object') {
        const body = Reflect.get(error.data, 'error');
        const recovery = body && typeof body === 'object' ? Reflect.get(body, 'recovery') : null;
        const id = recovery && typeof recovery === 'object' ? Reflect.get(recovery, 'attemptId') : null;
        if (typeof id === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id) && setupAttemptKey) {
          setSetupBlocker({ id, key: setupAttemptKey, generation, started: Date.now() });
        }
      }
      if (isPaymentsDisabledError(error)) { setPaymentsRefused(true); setSetupError(PAYMENTS_UNAVAILABLE_MESSAGE); return; }
      const checkoutValidation = error instanceof ApiError && ['CHECKOUT_CHANGED', 'CHECKOUT_INVALID_CART', 'CHECKOUT_INVALID_DELIVERY', 'CHECKOUT_VALIDATION_ERROR', 'IDEMPOTENCY_CONFLICT'].includes(error.code ?? '');
      setSetupError(isConflict ? 'Another payment attempt is being resolved. Retry setup after it finishes.' : checkoutValidation ? error.message : 'Secure payment setup could not finish. Your saved attempt is safe. Retry payment setup to resume it.');
    }
    finally {
      setupBusy.current = false;
      if (isMounted.current) setSettingUp(false);
      if (isMounted.current && generation !== setupGeneration.current) {
        // A retry superseded this request while it was in flight. Let the
        // latest render start setup with its current attempt and prerequisites.
        autoSetup.current = '';
        setSetupEpoch(value => value + 1);
      }
    }
  };
  // Observe the blocker independently; never install its Cart, secret or confirmation
  // into this checkout. Only a verified terminal release permits the saved setup key.
  useEffect(() => {
    if (!setupBlocker || !setupError || !isSessionVerified) return;
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let activeRead: AbortController | undefined;
    const current = () => !disposed && isMounted.current && setupBlocker.generation === setupGeneration.current &&
      draftRef.current.attempt?.key === setupBlocker.key;
    const observe = async () => {
      const controller = new AbortController(); activeRead = controller;
      const deadline = setTimeout(() => controller.abort(), Math.max(0, CHECKOUT_RECOVERY_WINDOW_MS - (Date.now() - setupBlocker.started)));
      try {
        const result = (await apiClient<{ data: PaymentOutcome }>(`${endpoint}/${setupBlocker.id}`, { signal: controller.signal })).data;
        if (!current()) return;
        if (result.attemptId !== setupBlocker.id) throw new Error('Payment recovery identity could not be verified.');
        if (['PAID', 'CANCELED', 'DECLINED', 'COMPENSATED', 'REFUNDED'].includes(result.state) && !result.recoveryActive) {
          if (resumedBlocker.current === `${setupBlocker.id}:${setupBlocker.key}`) return;
          resumedBlocker.current = `${setupBlocker.id}:${setupBlocker.key}`;
          const refreshed = await refreshPrerequisites();
          if (!current() || !refreshed) return;
          setSetupBlocker(null); setSetupError(null); autoSetup.current = ''; setSetupEpoch(value => value + 1);
          return;
        }
        if (Date.now() - setupBlocker.started >= CHECKOUT_RECOVERY_WINDOW_MS) {
          setSetupError('The previous payment is still unresolved. Automatic checks have paused; check its saved status before another payment.');
          return;
        }
        setSetupError('An existing payment is unresolved. Checking its status before starting another payment.');
        timer = setTimeout(() => void observe(), 2000);
      } catch {
        if (current()) setSetupError(Date.now() - setupBlocker.started >= CHECKOUT_RECOVERY_WINDOW_MS
          ? 'The previous payment is still unresolved. Automatic checks have paused; check its saved status before another payment.'
          : 'The previous payment status could not be verified. Retry setup safely or review Cart.');
      } finally { clearTimeout(deadline); }
    };
    void observe();
    return () => { disposed = true; activeRead?.abort(); if (timer) clearTimeout(timer); };
    // Observer lifetime is the exact rejected setup identity, not error text updates.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setupBlocker, isSessionVerified]);
  useEffect(() => {
    if (draftRef.current.attempt !== draft.attempt) return;
    if (paymentsUnavailable || !isSessionVerified || !currentQuote?.eligible || !delivery || quote.isError || quote.isFetching || setupError || recovering || scopeBlocked || changed || refreshingPrerequisites || !['payment', 'review'].includes(step)) return;
    const signature = JSON.stringify(request); if (autoSetup.current === signature) return;
    autoSetup.current = signature; void setup();
    // Only immutable purchase facts trigger setup; secrets never enter a query cache.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paymentsUnavailable, isSessionVerified, currentQuote?.cartRevision, currentQuote?.eligible, delivery?.id, quote.isError, quote.isFetching, setupError, draft.shipping, draft.deliveryMethod, step, recovering, scopeBlocked, changed, refreshingPrerequisites, setupEpoch]);
  const check = async () => {
    if (busy.current || !isSessionVerified || !draft.attempt) return;
    const generation = setupGeneration.current;
    const attemptKey = draft.attempt.key;
    const current = () => isMounted.current && generation === setupGeneration.current && draftRef.current.attempt?.key === attemptKey;
    busy.current = true; setPending(true); setMessage('');
    try {
      let attempt = draft.attempt;
      if (!attempt.paymentAttemptId) {
        const restored = await apiClient<{ data: PaymentSetup }>(endpoint, { method: 'POST', headers: { 'Idempotency-Key': attempt.key }, data: attempt.request });
        if (!current() || !matchesPaymentAttempt(attempt, restored.data)) return;
        attempt = { ...attempt, paymentAttemptId: restored.data.attemptId, status: 'unknown' }; persist({ attempt });
      }
      const attemptId = attempt.paymentAttemptId;
      if (!attemptId) throw new Error('Saved payment attempt could not be restored.');
      const result = await install(async () => (await apiClient<{ data: PaymentOutcome }>(`${endpoint}/${attemptId}/reconcile`, { method: 'POST', data: {} })).data, attemptId);
      if (!result) return;
      // A fresh mount never re-presents an old terminal outcome; the next Checkout starts clean at Shipping.
      if (!interactive.current && closed(result.state) && !result.recoveryActive) dismissTerminal();
      return result;
    } catch { if (current()) setMessage('The outcome could not be checked. Your saved attempt is retained; do not start another payment.'); }
    finally { void client.invalidateQueries({ queryKey: ['payment-purchases', userId] }); if (isMounted.current && generation === setupGeneration.current) { busy.current = false; setPending(false); } }
  };
  useEffect(() => {
    if (!setupPending) return;
    const timeout = window.setTimeout(() => {
      setSetupPending(false);
      autoSetup.current = '';
      setSetupError('Secure payment setup is taking longer than expected. Your saved attempt is safe. Retry payment setup to resume it.');
    }, Math.max(0, 30_000 - (Date.now() - setupPollStarted.current)));
    return () => window.clearTimeout(timeout);
  }, [setupPending, draft.attempt?.paymentAttemptId]);
  const status = useQuery({ queryKey: queryKeys.payments.status(userId, draft.attempt?.paymentAttemptId ?? ''),
    queryFn: async context => {
      markPaymentTiming('status-read-start', { attemptId: draft.attempt?.paymentAttemptId ?? '' });
      const response = await apiClient<{ data: PaymentOutcome }>(`${endpoint}/${draft.attempt?.paymentAttemptId}`, { signal: context.signal });
      markPaymentTiming('status-read-response', { attemptId: response.data.attemptId, state: response.data.state, recoveryActive: response.data.recoveryActive });
      return response;
    },
    enabled: isSessionVerified && draftOwner.current === userId && (setupPending || recovering && recoveryCheckStarted) && Boolean(draft.attempt?.paymentAttemptId) && !pending,
    retry: false, staleTime: 0, refetchInterval: query => document.visibilityState === 'visible' &&
      (setupPending ? Date.now() - setupPollStarted.current < 30_000 && (!query.state.data || waitingForEntry(query.state.data.data))
        ? 1000 : false
        : !query.state.data || !isResolvedPayment(query.state.data.data) ? 2000 : false) });
  useEffect(() => {
    if (setupPending && status.isError && !status.isFetching) {
      setSetupPending(false);
      setSetupError('Current payment setup could not be checked. Your saved attempt is preserved. Retry payment setup to resume it safely.');
      return;
    }
    if (!status.data || status.isFetching || !draft.attempt || !matchesPaymentAttempt(draft.attempt, status.data.data)) return;
    if (setupPending) {
      const result = status.data.data;
      if (waitingForEntry(result)) return;
      handled.current = `${result.attemptId}:${result.state}`;
      setOutcome(result);
      setSetupPending(false);
      if (['AWAITING_INPUT', 'ACTION_REQUIRED'].includes(result.state)) {
        autoSetup.current = '';
        setSetupEpoch(value => value + 1);
      } else if (result.state === 'PAID') {
        void install(async () => result, result.attemptId);
      } else if (['DECLINED', 'CANCELED', 'COMPENSATED', 'REFUNDED'].includes(result.state) && !result.recoveryActive) {
        if (!interactive.current) { dismissTerminal(); return; }
        initialRecovery.current = true;
        if (draft.attempt) persist({ attempt: { ...draft.attempt, status: 'unknown' } });
      } else {
        if (draft.attempt) persist({ attempt: { ...draft.attempt, status: 'unknown' } });
        setRecoveryCheckStarted(true);
      }
      return;
    }
    // Cached entry-readiness responses are not terminal recovery responses.
    // Once setup observation ends, they cannot dismiss the current checkout.
    if (pending || !recovering) return;
    const result = status.data.data;
    if (isResolvedPayment(result) && handled.current !== `${result.attemptId}:${result.state}:${result.confirmation?.paymentState}`) {
      handled.current = `${result.attemptId}:${result.state}:${result.confirmation?.paymentState}`;
      // This authenticated response already contains Cart and confirmed payment
      // state. Do not spend another full API/DB round trip re-reading it.
      void install(async () => result, result.attemptId)
        .then(latest => { if (latest && !interactive.current && closed(latest.state) && !latest.recoveryActive) dismissTerminal(); })
        .catch(() => {
          if (draftRef.current.attempt?.paymentAttemptId !== result.attemptId) return;
          handled.current = ''; setMessage('Cart could not be refreshed. Check payment status again.');
        });
    } else if (!isResolvedPayment(result)) {
      setOutcome(result);
      syncPaymentLock(result);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status.data, status.isFetching, status.isError, pending, setupPending, recovering, draft.attempt?.paymentAttemptId]);
  useEffect(() => {
    if (recovering && isSessionVerified && !initialRecovery.current && !busy.current) {
      initialRecovery.current = true;
      setRecoveryCheckStarted(true);
      void check();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recovering, isSessionVerified]);
  useEffect(() => {
    const attemptId = draft.attempt?.paymentAttemptId;
    if (!recovering || pending || !attemptId || outcome && isResolvedPayment(outcome)) return;
    const timer = window.setTimeout(() => {
      if (draftRef.current.attempt?.paymentAttemptId !== attemptId) return;
      // The persisted attempt remains server-owned. A non-blocking account
      // page continues reads without allowing another authorization/capture.
      setPaymentState('IDLE');
      markPaymentTiming('durable-recovery-handoff', { attemptId });
      navigate(`/cart?purchase=${attemptId}`, { replace: true });
    }, Math.max(0, CHECKOUT_RECOVERY_WINDOW_MS - (Date.now() - pollStarted.current)));
    return () => window.clearTimeout(timer);
  }, [recovering, pending, draft.attempt?.paymentAttemptId, outcome, navigate, scope, setPaymentState]);
  // Checkout owns presentation of the attempt it is processing or showing; the global toast skips it.
  usePresentedPaymentAttempt(pending || recovering ? draft.attempt?.paymentAttemptId : null);
  useEffect(() => {
    // A terminal result shown on this screen is acknowledged so no toast repeats it after leaving.
    if (!recovering || pending || !userId || !outcome || !isResolvedPayment(outcome) || outcome.recoveryActive || !isNotifiableOutcome(outcome)) return;
    const key = `${userId}:${outcome.attemptId}:${outcome.state}`;
    if (acknowledged.current === key) return;
    acknowledged.current = key; acknowledgePaymentOutcome(userId, outcome, client);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recovering, pending, userId, outcome?.attemptId, outcome?.state, outcome?.recoveryActive]);
  const review = async () => {
    if (busy.current) return;
    if (blocked || requestChanged) {
      setMessage('Review your Cart and checkout details before continuing.');
      return;
    }
    if (!entry.current) {
      setMessage('Secure card entry is still loading.');
      return;
    }
    if (requestChanged) {
      void setup();
      return;
    }
    busy.current = true;
    const generation = setupGeneration.current;
    const attemptKey = draft.attempt?.key;
    try {
      const error = await entry.current.validate();
      if (!isMounted.current || generation !== setupGeneration.current || draftRef.current.attempt?.key !== attemptKey) return;
      if (error) { setMessage(error); return; }
      if (persist({ paymentComplete: true, reviewReached: true })) { go('review'); setMessage(''); setCardReentry(false); }
    } finally { busy.current = false; }
  };
  useEffect(() => {
    if (!pending || !draft.attempt?.paymentAttemptId) return;
    const attemptId = draft.attempt.paymentAttemptId;
    const timer = window.setTimeout(() => navigate(`/cart?purchase=${attemptId}`), CHECKOUT_RECOVERY_WINDOW_MS);
    return () => window.clearTimeout(timer);
  }, [pending, draft.attempt?.paymentAttemptId, scope, navigate]);
  const place = async () => {
    const submittedEntries = [...historyEntries.current];
    window.scrollTo({ top: 0, behavior: 'instant' });
    document.documentElement.scrollTop = 0;
    document.body.scrollTop = 0;
    const attempt = draft.attempt;
    if (busy.current || blocked || !entry.current || !attempt?.paymentAttemptId) return;
    const saved = { ...attempt, status: 'pending' as const }; if (!persist({ attempt: saved })) return;
    // The exact secure-entry instance the customer pressed Place Order on; see the handoff contract after /submit.
    const entryAtSubmit = entry.current?.instance ?? null;
    const generation = setupGeneration.current;
    const current = () => isMounted.current && generation === setupGeneration.current && draftRef.current.attempt?.key === attempt.key;
    // This mount already performs the initial reconcile as part of Place Order.
    // Do not launch a second automatic reconcile if its response is lost; status
    // reads can continue, while a genuine reload gets one fresh initial check.
    initialRecovery.current = true;
    setRecoveryCheckStarted(true);
    interactive.current = true;
    busy.current = true; setPending(true); setMessage(''); pollStarted.current = Date.now();
    let paid = false;
    let inputInvalid = false;
    let submitRejected = false;
    let staleAttempt = false;
    try {
      setPaymentState('CONFIRMING_PAYMENT');
      const result = await install(async () => {
        const validation = await entry.current?.validate();
        if (validation) { inputInvalid = true; throw new PaymentEntryValidationError(validation); }
        // The pointer must exist before the response can be lost: the server removes the Cart items on submit, so a lost
        // response followed by an empty Cart would otherwise hide a purchase that is really in flight.
        if (attempt.paymentAttemptId) rememberSubmittedPurchase(userId, scope, attempt.paymentAttemptId);
        const submitted = await apiClient<{ data: PaymentOutcome }>(`${endpoint}/${attempt.paymentAttemptId}/submit`, { method: 'POST', data: {} })
          .catch((error: unknown) => {
            // A definitive rejection means nothing was submitted; keep the pointer only for unknown outcomes.
            if (error instanceof ApiError && error.status >= 400 && error.status < 500) { submitRejected = true; forgetSubmittedPurchase(userId, scope); }
            throw error;
          });
        if (!matchesPaymentAttempt(attempt, submitted.data)) throw new StalePaymentAttemptResult();
        // Submission is already durable even when navigation wins the response
        // race. Preserve owned discovery, never confirm an unmounted card form.
        if (attempt.paymentAttemptId) rememberSubmittedPurchase(userId, scope, attempt.paymentAttemptId);
        if (attempt.paymentAttemptId) rememberPurchaseEntries(userId, scope, submittedEntries, attempt.paymentAttemptId);
        void client.invalidateQueries({ queryKey: ['payment-purchases', userId] });
        void client.invalidateQueries({ queryKey: queryKeys.cart.current(userId) });
        // Handoff contract (Task 03.6 MacBook/Buds2/iPad incidents): once the server accepted Place Order, confirmation depends only on THIS
        // attempt's secure card form still being mounted, not on page-wide freshness (Cart/quote refetches during a slow /submit used to drop
        // it). If the form is gone the customer left: nothing is confirmed in the background and NOTHING is released or cancelled. The
        // purchase stays Pending -> Processing; recovery resolves it (Payment failed with Try Again on the same intent if Stripe never saw it).
        const paymentAttemptId = attempt.paymentAttemptId;
        const form = entry.current;
        if (!paymentAttemptId || !entryAtSubmit || !form || form.instance !== entryAtSubmit) throw new StalePaymentAttemptResult();
        if (current()) persist({ attempt: { ...saved, submitted: true } });
        // The submission view keeps Elements mounted even when the active Cart is empty.
        markPaymentTiming('authorization-start', { attemptId: paymentAttemptId });
        // Intent is durable before Stripe.js is asked to confirm; an uncertain signal blocks confirmation entirely (the purchase stays Processing).
        // It is announced only after the card form validated, so a local validation failure never leaves a marker for a confirmation Stripe never saw.
        const confirmation = await form.confirm(() => announceConfirmation(paymentAttemptId));
        void client.invalidateQueries({ queryKey: queryKeys.cart.current(userId) });
        markPaymentTiming('authorization-response', { attemptId: attempt.paymentAttemptId ?? '', kind: confirmation?.kind ?? 'unavailable' });
        if (!confirmation || confirmation.kind === 'validation-error') {
          inputInvalid = true;
          throw new PaymentEntryValidationError(confirmation?.message ?? 'Secure card entry is unavailable.');
        }
        // Stripe.js errors after confirmPayment are not treated as final client-side
        // state. Reconcile the owned attempt so the server verifies the provider's
        // PaymentIntent and projects a decline only when Stripe confirms it.
        if (current()) {
          if (confirmation.kind === 'confirmed') setPaymentState('AUTHORIZED');
          setPaymentState('COMMITTING_ORDER');
        }
        markPaymentTiming('reconciliation-start', { attemptId: attempt.paymentAttemptId ?? '' });
        const reconcileResponse = await apiClient<{ data: PaymentOutcome }>(`${endpoint}/${attempt.paymentAttemptId}/reconcile`, { method: 'POST', data: {} });
        markPaymentTiming('reconciliation-response', { attemptId: reconcileResponse.data.attemptId, state: reconcileResponse.data.state });
        return reconcileResponse.data;
      }, attempt.paymentAttemptId);
      if (!result) { staleAttempt = true; return; }
      paid = hasVerifiedPayment(result);
    } catch (error) {
      if (!current()) { staleAttempt = true; return; }
      if (submitRejected) {
        // The server refused to start this payment (nothing was submitted or confirmed): the customer can simply try again.
        setMessage('Secure payment could not start. Nothing was charged. Please try Place Order again.');
        setPaymentState('IDLE');
      } else if (error instanceof PaymentEntryValidationError) {
        setMessage(error.message);
        setPaymentState('IDLE');
      } else {
        setOutcome(null);
        setMessage('The payment outcome is not yet known. Check the saved attempt before trying again.');
        // Keep the shell locked until the authenticated status read distinguishes
        // an active worker from durable queued recovery.
        setPaymentState('COMMITTING_ORDER');
      }
    }
    finally {
      // Saved purchases (Cart, notifications) re-read server truth once this attempt's reconcile has settled,
      // so a stale pre-reconcile "Processing" projection is not shown after Checkout learned more.
      void client.invalidateQueries({ queryKey: ['payment-purchases', userId] });
      if (!paid && !staleAttempt && current()) {
        persist({ attempt: { ...draftRef.current.attempt!, status: inputInvalid || submitRejected ? 'setup' : 'unknown' } });
      }
      if (current()) {
        busy.current = false;
        setPending(false);
      }
    }
  };
  const retry = async () => {
    if (retryBusy.current || !outcome || pending || outcome.recoveryActive || !isResolvedPayment(outcome) || outcome.state === 'PAID') return;
    retryBusy.current = true;
    const generation = ++setupGeneration.current;
    const startedFor = userId;
    const attemptId = draftRef.current.attempt?.paymentAttemptId;
    const shippingSnapshot = JSON.stringify([draftRef.current.shipping, draftRef.current.deliveryMethod, latestBuyNow.current]);
    const current = () => isMounted.current && identity.current === startedFor && generation === setupGeneration.current &&
      draftRef.current.attempt?.paymentAttemptId === attemptId &&
      JSON.stringify([draftRef.current.shipping, draftRef.current.deliveryMethod, latestBuyNow.current]) === shippingSnapshot;
    setRefreshingPrerequisites(true);
    try {
      // Recovery disables the quote observer. Refresh explicitly before exposing
      // card entry, and never refetch a quote keyed by the pre-failure revision.
      await client.cancelQueries({ queryKey: queryKeys.payments.status(userId, attemptId ?? '') });
      if (!isBuyNow) await cart.retry();
      if (!current()) return;
      const cartKey = queryKeys.cart.current(userId);
      const refreshedCart = client.getQueryData<{ data: CartData }>(cartKey)?.data ?? latestCart.current.data;
      const cartReadFailed = client.getQueryState(cartKey)?.status === 'error' ||
        !client.getQueryState(cartKey) && latestCart.current.isError;
      if (!isBuyNow && (!refreshedCart?.canCheckout || cartReadFailed || latestCart.current.isMutating || latestCart.current.mergeError)) {
        throw new Error('Cart availability could not be verified. Review Cart before trying again.');
      }
      if (Object.keys(shippingErrors(draftRef.current.shipping)).length) {
        throw new Error('Review your shipping address before trying again.');
      }
      await client.cancelQueries({ queryKey: ['checkout', userId] });
      await client.invalidateQueries({ queryKey: ['checkout', userId], refetchType: 'none' });
      const quoteKey = queryKeys.checkout.current(userId, isBuyNow ? `buy-now:${buyNow?.productId ?? ''}:${buyNow?.quantity ?? 0}` : refreshedCart!.revision);
      const refreshed = await client.fetchQuery({ queryKey: quoteKey, retry: shouldRetry, retryDelay: 300, staleTime: 0,
        queryFn: context => apiClient<{ data: CheckoutQuote }>(isBuyNow && buyNow
          ? `/api/checkout?scope=BUY_NOW&productId=${encodeURIComponent(buyNow.productId)}&quantity=${buyNow.quantity}` : '/api/checkout', { signal: catalogSignal(context) }) });
      if (!current()) return;
      const nowCart = client.getQueryData<{ data: CartData }>(cartKey)?.data ?? latestCart.current.data;
      const selectedDelivery = refreshed.data.deliveryMethods.find(method => method.id === draftRef.current.deliveryMethod);
      if (!refreshed.data.eligible || !selectedDelivery || !isBuyNow && (nowCart?.revision !== refreshed.data.cartRevision || !nowCart.canCheckout || latestCart.current.isMutating)) {
        throw new Error('Checkout availability changed. Review Cart and your delivery method before trying again.');
      }
      const payment = latestOutcome.current;
      if (!payment || payment.attemptId !== attemptId || payment.recoveryActive || !isResolvedPayment(payment) || payment.state === 'PAID') return;
      // Only verified terminal failures get a new setup key. Recoverable card
      // entry retains its original attempt/key; backend still verifies its truth.
      const replace = ['DECLINED', 'CANCELED', 'COMPENSATED', 'REFUNDED'].includes(payment.state);
      if (!persist({ attempt: replace ? null : draftRef.current.attempt ? { ...draftRef.current.attempt, status: 'setup' } : null,
        paymentComplete: false })) return;
      busy.current = false; interactive.current = true;
      setPaymentState('IDLE'); setSecret(null); setOutcome(null);
      setSetupPending(false); setRecoveryCheckStarted(false);
      handled.current = ''; initialRecovery.current = false; autoSetup.current = '';
      setMessage(''); setSetupError(null);
      go('payment');
    } catch (error) {
      if (current()) setMessage(error instanceof ApiError ? 'Checkout details could not be revalidated. Try Again to retry safely, or review Cart.'
        : error instanceof Error ? error.message : 'Checkout details could not be revalidated. Try Again to retry safely.');
    } finally {
      retryBusy.current = false;
      if (isMounted.current && identity.current === startedFor) setRefreshingPrerequisites(false);
    }
  };
  /** Payment Failed → Try Again for a submitted purchase: open its own saved-purchase Checkout. The backend decides eligibility there. */
  const retrySubmitted = () => {
    const payment = latestOutcome.current;
    if (pending || !payment?.submittedAt || payment.recoveryActive || payment.retryAllowed === false || !isResolvedPayment(payment)) return;
    // This scope's draft drops the terminal presentation only; the saved attempt stays server-owned.
    if (!clearTerminalBeforeLeaving()) return;
    setPaymentState('IDLE');
    navigate('/checkout?step=payment', { state: { retryPurchase: payment.attemptId } });
  };
  useEffect(() => {
    if (!entryRecoveryRequested.current || !recovering || !outcome || !isResolvedPayment(outcome)) return;
    entryRecoveryRequested.current = false;
    void retry();
    // One scheduled recovery; retry has its own identity/generation/busy fences.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recovering, outcome]);
  if (!isSessionVerified || draftOwner.current !== userId) return <ElectroHubLoader page />;
  if (recovering) {
    return (
      <div className={styles.recoveryWrapper}>
      <PaymentRecovery outcome={outcome} message={message} pending={pending || refreshingPrerequisites}
        onCheck={() => void check()} onRetry={() => { if (outcome?.submittedAt) retrySubmitted(); else void retry(); }}
        onLeave={clearTerminalBeforeLeaving} />
      </div>
    );
  }
  // After a purchase is submitted its items leave the active Cart, so an empty Cart here may simply mean "that purchase is still
  // being confirmed". Show that purchase from its authoritative status; only fall back to the empty view when there is none.
  const restoreOr = (fallback: ReactNode) => {
    // Sticky for this mount: presenting the result clears the stored pointer, which must not swap the screen out underneath the customer.
    const submitted = restoredPurchase.current ?? readSubmittedPurchase(userId, scope);
    restoredPurchase.current = submitted;
    return submitted ? <RestoredPurchase key={submitted} attemptId={submitted} scope={scope} userId={userId} fallback={fallback} /> : fallback;
  };
  if (isBuyNow) {
    if (!buyNow) return restoreOr(<div className={`${styles.page} ${styles.empty}`}><h1>Nothing to buy</h1><p>Choose a product to buy now.</p><Link className={styles.primaryLink} to="/products">Continue Shopping</Link></div>);
  } else {
    if (!cart.data) return cart.isLoading ? <ElectroHubLoader page /> : <div className={styles.page}><h1>Checkout</h1><p role="alert">Checkout could not load.</p><Button onClick={() => void cart.retry()}>Retry Cart</Button></div>;
    if (!cart.data.items.length && !pending) return restoreOr(<div className={`${styles.page} ${styles.empty}`}><h1>Your cart is empty</h1><p>Add products before starting checkout.</p><Link className={styles.primaryLink} to="/products">Continue Shopping</Link></div>);
  }
  const completed: CheckoutStep[] = [...(draft.shippingComplete ? ['shipping' as const] : []), ...(draft.deliveryComplete ? ['delivery' as const] : []), ...(draft.paymentComplete ? ['payment' as const] : [])];
  const content = <>
    {step === 'shipping' && <ShippingStep value={draft.shipping} onChange={shipping => update({ shipping, shippingComplete: false })} onContinue={() => { update({ shippingComplete: true }); go('delivery'); }} />}
    {step === 'delivery' && <DeliveryStep methods={currentQuote?.deliveryMethods ?? []} selected={draft.deliveryMethod} loading={quote.isLoading || (!currentQuote && !quote.isError)} onChange={deliveryMethod => update({ deliveryMethod })} onBack={() => go('shipping')} onContinue={() => { update({ deliveryComplete: true }); go('payment'); }} />}
      {step === 'payment' && !secret && (
        <PaymentStep ready={false} onBack={() => go('delivery')} onContinue={() => void review()}>
        {prerequisiteError ? (
          <div className={styles.providerError}><p role="alert">{prerequisiteError}</p><div className={styles.inlineActions}>
            <Button size="small" variant="outline" onClick={() => void refreshPrerequisites()} disabled={refreshingPrerequisites} isLoading={refreshingPrerequisites}>Refresh totals</Button>
            {!isBuyNow && <Link to="/cart">Review Cart</Link>}
          </div></div>
        ) : !isBuyNow && cart.isMutating ? (
          <div className={styles.providerError}><p role="status">An earlier Cart or checkout update is still finishing. Secure card entry will load when it completes.</p>
            <Button size="small" variant="outline" onClick={() => void refreshPrerequisites()} disabled={refreshingPrerequisites} isLoading={refreshingPrerequisites}>Refresh totals</Button>
          </div>
        ) : paymentsUnavailable ? (
          // Maintenance, not a payment problem: no retry is offered (it could only return 503) and nothing implies a card was charged.
          <div className={styles.inlineNotice}><p role="status">{PAYMENTS_UNAVAILABLE_MESSAGE}</p>
            <div className={styles.inlineActions}><Link to="/cart">Return to Cart</Link></div></div>
        ) : setupError ? (
          <div className={styles.providerError}>
            <p role="alert">{setupError}</p>
            <div className={styles.inlineActions}>
              {setupBlocker && <Link to={`/account/payment-status/${setupBlocker.id}?scope=${scope}`}>Check saved payment</Link>}
              <Button size="small" onClick={() => void setup()} disabled={settingUp} isLoading={settingUp}>
                Retry payment setup
              </Button>
              {/* Refresh totals only when the quote is stale; a setup conflict alone is not a totals problem. */}
              {changed && (
                <Button size="small" variant="outline" onClick={() => void refreshPrerequisites()} disabled={settingUp || refreshingPrerequisites} isLoading={refreshingPrerequisites}>
                  Refresh totals
                </Button>
              )}
            </div>
          </div>
        ) : (
          <PaymentSetupPending />
        )}
      </PaymentStep>
    )}
    {step === 'review' && (delivery ? <ReviewStep shipping={draft.shipping} delivery={delivery} total={delivery.totals.total} blocked={blocked || !secret || !draft.paymentComplete} onEdit={go} onBack={() => go('payment')} onPlace={() => void place()} /> : <ElectroHubLoader />)}
  </>;
  return <div className={styles.page}>
    {pending ? <div className={styles.processingWrapper}><CheckoutProcessing /></div> : <>
    <nav
      className={styles.breadcrumb}
      aria-label="Breadcrumb"
      inert={isLocked ? true : undefined}
      style={isLocked ? { pointerEvents: 'none' } : undefined}
      onClickCapture={isLocked ? e => { e.preventDefault(); e.stopPropagation(); } : undefined}
    >
      <Link to="/">Home</Link><ChevronRight size={16} aria-hidden="true" />{!isBuyNow && <><Link to="/cart">Cart</Link><ChevronRight size={16} aria-hidden="true" /></>}<span aria-current="page">{isBuyNow ? 'Buy Now Checkout' : 'Checkout'}</span>
    </nav>
    <h1>Checkout</h1><CheckoutStepper current={step} completed={completed} disabled={pending || recovering} navigationUnlocked={draft.reviewReached ?? draft.paymentComplete} onSelect={next => go(allowedStep(next, draft))} />
    {setupError && step !== 'payment' && <div className={styles.inlineNotice}><p role="alert">{setupError}</p><div className={styles.inlineActions}>{!paymentsUnavailable && <Button size="small" onClick={() => void setup()} disabled={settingUp} isLoading={settingUp}>Retry payment setup</Button>}{changed && <Button size="small" variant="outline" onClick={() => void quote.refetch()} disabled={quote.isFetching}>Refresh totals</Button>}</div></div>}
    {message && !setupError && <div className={styles.inlineNotice}><p role="alert">{message}</p></div>}
    {cardReentry && step === 'payment' && !draft.paymentComplete && !message && !setupError && <div className={styles.inlineNotice}><p aria-live="polite">For your security, card details are not kept when the page is refreshed. Enter your card again to continue to Review.</p></div>}
    {step !== 'payment' && (changed || currentQuote && !currentQuote.eligible || !isBuyNow && (cart.mergeError || cart.isError)) && !setupError && <div className={styles.inlineNotice} role="alert"><p>{isBuyNow ? 'This product is unavailable in the requested quantity. Check current availability and prices.' : 'Your Cart needs review before payment. Check quantities, availability and current prices.'}</p><div className={styles.inlineActions}>{isBuyNow ? <Link to="/products">Continue Shopping</Link> : <Link to="/cart">Review Cart</Link>}<Button size="small" variant="outline" onClick={() => void refreshPrerequisites()}>Refresh totals</Button></div></div>}
    {step !== 'payment' && quote.isError && !setupError && <div className={styles.inlineNotice} role="alert"><p>Unable to calculate order totals. Please refresh to continue.</p><div className={styles.inlineActions}><Button size="small" variant="outline" onClick={() => void refreshPrerequisites()} disabled={refreshingPrerequisites}>Refresh totals</Button></div></div>}
    </>}
    <div className={styles.layout}><div>{secret ? <StripePaymentSession key={secret} clientSecret={secret} timingAttemptId={draft.attempt?.paymentAttemptId} returnPath={draft.attempt?.paymentAttemptId ? `/account/payment-status/${draft.attempt.paymentAttemptId}?scope=${scope}` : returnPath} ref={entry} visible={step === 'payment'} pending={pending} canContinue={!blocked && !requestChanged} onBack={() => go('delivery')} onContinue={() => void review()}
      onError={() => { if (!isMounted.current || activeSecret.current !== secret) return; setSetupError('Secure card entry could not load. Retry payment setup.'); update({ paymentComplete: false }); }} onRetry={() => { if (!isMounted.current || activeSecret.current !== secret) return; setMessage(''); setSetupError(null); setSecret(null); update({ paymentComplete: false }); void setup(); }}>{pending ? null : content}</StripePaymentSession> : pending ? null : content}</div>
      {!pending && viewCart && <OrderSummary cart={viewCart} totals={delivery?.totals} deliveryLabel={delivery?.label ?? 'Shipping'} />}</div>
  </div>;
}
