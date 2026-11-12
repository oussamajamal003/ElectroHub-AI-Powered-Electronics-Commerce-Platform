import { ApiError, isAbortError } from '@/lib/api';
import { toast } from './toastStore';

export type ErrorKind = 'validation' | 'unauthorized' | 'forbidden' | 'not-found' | 'conflict' | 'rate-limited' | 'unavailable' | 'offline' | 'timeout' | 'unexpected';

export interface ErrorFeedback { kind: ErrorKind; title: string; description?: string; retryable: boolean }

/**
 * Turn any thrown value into safe, actionable feedback. `ApiError` messages are already sanitized by the API client (server internals,
 * SQL and stack traces never reach them); anything else collapses to a fixed sentence, never `error.message`, so an unexpected
 * exception cannot leak into the UI. A 403 is a permission problem, never "offline"; a 409 asks for a refresh, never a blind retry.
 */
export function describeError(error: unknown, action: string, options: { preferServerMessage?: boolean } = {}): ErrorFeedback {
  if (error instanceof ApiError) {
    const { status } = error;
    // Form submissions (wrong current password, taken email, invalid field) already come back with a meaningful, sanitized message;
    // a generic "session expired" would mislead. Throttling and server faults keep their dedicated wording below.
    if (options.preferServerMessage && status >= 400 && status < 500 && status !== 429 && status !== 408 && error.message) {
      return { kind: 'validation', title: `Couldn't ${action}`, description: error.message, retryable: false };
    }
    if (status === 401) return { kind: 'unauthorized', title: 'Your session has expired', description: 'Please sign in again to continue.', retryable: false };
    if (status === 403) return { kind: 'forbidden', title: `You don't have permission to ${action}`, retryable: false };
    if (status === 404) return { kind: 'not-found', title: `We couldn't find that to ${action}`, description: 'It may have been removed. Refresh and try again.', retryable: false };
    if (status === 409 || status === 412) return { kind: 'conflict', title: `Couldn't ${action}: it changed in the meantime`, description: 'Refresh to see the latest version, then try again.', retryable: false };
    if (status === 408 || status === 504) return { kind: 'timeout', title: `Couldn't ${action}: the request timed out`, description: 'Please try again.', retryable: true };
    if (status === 429) return { kind: 'rate-limited', title: 'Too many attempts', description: 'Please wait a moment and try again.', retryable: true };
    if (status === 503 || status === 502 || status >= 500) return { kind: 'unavailable', title: `Couldn't ${action}: service temporarily unavailable`, description: 'Please try again shortly.', retryable: true };
    return { kind: 'validation', title: `Couldn't ${action}`, description: error.message, retryable: false };
  }
  if (isAbortError(error)) return { kind: 'timeout', title: `Couldn't ${action}: the request was interrupted`, description: 'Please try again.', retryable: true };
  if (error instanceof TypeError || (typeof navigator !== 'undefined' && navigator.onLine === false)) {
    return { kind: 'offline', title: `Couldn't ${action}: you appear to be offline`, description: 'Check your connection and try again.', retryable: true };
  }
  return { kind: 'unexpected', title: `Couldn't ${action}`, description: 'Something went wrong. Please try again.', retryable: true };
}

/**
 * Raise error feedback for a failed action: warning tone for conditions the user can resolve (permission, conflict, rate limit,
 * offline), error tone otherwise. Offers Retry only when the failure is transient and a retry callback exists.
 */
export function toastError(error: unknown, action: string, options: { retry?: () => void; id?: string; announce?: boolean; preferServerMessage?: boolean } = {}): string {
  const feedback = describeError(error, action, { preferServerMessage: options.preferServerMessage });
  const tone = feedback.kind === 'validation' || feedback.kind === 'unexpected' || feedback.kind === 'unavailable' ? toast.error : toast.warning;
  return tone(feedback.title, {
    description: feedback.description,
    id: options.id,
    announce: options.announce,
    action: options.retry && feedback.retryable ? { label: 'Retry', altText: `Retry: ${action}`, onClick: options.retry } : undefined,
  });
}
