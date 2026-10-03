import { Skeleton } from '../Skeleton';
import styles from './ProductCard.module.scss';

export function ProductCardSkeleton() {
  return <div className={styles.card} data-testid="product-skeleton" aria-hidden="true">
    <div className={styles.imageArea} data-testid="product-skeleton-image"><Skeleton width="100%" height="100%" /></div>
    <div className={`${styles.content} ${styles.skeletonContent}`}>
      <Skeleton data-skeleton-part="category" width="34%" height={14} />
      <Skeleton data-skeleton-part="title" width="82%" height={24} />
      <Skeleton data-skeleton-part="rating" width="72%" height={16} />
      <Skeleton data-skeleton-part="description" width="90%" height={36} />
      <Skeleton data-skeleton-part="price" width="52%" height={26} />
      <Skeleton data-skeleton-part="action" width="100%" height={40} />
    </div>
  </div>;
}
