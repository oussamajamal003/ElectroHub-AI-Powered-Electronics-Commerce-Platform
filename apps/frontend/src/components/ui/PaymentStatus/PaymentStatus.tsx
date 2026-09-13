import { CheckCircle2, Clock, RefreshCw, XCircle } from 'lucide-react';
import styles from './PaymentStatus.module.scss';

export type PaymentStatusType = 'pending' | 'paid' | 'failed' | 'refunded';

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
};

export function PaymentStatus({
  status,
  size = 'medium',
  className = '',
}: PaymentStatusProps) {
  const config = statusConfig[status];
  const Icon = config.icon;

  return (
    <div 
      className={`${styles.badge} ${styles[size]} ${styles[config.theme]} ${className}`}
      role="status"
      aria-label={`Payment status: ${config.label}`}
    >
      <Icon className={styles.icon} aria-hidden="true" />
      <span className={styles.label}>{config.label}</span>
    </div>
  );
}
