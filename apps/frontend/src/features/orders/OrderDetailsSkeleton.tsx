import { Skeleton } from '@/components/ui/Skeleton';
import shared from './Orders.module.scss';
import styles from './OrderDetailsPage.module.scss';

export function DetailsSkeleton({ label = 'Loading order details' }: { label?: string }) {
  return <div className={styles.layout} role="status" aria-label={label}>
    <span className={shared.visuallyHidden}>{label}…</span>
    <div className={styles.main} aria-hidden="true">
      <div className={styles.card}><Skeleton width="7rem" height={22} /><div className={styles.item}><Skeleton width={80} height={80} /><div><Skeleton width="60%" height={18} /><Skeleton width="4rem" height={14} /></div><Skeleton width="5rem" height={18} /></div></div>
      <div className={styles.card}><Skeleton width="11rem" height={22} /><Skeleton width="50%" height={16} /><Skeleton width="40%" height={16} /></div>
    </div>
    <div className={styles.aside} aria-hidden="true"><div className={styles.card}><Skeleton width="9rem" height={22} /><Skeleton width="100%" height={16} /><Skeleton width="100%" height={16} /><Skeleton width="100%" height={22} /></div></div>
  </div>;
}
