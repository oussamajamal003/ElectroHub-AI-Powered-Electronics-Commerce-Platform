import { CheckCircle2, Clock, Truck, XCircle } from 'lucide-react';
import styles from './OrderStatus.module.scss';

export type OrderStatusType = 'processing' | 'shipped' | 'delivered' | 'cancelled';

export interface OrderStatusProps {
  status: OrderStatusType;
  size?: 'small' | 'medium';
  className?: string;
}

const statusConfig: Record<OrderStatusType, { label: string; icon: React.ElementType; theme: string }> = {
  processing: { label: 'Processing', icon: Clock, theme: 'warning' },
  shipped: { label: 'Shipped', icon: Truck, theme: 'info' },
  delivered: { label: 'Delivered', icon: CheckCircle2, theme: 'success' },
  cancelled: { label: 'Cancelled', icon: XCircle, theme: 'error' },
};

export function OrderStatus({
  status,
  size = 'medium',
  className = '',
}: OrderStatusProps) {
  const config = statusConfig[status];
  const Icon = config.icon;

  return (
    <div 
      className={`${styles.badge} ${styles[size]} ${styles[config.theme]} ${className}`}
      role="status"
      aria-label={`Order status: ${config.label}`}
    >
      <Icon className={styles.icon} aria-hidden="true" />
      <span className={styles.label}>{config.label}</span>
    </div>
  );
}
