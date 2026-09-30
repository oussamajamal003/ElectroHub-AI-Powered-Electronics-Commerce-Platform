import { Skeleton } from '../Skeleton';
import styles from './ProductCard.module.scss';

export function ProductCardSkeleton() {
  return <div className={styles.card} data-testid="product-skeleton" aria-hidden="true">
    <div className={styles.imageArea} data-testid="product-skeleton-image"><Skeleton width="100%" height="100%" /></div>
    <div className={`${styles.content} ${styles.skeletonContent}`}>
      <Skeleton width="38%" height={16} />
      <Skeleton width="85%" height={24} />
      <Skeleton width="66%" height={18} />
      <Skeleton width="48%" height={26} />
      <Skeleton width="32%" height={18} />
    </div>
  </div>;
}
