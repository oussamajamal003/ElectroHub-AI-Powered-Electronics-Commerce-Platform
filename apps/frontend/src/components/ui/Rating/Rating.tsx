import styles from './Rating.module.scss';
import { Star, StarHalf } from 'lucide-react';

export interface RatingProps {
  value: number;
  reviewCount?: number;
  className?: string;
  maxStars?: number;
}

export function Rating({
  value,
  reviewCount,
  className = '',
  maxStars = 5,
}: RatingProps) {
  const safeValue = Math.max(0, Math.min(value, maxStars));
  const hasRating = safeValue > 0;
  
  // Calculate full, half, and empty stars
  const fullStars = Math.floor(safeValue);
  const hasHalfStar = safeValue % 1 >= 0.5;
  const emptyStars = maxStars - fullStars - (hasHalfStar ? 1 : 0);

  // Generate accessible label
  const label = hasRating
    ? `Rated ${safeValue.toFixed(1)} out of ${maxStars}${reviewCount !== undefined ? ` based on ${reviewCount} reviews` : ''}.`
    : 'No rating';

  return (
    <div 
      className={`${styles.ratingContainer} ${className}`}
      role="img"
      aria-label={label}
    >
      <div className={styles.stars} aria-hidden="true">
        {hasRating ? (
          <>
            {Array.from({ length: fullStars }).map((_, i) => (
              <Star key={`full-${i}`} className={styles.starFilled} fill="currentColor" />
            ))}
            {hasHalfStar && <StarHalf className={styles.starHalf} fill="currentColor" />}
            {Array.from({ length: emptyStars }).map((_, i) => (
              <Star key={`empty-${i}`} className={styles.starEmpty} />
            ))}
          </>
        ) : (
          Array.from({ length: maxStars }).map((_, i) => (
            <Star key={`unrated-${i}`} className={styles.starEmpty} />
          ))
        )}
      </div>
      
      <div className={styles.label} aria-hidden="true">
        {hasRating ? (
          <>
            <span className={styles.value}>{safeValue.toFixed(1)}</span>
            {reviewCount !== undefined && (
              <span className={styles.reviewCount}>({reviewCount} reviews)</span>
            )}
          </>
        ) : (
          <span className={styles.noRating}>No rating</span>
        )}
      </div>
    </div>
  );
}
