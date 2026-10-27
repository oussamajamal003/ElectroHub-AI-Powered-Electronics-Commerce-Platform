import { apiClient } from '@/lib/api';

const lastRecoveryRequest = new Map<string, number>();
/**
 * The purchases list GET is read-only (Task 03.8). While unresolved purchases are visible, ask the backend (an explicit, owner-scoped POST)
 * to reconcile any that the durable runner left overdue. At most once per 30 s per account; the backend only claims due work under its lease.
 */
export function requestOverdueRecovery(userId: string, now = Date.now()) {
  const last = lastRecoveryRequest.get(userId);
  if (!userId || (last !== undefined && now - last < 30_000)) return;
  lastRecoveryRequest.set(userId, now);
  void apiClient('/api/checkout/payment-attempts/recover-overdue', { method: 'POST', data: {} }).catch(() => undefined);
}
