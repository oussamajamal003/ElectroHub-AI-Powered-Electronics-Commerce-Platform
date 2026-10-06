import type { CheckoutDraft, CheckoutStep, Shipping } from './types';
export const steps: CheckoutStep[] = ['shipping', 'delivery', 'payment', 'review'];
export const emptyShipping: Shipping = { recipient: '', line1: '', line2: '', city: '', state: '', postalCode: '', country: '', phone: '' };
export const newDraft = (): CheckoutDraft => ({ shipping: { ...emptyShipping }, deliveryMethod: 'STANDARD', shippingComplete: false,
  deliveryComplete: false, paymentComplete: false, attempt: null });
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
export const draftKey = (userId: string) => `electrohub:checkout:v1:${userId}`;
export function readDraft(userId: string): CheckoutDraft {
  try {
    const saved = JSON.parse(sessionStorage.getItem(draftKey(userId)) ?? 'null') as unknown;
    if (!saved || typeof saved !== 'object') return newDraft();
    const data = saved as Record<string, unknown>;
    if (data.version !== 1 || data.userId !== userId || !data.draft || typeof data.draft !== 'object') return newDraft();
    const draft = data.draft as CheckoutDraft;
    if (!draft.shipping || Object.keys(emptyShipping).some(key => typeof draft.shipping[key as keyof Shipping] !== 'string') ||
      !['STANDARD', 'EXPRESS', 'OVERNIGHT'].includes(draft.deliveryMethod) ||
      [draft.shippingComplete, draft.deliveryComplete, draft.paymentComplete].some(value => typeof value !== 'boolean')) return newDraft();
    if (draft.attempt) {
      const a = draft.attempt;
      if (!/^[0-9a-f-]{36}$/i.test(a.key) || !a.request || !['pending', 'unknown'].includes(a.status) ||
        !/^[a-f0-9]{64}$/.test(a.request.expectedRevision) || a.request.paymentMethod !== 'CARD' ||
        !['STANDARD', 'EXPRESS', 'OVERNIGHT'].includes(a.request.deliveryMethod) || !a.request.shipping ||
        Object.keys(emptyShipping).some(key => typeof a.request.shipping[key as keyof Shipping] !== 'string') ||
        Object.keys(shippingErrors(a.request.shipping)).length) return newDraft();
    }
    // Whitelist fields; never restore arbitrary/raw payment or Product data.
    return { shipping: Object.fromEntries(Object.keys(emptyShipping).map(key => [key, draft.shipping[key as keyof Shipping]])) as unknown as Shipping,
      deliveryMethod: draft.deliveryMethod, shippingComplete: draft.shippingComplete, deliveryComplete: draft.deliveryComplete,
      paymentComplete: draft.paymentComplete, attempt: draft.attempt ? { key: draft.attempt.key, status: 'unknown', request: {
        shipping: Object.fromEntries(Object.keys(emptyShipping).map(key => [key, draft.attempt?.request.shipping[key as keyof Shipping]])) as unknown as Shipping,
        deliveryMethod: draft.attempt.request.deliveryMethod, paymentMethod: 'CARD', expectedRevision: draft.attempt.request.expectedRevision } } : null };
  } catch { return newDraft(); }
}
export function saveDraft(userId: string, draft: CheckoutDraft): boolean {
  try { sessionStorage.setItem(draftKey(userId), JSON.stringify({ version: 1, userId, draft })); return true; } catch { return false; }
}
export function clearDraft(userId: string) { try { sessionStorage.removeItem(draftKey(userId)); } catch { /* Storage may be unavailable. */ } }
