import { Skeleton } from '@/components/ui/Skeleton';
import styles from './Delivery.module.scss';

export function TrackingSkeleton({ label = 'Loading delivery tracking' }: { label?: string }) {
  return <div className={styles.tracking} role="status" aria-label={label}>
    <span className={styles.visuallyHidden}>{label}…</span>
    <div className={styles.grid} aria-hidden="true">
      <div className={`${styles.areaOverview} ${styles.overview}`}><Skeleton width="100%" height={168} /><div className={styles.skeletonStack}>
        <Skeleton width="100%" height={132} /><Skeleton width="100%" height={110} /></div><Skeleton width="70%" height={18} /></div>
      <div className={`${styles.areaStep} ${styles.card}`}><Skeleton width="11rem" height={22} /><Skeleton width="100%" height={72} /></div>
      <div className={`${styles.areaMap} ${styles.card}`}><Skeleton width="10rem" height={22} /><Skeleton width="80%" height={16} /></div>
      <div className={`${styles.areaTimeline} ${styles.card}`}><Skeleton width="10rem" height={22} /><Skeleton width="100%" height={48} /><Skeleton width="100%" height={48} /></div>
    </div>
  </div>;
}
