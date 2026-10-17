import type { CheckoutDraft, CheckoutScope, CheckoutStep, OrderRequest, Shipping } from './types';
export const steps: CheckoutStep[] = ['shipping', 'delivery', 'payment', 'review'];
export const emptyShipping: Shipping = { recipient: '', line1: '', line2: '', city: '', state: '', postalCode: '', country: '', phone: '' };
export const newDraft = (): CheckoutDraft => ({ shipping: { ...emptyShipping }, deliveryMethod: 'STANDARD', shippingComplete: false,
  deliveryComplete: false, paymentComplete: false, reviewReached: false, attempt: null });
export function shippingErrors(shipping: Shipping) {
  const errors: Partial<Record<keyof Shipping, string>> = {};
  const bounds: Record<keyof Shipping, [number, number]> = { recipient: [2, 200], line1: [2, 255], line2: [0, 255], city: [2, 100],
    state: [0, 100], postalCode: [1, 20], country: [2, 100], phone: [1, 32] };
  for (const field of Object.keys(bounds) as (keyof Shipping)[]) {
    const [min, max] = bounds[field]; const value = shipping[field].trim();
    if (value.length < min) errors[field] = 'Please complete this field.';
    else if (value.length > max) errors[field] = `Use at most ${max} characters.`;
  }
  const digits = shipping.phone.replace(/\D/g, '').length;
  if (shipping.phone.trim() && (!/^[+\d\s().-]+$/.test(shipping.phone) || digits < 7 || digits > 15)) errors.phone = 'Enter a valid phone number, including the country code where needed.';
  return errors;
}
export function allowedStep(step: string | null, draft: CheckoutDraft): CheckoutStep {
  const requested = steps.includes(step as CheckoutStep) ? step as CheckoutStep : 'shipping';
  if (requested === 'shipping') return requested;
  if (!draft.shippingComplete || Object.keys(shippingErrors(draft.shipping)).length) return 'shipping';
  if (requested === 'delivery') return requested;
  if (!draft.deliveryComplete) return 'delivery';
  if (requested === 'payment') return requested;
  return draft.paymentComplete ? 'review' : 'payment';
}
/**
 * Card entry is held only by the hosted Stripe iframe and the client secret only in memory, so neither survives a reload.
 * A restored draft therefore never counts Payment as complete: Review stays unreachable until the card is entered again.
 * The attempt, its idempotency key and the shipping/delivery choices are kept, so no second PaymentIntent is created.
 */
export const withoutCardEntry = (draft: CheckoutDraft): CheckoutDraft => draft.paymentComplete ? { ...draft, paymentComplete: false } : draft;
export const draftKey =(userId: string, scope: CheckoutScope = 'CART_CHECKOUT') =>
  scope === 'BUY_NOW' ? `electrohub:checkout:v1:buy-now:${userId}` : `electrohub:checkout:v1:${userId}`;
const scopeFields = (request: OrderRequest): Pick<OrderRequest, 'scope' | 'buyNow'> => request.scope === 'BUY_NOW' && request.buyNow
  ? { scope: 'BUY_NOW', buyNow: { productId: request.buyNow.productId, quantity: request.buyNow.quantity } } : {};
const validScope = (request: OrderRequest, scope: CheckoutScope) => scope === 'BUY_NOW'
  ? request.scope === 'BUY_NOW' && Boolean(request.buyNow) && /^[0-9a-f-]{36}$/i.test(request.buyNow?.productId ?? '') &&
    Number.isInteger(request.buyNow?.quantity) && (request.buyNow?.quantity ?? 0) >= 1 && (request.buyNow?.quantity ?? 0) <= 999
  : request.scope === undefined || request.scope === 'CART_CHECKOUT';
export function readDraft(userId: string, scope: CheckoutScope = 'CART_CHECKOUT'): CheckoutDraft {
  try {
    const saved = JSON.parse(sessionStorage.getItem(draftKey(userId, scope)) ?? 'null') as unknown;
    if (!saved || typeof saved !== 'object') return newDraft();
    const data = saved as Record<string, unknown>;
    if (data.version !== 1 || data.userId !== userId || !data.draft || typeof data.draft !== 'object') return newDraft();
    const draft = data.draft as CheckoutDraft;
    if (!draft.shipping || Object.keys(emptyShipping).some(key => typeof draft.shipping[key as keyof Shipping] !== 'string') ||
      !['STANDARD', 'EXPRESS', 'OVERNIGHT'].includes(draft.deliveryMethod) ||
      [draft.shippingComplete, draft.deliveryComplete, draft.paymentComplete].some(value => typeof value !== 'boolean')) return newDraft();
    if (draft.attempt) {
      const a = draft.attempt;
      if (!/^[0-9a-f-]{36}$/i.test(a.key) || !a.request || !['setup', 'pending', 'unknown'].includes(a.status) ||
        a.paymentAttemptId !== undefined && !/^[0-9a-f-]{36}$/i.test(a.paymentAttemptId) ||
        !/^[a-f0-9]{64}$/.test(a.request.expectedRevision) || a.request.paymentMethod !== 'CARD' ||
        !['STANDARD', 'EXPRESS', 'OVERNIGHT'].includes(a.request.deliveryMethod) || !a.request.shipping ||
        Object.keys(emptyShipping).some(key => typeof a.request.shipping[key as keyof Shipping] !== 'string') ||
        Object.keys(shippingErrors(a.request.shipping)).length || !validScope(a.request, scope)) return newDraft();
    }
    // Whitelist fields; never restore arbitrary/raw payment or Product data.
    return { shipping: Object.fromEntries(Object.keys(emptyShipping).map(key => [key, draft.shipping[key as keyof Shipping]])) as unknown as Shipping,
      deliveryMethod: draft.deliveryMethod, shippingComplete: draft.shippingComplete, deliveryComplete: draft.deliveryComplete,
      paymentComplete: draft.paymentComplete, reviewReached: draft.reviewReached === true || draft.paymentComplete,
      attempt: draft.attempt ? { submitted: draft.attempt.submitted === true, key: draft.attempt.key, status: draft.attempt.status === 'setup' ? 'setup' : 'unknown',
        ...(typeof draft.attempt.intentId === 'string' ? { intentId: draft.attempt.intentId } : {}),
        ...(typeof draft.attempt.cartIdentity === 'string' ? { cartIdentity: draft.attempt.cartIdentity } : {}),
        ...(draft.attempt.paymentAttemptId ? { paymentAttemptId: draft.attempt.paymentAttemptId } : {}), request: {
        shipping: Object.fromEntries(Object.keys(emptyShipping).map(key => [key, draft.attempt?.request.shipping[key as keyof Shipping]])) as unknown as Shipping,
        deliveryMethod: draft.attempt.request.deliveryMethod, paymentMethod: 'CARD', expectedRevision: draft.attempt.request.expectedRevision,
        ...scopeFields(draft.attempt.request) } } : null };
  } catch { return newDraft(); }
}
export function saveDraft(userId: string, draft: CheckoutDraft, scope: CheckoutScope = 'CART_CHECKOUT'): boolean {
  const shipping = (value: Shipping) => Object.fromEntries(Object.keys(emptyShipping).map(key => [key, value[key as keyof Shipping]]));
  const safe = { shipping: shipping(draft.shipping), deliveryMethod: draft.deliveryMethod, shippingComplete: draft.shippingComplete,
    deliveryComplete: draft.deliveryComplete, paymentComplete: draft.paymentComplete, reviewReached: draft.reviewReached === true,
    attempt: draft.attempt ? { submitted: draft.attempt.submitted === true, key: draft.attempt.key, status: draft.attempt.status, paymentAttemptId: draft.attempt.paymentAttemptId, intentId: draft.attempt.intentId, cartIdentity: draft.attempt.cartIdentity,
      request: { shipping: shipping(draft.attempt.request.shipping), deliveryMethod: draft.attempt.request.deliveryMethod,
        paymentMethod: 'CARD', expectedRevision: draft.attempt.request.expectedRevision, ...scopeFields(draft.attempt.request) } } : null };
  try { sessionStorage.setItem(draftKey(userId, scope), JSON.stringify({ version: 1, userId, draft: safe })); return true; } catch { return false; }
}
export function clearDraft(userId: string, scope: CheckoutScope = 'CART_CHECKOUT') { try { sessionStorage.removeItem(draftKey(userId, scope)); } catch { /* Storage may be unavailable. */ } }
/**
 * True once this draft's payment was handed to the server (or its submission outcome is unconfirmed). From then on its
 * shipping and delivery belong to that saved purchase's server snapshot, never to the next checkout in this scope.
 */
export const draftWasSubmitted = (draft: CheckoutDraft) => Boolean(draft.attempt && (draft.attempt.submitted || draft.attempt.status !== 'setup'));
export function detachDraft(userId: string, scope: CheckoutScope = 'CART_CHECKOUT') {
  const draft = readDraft(userId, scope);
  if (!draft.attempt) return true;
  // Purchase B must start clean: never prefill it with submitted Purchase A's address or delivery method.
  if (draftWasSubmitted(draft)) return saveDraft(userId, newDraft(), scope);
  return saveDraft(userId, { ...draft, attempt: null, paymentComplete: false, reviewReached: false }, scope);
}

/**
 * Identity of the purchase this customer last submitted from this scope. `detachDraft` deliberately wipes a submitted draft so
 * the next checkout starts clean; this separate pointer lets an empty Checkout find the still-unresolved purchase instead of
 * claiming the Cart is empty. It holds only the opaque attempt id; status, items and totals always come from the server.
 */
const submittedKey = (userId: string, scope: CheckoutScope) => `electrohub:checkout:submitted:v1:${scope}:${userId}`;
export function rememberSubmittedPurchase(userId: string, scope: CheckoutScope, attemptId: string) {
  try { sessionStorage.setItem(submittedKey(userId, scope), JSON.stringify({ version: 1, attemptId })); } catch { /* Storage may be unavailable. */ }
}
export function readSubmittedPurchase(userId: string, scope: CheckoutScope): string | null {
  try {
    const saved = JSON.parse(sessionStorage.getItem(submittedKey(userId, scope)) ?? 'null') as { version?: unknown; attemptId?: unknown } | null;
    return saved?.version === 1 && typeof saved.attemptId === 'string' && /^[0-9a-f-]{36}$/i.test(saved.attemptId) ? saved.attemptId : null;
  } catch { return null; }
}
export function forgetSubmittedPurchase(userId: string, scope: CheckoutScope) { try { sessionStorage.removeItem(submittedKey(userId, scope)); } catch { /* Storage may be unavailable. */ } }

// A notification may retire discovery, but not the identity of a submitted
// browser-history entry. New Checkout B has a different entry key.
const historyKey = (userId: string, scope: CheckoutScope) => `electrohub:checkout:history:v1:${scope}:${userId}`;
type PurchaseEntry = { entry: string; attemptId: string };
const validEntry = (entry: string) => entry !== 'default' && /^[a-z0-9_-]{1,64}$/i.test(entry);
function purchaseEntries(userId: string, scope: CheckoutScope): PurchaseEntry[] {
  try {
    const value: unknown = JSON.parse(sessionStorage.getItem(historyKey(userId, scope)) ?? '[]');
    return Array.isArray(value) ? value.filter((item): item is PurchaseEntry => Boolean(item && typeof item === 'object' &&
      typeof item.entry === 'string' && validEntry(item.entry) && typeof item.attemptId === 'string' &&
      /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(item.attemptId))).slice(-100) : [];
  } catch { return []; }
}
export function rememberPurchaseEntries(userId: string, scope: CheckoutScope, entries: string[], attemptId: string) {
  if (!userId || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(attemptId)) return;
  const keys = new Set(entries.filter(validEntry));
  const saved = purchaseEntries(userId, scope).filter(item => !keys.has(item.entry));
  try { sessionStorage.setItem(historyKey(userId, scope), JSON.stringify([...saved, ...[...keys].map(entry => ({ entry, attemptId }))].slice(-100))); }
  catch { /* Explicit purchase URLs remain available when session storage is unavailable. */ }
}
export function readPurchaseEntry(userId: string, scope: CheckoutScope, entry: string): string | null {
  return validEntry(entry) ? purchaseEntries(userId, scope).find(item => item.entry === entry)?.attemptId ?? null : null;
}

const terminalStates = ['PAID', 'DECLINED', 'CANCELED', 'COMPENSATED', 'REFUNDED'];
/**
 * A terminal result the customer has now been shown (toast, result screen) must not be shown again by an empty Checkout.
 * Clears the pointer only when it names this exact purchase AND the state is terminal: an unresolved purchase, or a toast
 * for a different purchase, never touches it.
 */
export function forgetPresentedSubmittedPurchase(userId: string, attemptId: string, state: string) {
  if (!terminalStates.includes(state)) return;
  for (const scope of ['CART_CHECKOUT', 'BUY_NOW'] as const) if (readSubmittedPurchase(userId, scope) === attemptId) forgetSubmittedPurchase(userId, scope);
}
