import { Heart, Star } from 'lucide-react';
import { ProductImage } from '../ProductImage';
import styles from './ProductCard.module.scss';

export interface ProductCardProps {
  id: string | number;
  title: string;
  category?: string;
  description?: string;
  price: number;
  rating?: number;
  imageUrl: string;
  isWishlisted?: boolean;
  onAddToCart?: (id: string | number) => void;
  onToggleWishlist?: (id: string | number) => void;
  className?: string;
}

export function ProductCard({
  id,
  title,
  category,
  description,
  price,
  rating,
  imageUrl,
  isWishlisted = false,
  onAddToCart,
  onToggleWishlist,
  className = '',
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

  return (
    <div className={`${styles.card} ${className}`} data-testid="product-card">
      <div className={styles.imageArea}>
        <ProductImage src={imageUrl} alt={title} className={styles.image} />
        <button
          type="button"
          className={`${styles.wishlistBtn} ${isWishlisted ? styles.wishlisted : ''}`}
          onClick={handleToggleWishlist}
          aria-label={isWishlisted ? `Remove ${title} from wishlist` : `Add ${title} to wishlist`}
        >
          <Heart className={styles.heartIcon} fill={isWishlisted ? 'currentColor' : 'none'} />
        </button>
      </div>

      <div className={styles.content}>
        {category && <span className={styles.category}>{category}</span>}
        <h3 className={styles.title}>{title}</h3>
        
        {rating !== undefined && (
          <div className={styles.rating}>
            <Star className={styles.starIcon} fill="currentColor" />
            <span className={styles.ratingValue}>{rating.toFixed(1)}</span>
          </div>
        )}
        
        {description && <p className={styles.description}>{description}</p>}
        
        <div className={styles.priceContainer}>
          <span className={styles.price}>{formatPrice(price)}</span>
        </div>

        <button
          type="button"
          className={styles.addBtn}
          onClick={handleAddToCart}
          aria-label={`Add ${title} to cart`}
        >
          Add to Cart
        </button>
      </div>
    </div>
  );
}
