/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
export type CriticalPaymentState = 'IDLE' | 'CONFIRMING_PAYMENT' | 'AUTHORIZED' | 'COMMITTING_ORDER' | 'CAPTURE_PENDING';
interface PaymentLockContextValue { paymentState: CriticalPaymentState; isLocked: boolean; setPaymentState(state: CriticalPaymentState): void }
const PaymentLockContext = createContext<PaymentLockContextValue>({ paymentState: 'IDLE', isLocked: false, setPaymentState: () => {} });
/** Upper bound for the browser-owned window (slow DEV /submit ~10 s + Stripe confirm); the lock can never outlive it. */
export const BROWSER_CONFIRMATION_LOCK_MS = 90_000;

/**
 * Durable server submission owns recovery, EXCEPT for one window: after Place Order and until Stripe.js has been asked to confirm,
 * only this browser tab can confirm the card. Leaving then guarantees an unconfirmed purchase stuck in Processing (reproduced in DEV),
 * so site navigation is locked and closing/reloading warns ONLY while `CONFIRMING_PAYMENT`. Every later state unlocks immediately.
 */
export function PaymentLockProvider({ children }: { children: ReactNode }) {
  const [paymentState, setPaymentState] = useState<CriticalPaymentState>('IDLE');
  const isLocked = paymentState === 'CONFIRMING_PAYMENT';
  useEffect(() => {
    if (!isLocked) return;
    const warn = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };
    window.addEventListener('beforeunload', warn);
    const release = window.setTimeout(() => setPaymentState(current => current === 'CONFIRMING_PAYMENT' ? 'IDLE' : current), BROWSER_CONFIRMATION_LOCK_MS);
    return () => { window.removeEventListener('beforeunload', warn); window.clearTimeout(release); };
  }, [isLocked]);
  const value = useMemo(() => ({ paymentState, isLocked, setPaymentState }), [paymentState, isLocked]);
  return <PaymentLockContext.Provider value={value}>{children}</PaymentLockContext.Provider>;
}
export function usePaymentLock() { return useContext(PaymentLockContext); }
