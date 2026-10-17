/* eslint-disable react-refresh/only-export-components */
import { createContext, useContext, useMemo, useState, type ReactNode } from 'react';
export type CriticalPaymentState = 'IDLE' | 'CONFIRMING_PAYMENT' | 'AUTHORIZED' | 'COMMITTING_ORDER' | 'CAPTURE_PENDING';
interface PaymentLockContextValue { paymentState: CriticalPaymentState; isLocked: boolean; setPaymentState(state: CriticalPaymentState): void }
const PaymentLockContext = createContext<PaymentLockContextValue>({ paymentState: 'IDLE', isLocked: false, setPaymentState: () => {} });
/** Durable server submission owns recovery. Navigation never cancels or locks that work. */
export function PaymentLockProvider({ children }: { children: ReactNode }) {
  const [paymentState, setPaymentState] = useState<CriticalPaymentState>('IDLE');
  const value = useMemo(() => ({ paymentState, isLocked: false, setPaymentState }), [paymentState]);
  return <PaymentLockContext.Provider value={value}>{children}</PaymentLockContext.Provider>;
}
export function usePaymentLock() { return useContext(PaymentLockContext); }
