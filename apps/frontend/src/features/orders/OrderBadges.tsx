import { OrderStatus } from '@/components/ui/OrderStatus';
import { PaymentStatus } from '@/components/ui/PaymentStatus';
import { fulfillmentBadge, paymentBadge } from './presentation';
import styles from './Orders.module.scss';

/** Fulfillment and payment are independent facts; both are always shown side by side. */
export function OrderBadges({ status, paymentState, size = 'medium' }: { status: string; paymentState: string; size?: 'small' | 'medium' }) {
  return <div className={styles.badges}>
    <OrderStatus status={fulfillmentBadge(status)} size={size} className={styles.badge} />
    <PaymentStatus status={paymentBadge(paymentState)} size={size} className={styles.badge} />
  </div>;
}
