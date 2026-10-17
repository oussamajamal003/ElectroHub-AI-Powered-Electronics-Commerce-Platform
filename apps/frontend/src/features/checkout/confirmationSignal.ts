import { ApiError, apiClient } from '@/lib/api';

export class ConfirmationSignalUncertain extends Error {
  constructor() { super('Payment confirmation could not be safely started.'); this.name = 'ConfirmationSignalUncertain'; }
}
const SIGNAL_TIMEOUT_MS = 10_000;
const endpoint = '/api/checkout/payment-attempts';

/**
 * Persists "the client is about to confirm with Stripe" on the owned attempt BEFORE Stripe.js is asked to confirm. The call is idempotent, so a
 * lost or timed-out response is resolved by reading the server's truth (and retrying once), never by guessing. Resolves only when the backend
 * has durably recorded the signal; otherwise throws and Stripe confirmation must not be initiated. A recorded signal is intent, not proof
 * that Stripe received a confirmation: the authoritative outcome still comes from reconciliation.
 */
export async function announceConfirmation(attemptId: string): Promise<void> {
  const post = () => apiClient(`${endpoint}/${attemptId}/confirmation-started`, { method: 'POST', data: {}, signal: AbortSignal.timeout(SIGNAL_TIMEOUT_MS) });
  try { await post(); return; } catch (error) {
    if (error instanceof ApiError && error.status >= 400 && error.status < 500) throw new ConfirmationSignalUncertain();
  }
  try {
    const status = await apiClient<{ data: { confirmationStartedAt?: string | null } }>(`${endpoint}/${attemptId}`, { signal: AbortSignal.timeout(SIGNAL_TIMEOUT_MS) });
    if (status.data.confirmationStartedAt) return;
    await post(); return;
  } catch { throw new ConfirmationSignalUncertain(); }
}
