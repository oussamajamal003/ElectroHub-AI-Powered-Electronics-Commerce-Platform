import { ApiError, apiClient } from '@/lib/api';
import type { OrderRequest, PaymentSetup } from './types';

export type SavedRetrySetup = PaymentSetup & { request: OrderRequest; items: { name: string; quantity: number }[]; delivery: { label: string; estimate: string; price: string } | null };
// Approved bound: retry eligibility aborts after 25 seconds (Task 03.6 lifecycle redesign).
export const RESUME_DEADLINE_MS = 25_000;
/**
 * timeout / transport: the eligibility check itself did not finish; nothing is known about the payment.
 * ineligible: the server authoritatively refused retry for this owned attempt.
 * identity: the response did not match the requested attempt and is discarded.
 */
export type ResumeFailureKind = 'timeout' | 'transport' | 'ineligible' | 'identity';
export class PaymentResumeError extends Error {
  constructor(public readonly kind: ResumeFailureKind, public readonly code?: string) { super(kind); this.name = 'PaymentResumeError'; }
}

const inFlight = new Map<string, Promise<SavedRetrySetup>>();

/**
 * One eligibility request per customer and attempt at a time. A remount (React StrictMode,
 * Back/Forward, fast re-entry) joins the request already in flight instead of aborting it
 * and issuing a second POST the server would still execute. Nothing is cached after it
 * settles: the client secret stays only with the caller that renders secure entry.
 */
export function resumeSavedPayment(ownerId: string, attemptId: string): Promise<SavedRetrySetup> {
  const key = `${ownerId}:${attemptId}`;
  const existing = inFlight.get(key);
  if (existing) return existing;
  const controller = new AbortController();
  let timedOut = false;
  const deadline = setTimeout(() => { timedOut = true; controller.abort(); }, RESUME_DEADLINE_MS);
  const request = apiClient<{ data: SavedRetrySetup }>(`/api/checkout/payment-attempts/${attemptId}/resume`,
    { method: 'POST', data: {}, signal: controller.signal })
    .then(result => {
      if (result.data.attemptId !== attemptId || !result.data.clientSecret) throw new PaymentResumeError('identity');
      return result.data;
    }, (error: unknown) => {
      if (timedOut) throw new PaymentResumeError('timeout');
      // 4xx is the server's decision about this attempt; everything else never reached one.
      const refused = error instanceof ApiError && error.status >= 400 && error.status < 500 &&
        error.status !== 401 && error.status !== 408 && error.status !== 429;
      throw new PaymentResumeError(refused ? 'ineligible' : 'transport', error instanceof ApiError ? error.code : undefined);
    })
    .finally(() => { clearTimeout(deadline); inFlight.delete(key); });
  inFlight.set(key, request);
  return request;
}
