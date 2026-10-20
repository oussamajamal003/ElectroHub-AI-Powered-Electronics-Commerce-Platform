import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/features/auth/context/AuthContext';
import { ApiError, apiClient } from '@/lib/api';

/**
 * A backend may be deliberately payment-write-disabled (payment isolation boundary: shared DEV under unreviewed development). That is an
 * environment restriction, never a card decline, a failed payment or a completed action. The UI uses this to stop offering payment writes
 * (checkout setup, Place Order, Remove, Try Again) that would only return 503, while reads stay available. The copy states only what is known:
 * the refused action was not carried out. It never claims anything about charges, which this refusal cannot know.
 */
export const PAYMENTS_UNAVAILABLE_MESSAGE =
  'Payment actions are switched off on this server, so this change wasn’t made. Please try again later.';

/** Environment restrictions, not payment outcomes: payment writes disabled (isolation), or card payments not configured on this backend. */
export const isPaymentsDisabledError = (error: unknown) =>
  error instanceof ApiError && error.status === 503 && ['PAYMENT_MUTATIONS_DISABLED', 'PAYMENT_CONFIGURATION_UNAVAILABLE'].includes(error.code ?? '');

/** `false` only when the backend explicitly reports payment writes disabled; `undefined` while unknown (never assumed disabled). */
export function usePaymentCapability(needed = true): boolean | undefined {
  const { user, isSessionVerified } = useAuth();
  const query = useQuery({
    queryKey: ['payment-capability', user?.id ?? ''],
    queryFn: async ({ signal }) => (await apiClient<{ data: { paymentsEnabled: boolean } }>('/api/checkout/payment-capability',
      { signal: AbortSignal.any([signal, AbortSignal.timeout(10_000)]) })).data,
    enabled: needed && Boolean(user && isSessionVerified), staleTime: 60_000, retry: 1,
  });
  if (!user || !isSessionVerified || query.isError) return undefined;
  return typeof query.data?.paymentsEnabled === 'boolean' ? query.data.paymentsEnabled : undefined;
}
