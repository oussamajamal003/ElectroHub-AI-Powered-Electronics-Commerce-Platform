import { ApiError, apiClient } from '@/lib/api';

export class ConfirmationSignalUncertain extends Error {
  constructor() { super('Payment confirmation could not be safely started.'); this.name = 'ConfirmationSignalUncertain'; }
}
/**
 * PR #51: the server's last stock read before the card could be authorized found the item sold out (standard 409). Stripe confirmation must
 * not start; the server has already cancelled the unconfirmed payment, and the purchase's own status reports the sold-out outcome.
 */
export class ConfirmationStockRefused extends Error {
  constructor(message: string, readonly code: string) { super(message); this.name = 'ConfirmationStockRefused'; }
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
    if (error instanceof ApiError && error.status === 409 && (error.code === 'CART_STOCK_CONFLICT' || error.code === 'PRODUCT_UNAVAILABLE')) {
      throw new ConfirmationStockRefused(error.message, error.code);
    }
    if (error instanceof ApiError && error.status >= 400 && error.status < 500) throw new ConfirmationSignalUncertain();
  }
  try {
    const status = await apiClient<{ data: { confirmationStartedAt?: string | null } }>(`${endpoint}/${attemptId}`, { signal: AbortSignal.timeout(SIGNAL_TIMEOUT_MS) });
    if (status.data.confirmationStartedAt) return;
    await post(); return;
  } catch { throw new ConfirmationSignalUncertain(); }
}
