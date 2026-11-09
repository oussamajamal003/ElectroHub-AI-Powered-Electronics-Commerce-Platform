import type { AdministratorSummary } from './api';

export type TwoStepTone = 'success' | 'warning' | 'info' | 'error' | 'neutral';
export interface TwoStepStatus {
  tone: TwoStepTone;
  label: string;
  /** Short qualifier shown under the label (expiry or remaining setup window). Never contains a secret. */
  detail?: string;
  /** What the Owner may do next for this account. */
  action: 'activate' | 'resend' | 'none';
  canRevoke: boolean;
}

/** Minutes left until `iso`, rounded up; never below 1 while the instant is in the future. */
const minutesLeft = (iso: string, now: Date) => Math.max(1, Math.ceil((new Date(iso).getTime() - now.getTime()) / 60_000));

/** Lifecycle of two-step verification for one administrator row, derived only from server-provided state. */
export function twoStepStatus(row: AdministratorSummary, now = new Date()): TwoStepStatus {
  if (row.mfaEnrolled) return { tone: 'success', label: 'Enabled', action: 'none', canRevoke: false };
  if (!row.isActive) return { tone: 'neutral', label: 'Inactive', action: 'none', canRevoke: false };
  const activation = row.mfaActivation;
  // Seed mailboxes receive no email: never offer (or resend) an emailed link; point to operator setup and keep Revoke for a stale link.
  if (row.seedAccount && !(row.enrollmentAuthorizedUntil && new Date(row.enrollmentAuthorizedUntil) > now)) {
    if (activation?.purpose === 'SEED_PROVISIONING' && activation.status === 'PENDING' && new Date(activation.expiresAt) > now) {
      return { tone: 'info', label: 'Operator setup pending', detail: `Setup link expires in ${minutesLeft(activation.expiresAt, now)} min`, action: 'none', canRevoke: false };
    }
    if (activation && activation.purpose !== 'SEED_PROVISIONING') return { tone: 'warning', label: 'Operator setup required', action: 'none', canRevoke: true,
      detail: 'An emailed link cannot reach this seed mailbox. Revoke it and ask an operator for a setup link.' };
    return { tone: 'info', label: 'Operator setup required', action: 'none', canRevoke: false,
      detail: row.seedAccount.recorded ? 'Ask an operator for a one-time setup link.' : 'An operator must record this seed account, then issue a setup link.' };
  }
  if (activation) {
    const expired = activation.status === 'EXPIRED' || new Date(activation.expiresAt) <= now;
    if (expired) return { tone: 'warning', label: 'Link expired', action: 'resend', canRevoke: true };
    if (activation.deliveryStatus === 'FAILED') return { tone: 'error', label: 'Email delivery failed', action: 'resend', canRevoke: true };
    return { tone: 'info', label: 'Activation pending', detail: `Link expires in ${minutesLeft(activation.expiresAt, now)} min`, action: 'resend', canRevoke: true };
  }
  if (row.enrollmentAuthorizedUntil && new Date(row.enrollmentAuthorizedUntil) > now) {
    return { tone: 'info', label: 'Setup pending', detail: `${minutesLeft(row.enrollmentAuthorizedUntil, now)} min left`, action: 'none', canRevoke: false };
  }
  return { tone: 'warning', label: 'Not set up', action: 'activate', canRevoke: false };
}
