import type { Review } from '@/features/products/types';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import styles from './ProductReviews.module.scss';

export interface ProductReviewsProps {
  reviews: Review[];
  loading?: boolean;
  error?: boolean;
  onRetry?: () => void;
  ownReviewId?: string | null;
}

export function ProductReviews({ reviews, loading = false, error = false, onRetry, ownReviewId }: ProductReviewsProps) {
  if (loading) return <div role="status" aria-label="Loading reviews" className={styles.list}><div aria-hidden="true" className={styles.review}><Skeleton width="30%" height={20} /><Skeleton width="18%" height={20} /><Skeleton width="85%" height={48} /></div></div>;
  if (error) return <div className={styles.empty} role="alert"><p>Reviews are unavailable right now.</p>{onRetry && <Button type="button" variant="outline" onClick={onRetry}>Retry</Button>}</div>;
  if (reviews.length === 0) return <p className={`${styles.empty} ${styles.emptyState}`}>No reviews yet. Be the first to share your experience.</p>;
  return <div className={styles.list}>{reviews.map(review => <article key={review.id} className={styles.review}>
    <header className={styles.reviewHeader}><strong>{review.id === ownReviewId ? 'Your review' : review.author.displayName}</strong>
      <span aria-label={`${review.rating} out of 5 stars`}>★ {review.rating}/5</span>
      <time dateTime={review.createdAt}>{new Date(review.createdAt).toLocaleDateString()}</time></header>
    <p>{review.body}</p>
  </article>)}</div>;
}
