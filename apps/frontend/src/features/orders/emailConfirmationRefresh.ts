import type { EmailConfirmationSummary } from '@/features/checkout/types';
import { emailNoticeLive } from './emailNoticeWindow';

/** Task 03.8: states in which the worker may still advance the initial confirmation emails. */
const PENDING_EMAIL_STATES = new Set(['QUEUED', 'DELAYED']);
export const EMAIL_REFRESH_INTERVAL_MS = 15_000;
/** Upper bound per page view; in practice the 60-second notice window ends polling first. */
export const EMAIL_REFRESH_MAX_POLLS = 40;
const MAX_FAILURE_BACKOFFS = 3;

interface RefreshableQuery {
  state: { data?: { data?: { createdAt?: string; emailConfirmation?: EmailConfirmationSummary | null } }; dataUpdateCount: number; fetchFailureCount: number };
}

/**
 * React Query `refetchInterval` factory for owner-scoped order reads: a read-only GET of the projection (never sends or enqueues anything),
 * only while the tab is visible, the emails are still pending AND the transient notice is still inside its window, bounded in count, with
 * exponential backoff after failures. Returns false to stop.
 */
export function emailConfirmationRefetchInterval(ownerId: string, orderReference: string) {
  return (query: RefreshableQuery): number | false => {
    const data = query.state.data?.data;
    const state = data?.emailConfirmation?.state;
    if (!state || !PENDING_EMAIL_STATES.has(state)) return false;
    if (!emailNoticeLive(ownerId, orderReference, data?.createdAt)) return false;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return false;
    if (query.state.dataUpdateCount >= EMAIL_REFRESH_MAX_POLLS) return false;
    const failures = query.state.fetchFailureCount;
    if (failures > MAX_FAILURE_BACKOFFS) return false;
    return EMAIL_REFRESH_INTERVAL_MS * 2 ** failures;
  };
}
