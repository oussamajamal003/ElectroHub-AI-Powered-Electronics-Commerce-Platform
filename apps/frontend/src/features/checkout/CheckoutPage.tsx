import { useEffect, useReducer, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight } from 'lucide-react';
import { useAuth } from '@/features/auth/context/AuthContext';
import { useCart } from '@/features/cart/context';
import type { CartData } from '@/features/cart/types';
import { ApiError, apiClient } from '@/lib/api';
import { catalogSignal, queryKeys } from '@/lib/query';
import { Button } from '@/components/ui/Button';
import { ElectroHubLoader } from '@/components/ui/ElectroHubLoader/ElectroHubLoader';
import { allowedStep, clearDraft, readDraft, saveDraft } from './state';
import type { CheckoutDraft, CheckoutQuote, CheckoutStep, Confirmation, PurchaseResponse, SubmissionAttempt } from './types';
import { CheckoutProcessing, CheckoutStepper, DeliveryStep, OrderSummary, PaymentStep, ReviewStep, ShippingStep } from './CheckoutComponents';
import styles from './Checkout.module.scss';

export function CheckoutPage() {
  const { user, isSessionVerified } = useAuth();
  const cart = useCart(); const navigate = useNavigate(); const client = useQueryClient();
  const submitCheckout = cart.submitCheckout;
  const userId = user?.id ?? ''; const [params, setParams] = useSearchParams();
  const [draft, update] = useReducer((previous: CheckoutDraft, patch: Partial<CheckoutDraft>) => ({ ...previous, ...patch }), userId, readDraft);
  const [pending, setPending] = useState(false); const submitting = useRef(false);
  const [message, setMessage] = useState('');
  const step = allowedStep(params.get('step'), draft);
  const quote = useQuery({ queryKey: queryKeys.checkout.current(userId, cart.data?.revision ?? ''),
    queryFn: context => apiClient<{ data: CheckoutQuote }>('/api/checkout', { signal: catalogSignal(context) }),
    enabled: isSessionVerified && Boolean(cart.data?.items.length) && !cart.isMutating && !cart.mergeError,
    staleTime: 30_000 });
  const recovery = useQuery({ queryKey: queryKeys.orders.attempt(userId, draft.attempt?.key ?? ''),
    queryFn: context => apiClient<{ data: Confirmation }>(`/api/orders/attempts/${draft.attempt?.key}/confirmation`, { signal: catalogSignal(context) }),
    enabled: isSessionVerified && draft.attempt?.status === 'unknown' && !pending, retry: false, staleTime: Infinity });
  const go = (next: CheckoutStep) => setParams({ step: next });
  useEffect(() => { if (params.get('step') !== step) setParams({ step }, { replace: true }); }, [params, step, setParams]);
  useEffect(() => { saveDraft(userId, draft); }, [userId, draft]);
  useEffect(() => { if (pending && typeof window !== 'undefined') window.scrollTo({ top: 0, left: 0, behavior: 'instant' }); }, [pending]);
  const recovered = useRef(false);
  useEffect(() => {
    if (!recovery.data || recovered.current || pending) return;
    recovered.current = true;
    void submitCheckout(async () => {
      const current = await apiClient<{ data: CartData }>('/api/cart');
      return { cart: current.data, result: recovery.data.data };
    }).then(order => { clearDraft(userId); navigate(`/checkout/confirmation/${order.orderReference}`, { replace: true }); })
      .catch(() => { recovered.current = false; setMessage('Your order was found, but Cart could not be refreshed. Retry recovery.'); });
  }, [recovery.data, pending, submitCheckout, userId, navigate]);
  const currentQuote = quote.data?.data;
  const delivery = currentQuote?.deliveryMethods.find(method => method.id === draft.deliveryMethod);
  const changed = Boolean(currentQuote && currentQuote.cartRevision !== cart.data?.revision);
  const blocked = !currentQuote?.eligible || changed || quote.isError || quote.isFetching || !cart.data?.canCheckout || cart.isMutating || cart.isError || Boolean(cart.mergeError);
  const finish = (field: 'shippingComplete' | 'deliveryComplete' | 'paymentComplete', next: CheckoutStep) => { update({ [field]: true }); go(next); };
  const place = async (saved?: SubmissionAttempt) => {
    if (submitting.current || (!saved && blocked)) return;
    const attempt: SubmissionAttempt = saved ?? { key: crypto.randomUUID(), status: 'pending', request: {
      shipping: Object.fromEntries(Object.entries(draft.shipping).map(([key, value]) => [key, value.trim()])) as CheckoutDraft['shipping'],
      deliveryMethod: draft.deliveryMethod, paymentMethod: 'CARD', expectedRevision: currentQuote?.cartRevision ?? '' } };
    const nextDraft = { ...draft, attempt: { ...attempt, status: 'pending' as const } };
    if (!saveDraft(userId, nextDraft)) { setMessage('Checkout recovery could not be saved. Enable session storage before placing your order.'); return; }
    if (typeof window !== 'undefined') window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    submitting.current = true; setPending(true); setMessage(''); update({ attempt: nextDraft.attempt });
    try {
      const order = await cart.submitCheckout(async () => {
        const response = await apiClient<{ data: PurchaseResponse }>('/api/orders', { method: 'POST', headers: { 'Idempotency-Key': attempt.key }, data: attempt.request });
        return { cart: response.data.cart, result: response.data.confirmation };
      });
      clearDraft(userId);
      client.setQueryData(queryKeys.orders.confirmation(userId, order.orderReference), { data: order });
      void client.invalidateQueries({ queryKey: queryKeys.products.all, refetchType: 'none' });
      navigate(`/checkout/confirmation/${order.orderReference}`, { replace: true });
    } catch (error) {
      if (error instanceof ApiError && error.status >= 400 && error.status < 500 && error.code !== 'CHECKOUT_CONFLICT') {
        update({ attempt: null }); saveDraft(userId, { ...draft, attempt: null });
        setMessage(error.message); void cart.retry(); void quote.refetch();
      } else {
        const unknown = { ...attempt, status: 'unknown' as const };
        update({ attempt: unknown }); saveDraft(userId, { ...draft, attempt: unknown });
        setMessage('The submission outcome is unknown. Check for the saved order or retry this exact attempt safely.');
      }
    } finally { submitting.current = false; setPending(false); }
  };
  if (pending) return <CheckoutProcessing />;
  if (draft.attempt) return <div className={styles.page}><h1>Recover your checkout</h1><div className={styles.notice} role="status">
    {recovery.isPending ? <ElectroHubLoader /> : <><p>{message || (recovery.error instanceof ApiError && recovery.error.status === 404
      ? 'No confirmed order was found yet. Retry the saved attempt; it cannot create a duplicate order.'
      : 'The saved order could not be checked. Check again or retry this exact attempt safely.')}</p>
      <Button onClick={() => void place(draft.attempt ?? undefined)} disabled={cart.isMutating}>Retry same checkout attempt</Button>
      <Button variant="secondary" onClick={() => { recovered.current = false; void recovery.refetch(); }}>Check order again</Button></>}
  </div></div>;
  if (cart.isLoading && !cart.data) return <ElectroHubLoader page />;
  if (!cart.data) return <div className={styles.page}><h1>Checkout</h1><div role="alert"><p>Checkout could not be loaded.</p><Button onClick={() => void cart.retry()}>Retry Cart</Button></div></div>;
  if (!cart.data.items.length) return <div className={`${styles.page} ${styles.empty}`}><h1>Your cart is empty</h1><p>Add products before starting checkout.</p><Link className={styles.primaryLink} to="/products">Explore Products</Link></div>;
  const completed: CheckoutStep[] = [...(draft.shippingComplete ? ['shipping' as const] : []), ...(draft.deliveryComplete ? ['delivery' as const] : []), ...(draft.paymentComplete ? ['payment' as const] : [])];
  return <div className={styles.page}>
    <nav className={styles.breadcrumb} aria-label="Breadcrumb"><Link to="/">Home</Link><ChevronRight size={16} aria-hidden="true" /><Link to="/cart">Cart</Link><ChevronRight size={16} aria-hidden="true" /><span aria-current="page">Checkout</span></nav>
    <h1>Checkout</h1>
    <CheckoutStepper current={step} completed={completed} onSelect={next => go(allowedStep(next, draft))} />
    {message && <div className={styles.notice} role="alert">{message}</div>}
    {(changed || currentQuote && !currentQuote.eligible || cart.mergeError || cart.isError) && <div className={styles.notice} role="alert"><p>Your cart needs review before you can place an order. Check quantities, availability and current prices.</p><Link to="/cart">Review Cart</Link><Button variant="secondary" onClick={() => { void cart.retry(); void quote.refetch(); }}>Refresh checkout</Button></div>}
    {quote.isError && <div className={styles.notice} role="alert"><p>Delivery and totals could not be confirmed.</p><Button onClick={() => void quote.refetch()}>Retry totals</Button></div>}
    <div className={styles.layout}><div>
      {step === 'shipping' && <ShippingStep value={draft.shipping} onChange={shipping => update({ shipping, shippingComplete: false })} onContinue={() => finish('shippingComplete', 'delivery')} />}
      {step === 'delivery' && <DeliveryStep methods={currentQuote?.deliveryMethods ?? []} selected={draft.deliveryMethod} onChange={deliveryMethod => update({ deliveryMethod })} onBack={() => go('shipping')} onContinue={() => finish('deliveryComplete', 'payment')} />}
      {step === 'payment' && <PaymentStep onBack={() => go('delivery')} onContinue={() => finish('paymentComplete', 'review')} />}
      {step === 'review' && (delivery ? <ReviewStep shipping={draft.shipping} delivery={delivery} total={delivery.totals.total} blocked={blocked} onEdit={go} onBack={() => go('payment')} onPlace={() => void place()} /> : <ElectroHubLoader />)}
    </div><OrderSummary cart={cart.data} totals={delivery?.totals} deliveryLabel={delivery?.label ?? 'Shipping'} /></div>
  </div>;
}
