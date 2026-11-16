import { loadStripe, type Stripe } from '@stripe/stripe-js';
import { markPaymentTiming } from './paymentTiming';

let stripePromise: Promise<Stripe | null> | null = null;
export function stripeClient() {
  const key = import.meta.env.VITE_STRIPE_PUBLISHABLE_KEY;
  if (typeof key !== 'string' || !key.startsWith('pk_test_')) return null;
  if (!stripePromise) {
    markPaymentTiming('stripe-client-init-start');
    stripePromise = loadStripe(key).then(value => {
      markPaymentTiming(value ? 'stripe-client-init-ready' : 'stripe-client-init-error');
      if (!value) stripePromise = null;
      return value;
    }, () => { markPaymentTiming('stripe-client-init-error'); stripePromise = null; return null; });
  }
  return stripePromise;
}
export function prefetchStripe(): Promise<Stripe | null> | null {
  return stripeClient();
}
// Fetch the SDK before React renders Checkout; all sessions share this promise.
void prefetchStripe();
