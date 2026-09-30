import { Heart, Star } from 'lucide-react';
import { ProductImage } from '../ProductImage';
import styles from './ProductCard.module.scss';

export interface ProductCardProps {
  id: string | number;
  title: string;
  category?: string;
  description?: string;
  price: number;
  rating?: number | null;
  reviewCount?: number;
  compareAtPrice?: number;
  discountPercent?: number;
  availability?: 'AVAILABLE' | 'UNAVAILABLE';
  href?: string;
  onNavigate?: (href: string) => void;
  imageUrl: string;
  secondaryImageUrl?: string | null;
  isWishlisted?: boolean;
  onAddToCart?: (id: string | number) => void;
  onToggleWishlist?: (id: string | number) => void;
  className?: string;
  showActions?: boolean;
  square?: boolean;
}

export function ProductCard({
  id,
  title,
  category,
  description,
  price,
  rating,
  reviewCount,
  compareAtPrice,
  discountPercent,
  availability,
  href,
  onNavigate,
  imageUrl,
  secondaryImageUrl,
  isWishlisted = false,
  onAddToCart,
  onToggleWishlist,
  className = '',
  showActions = true,
  square = false,
}: ProductCardProps) {
  const formatPrice = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  const handleAddToCart = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onAddToCart?.(id);
  };

  const handleToggleWishlist = (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    onToggleWishlist?.(id);
  };

  const handleTitleClick = (event: React.MouseEvent<HTMLAnchorElement>) => {
    if (!href || !onNavigate || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    onNavigate(href);
  };

  const handleCardClick = (event: React.MouseEvent<HTMLDivElement>) => {
    if (!href || !onNavigate || !(event.target instanceof Element) || event.target.closest('a, button')) return;
    onNavigate(href);
  };

  return (
    <div className={`${styles.card} ${square ? styles.square : ''} ${className}`} data-testid="product-card" data-clickable={Boolean(href && onNavigate)} onClick={handleCardClick}>
      <div className={styles.imageArea}>
        <div className={styles.primaryImage}><ProductImage src={imageUrl} alt={title} className={styles.image} loading="lazy" decoding="async" /></div>
        {secondaryImageUrl && secondaryImageUrl !== imageUrl && <div className={styles.secondaryImage} aria-hidden="true"><ProductImage src={secondaryImageUrl} alt="" className={styles.image} loading="lazy" decoding="async" /></div>}
        {showActions && <button
          type="button"
          className={`${styles.wishlistBtn} ${isWishlisted ? styles.wishlisted : ''}`}
          onClick={handleToggleWishlist}
          aria-label={isWishlisted ? `Remove ${title} from wishlist` : `Add ${title} to wishlist`}
        >
          <Heart className={styles.heartIcon} fill={isWishlisted ? 'currentColor' : 'none'} />
        </button>}
      </div>

      <div className={styles.content}>
        {category && <span className={styles.category}>{category}</span>}
        <h3 className={styles.title}>{href ? <a href={href} onClick={handleTitleClick}>{title}</a> : title}</h3>
        
        {rating !== undefined && rating !== null && (
          <div className={styles.rating}>
            <Star className={styles.starIcon} fill="currentColor" />
            <span className={styles.ratingValue}>{rating.toFixed(1)}</span>
            {reviewCount !== undefined && <span className={styles.reviewCount}>({reviewCount})</span>}
          </div>
        )}
        {reviewCount === 0 && <span className={styles.noReviews}>No reviews yet</span>}
        
        {description && <p className={styles.description}>{description}</p>}
        
        <div className={styles.priceContainer}>
          <span className={styles.price}>{formatPrice(price)}</span>
          {compareAtPrice !== undefined && discountPercent !== undefined && discountPercent > 0 && <>
            <span className={styles.comparePrice}>{formatPrice(compareAtPrice)}</span>
            <span className={styles.discount}>-{discountPercent}%</span>
          </>}
        </div>
        {availability && <span className={styles.availability}>{availability === 'AVAILABLE' ? 'In stock' : 'Out of stock'}</span>}

        {showActions && <button
          type="button"
          className={styles.addBtn}
          onClick={handleAddToCart}
          aria-label={`Add ${title} to cart`}
        >
          Add to Cart
        </button>}
      </div>
    </div>
  );
}
