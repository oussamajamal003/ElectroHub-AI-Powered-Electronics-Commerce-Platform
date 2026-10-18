import { CheckCircle2, CircleDashed, CircleHelp, Clock, RefreshCw, XCircle } from 'lucide-react';
import styles from './PaymentStatus.module.scss';

/** `unprocessed` = legacy Order without a Payment record; never shown as an active charge or as Paid. */
export type PaymentStatusType = 'pending' | 'paid' | 'failed' | 'refunded' | 'unprocessed' | 'unknown';
export interface PaymentStatusProps {
  status: PaymentStatusType;
  size?: 'small' | 'medium';
  className?: string;
}
const statusConfig: Record<PaymentStatusType, { label: string; icon: React.ElementType; theme: string }> = {
  pending: { label: 'Pending', icon: Clock, theme: 'warning' },
  paid: { label: 'Paid', icon: CheckCircle2, theme: 'success' },
  failed: { label: 'Failed', icon: XCircle, theme: 'error' },
  refunded: { label: 'Refunded', icon: RefreshCw, theme: 'info' },
  unprocessed: { label: 'Not processed', icon: CircleDashed, theme: 'neutral' },
  unknown: { label: 'Status unavailable', icon: CircleHelp, theme: 'neutral' },
};
/** Not a live region: many badges on one page must not flood assistive technology. The context prefix is read with the label. */
export function PaymentStatus({
  status,
  size = 'medium',
  className = '',
}: PaymentStatusProps) {
  const config = statusConfig[status] ?? statusConfig.unknown;
  const Icon = config.icon;
  return (
    <span className={`${styles.badge} ${styles[size]} ${styles[config.theme]} ${className}`} data-status={status}>
      <Icon className={styles.icon} aria-hidden="true" />
      <span className={styles.visuallyHidden}>Payment status: </span>
      <span className={styles.label}>{config.label}</span>
    </span>
  );
}
