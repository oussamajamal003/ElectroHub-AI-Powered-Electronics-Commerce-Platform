import { CheckCircle2, CircleHelp, Clock, Hourglass, PackageCheck, PackageOpen, Truck, XCircle } from 'lucide-react';
import styles from './OrderStatus.module.scss';

/**
 * Canonical fulfillment states (Task 03.7) plus the legacy prototype keys kept for compatibility.
 * `awaiting_capture` is the internal pre-fulfillment state, not a normal lifecycle step.
 */
export type OrderStatusType = 'confirmed' | 'preparing' | 'out_for_delivery' | 'delivered' | 'cancelled' | 'awaiting_capture' | 'unknown'
  | 'processing' | 'shipped';
export interface OrderStatusProps {
  status: OrderStatusType;
  size?: 'small' | 'medium';
  className?: string;
}
const statusConfig: Record<OrderStatusType, { label: string; icon: React.ElementType; theme: string }> = {
  confirmed: { label: 'Confirmed', icon: PackageCheck, theme: 'info' },
  preparing: { label: 'Preparing', icon: PackageOpen, theme: 'warning' },
  out_for_delivery: { label: 'Out for Delivery', icon: Truck, theme: 'info' },
  delivered: { label: 'Delivered', icon: CheckCircle2, theme: 'success' },
  cancelled: { label: 'Cancelled', icon: XCircle, theme: 'error' },
  awaiting_capture: { label: 'Finalizing your order', icon: Hourglass, theme: 'neutral' },
  unknown: { label: 'Status unavailable', icon: CircleHelp, theme: 'neutral' },
  processing: { label: 'Processing', icon: Clock, theme: 'warning' },
  shipped: { label: 'Shipped', icon: Truck, theme: 'info' },
};
/** Not a live region: many badges on one page must not flood assistive technology. The context prefix is read with the label. */
export function OrderStatus({
  status,
  size = 'medium',
  className = '',
}: OrderStatusProps) {
  const config = statusConfig[status] ?? statusConfig.unknown;
  const Icon = config.icon;
  return (
    <span className={`${styles.badge} ${styles[size]} ${styles[config.theme]} ${className}`} data-status={status}>
      <Icon className={styles.icon} aria-hidden="true" />
      <span className={styles.visuallyHidden}>Order status: </span>
      <span className={styles.label}>{config.label}</span>
    </span>
  );
}
