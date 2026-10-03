import { WishlistButton } from '../WishlistButton/WishlistButton';
import { useEffect, useRef, useState } from 'react';
import { ProductImage } from '../ProductImage';
import { Rating } from '../Rating/Rating';
import { ApiError } from '@/lib/api';
import type { ProductSummary } from '@/features/products/types';
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
  wishlistProduct?: ProductSummary;
  isWishlisted?: boolean;
  wishlistPending?: boolean;
  onAddToCart?: (id: string | number) => Promise<void> | void;
  onToggleWishlist?: (id: string | number, product?: ProductSummary) => void;
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
  wishlistProduct,
  isWishlisted = false,
  wishlistPending = false,
  onAddToCart,
  onToggleWishlist,
  className = '',
  showActions = true,
  square = false,
}: ProductCardProps) {
  const [cartState, setCartState] = useState<'idle' | 'adding' | 'added' | 'error'>('idle');
  const [cartError, setCartError] = useState('Could not add item. Please try again.');
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (resetTimer.current) clearTimeout(resetTimer.current); }, []);
  const formatPrice = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  const handleAddToCart = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!onAddToCart) return;
    setCartState('adding');
    try { await onAddToCart(id); setCartState('added'); }
    catch (error) {
      setCartError(error instanceof ApiError && error.code === 'CART_STOCK_CONFLICT' || error instanceof Error && /^Only \d+ items? (?:is|are) currently available\.$/.test(error.message)
        ? error.message : 'Could not add item. Please try again.');
      setCartState('error');
    }
    if (resetTimer.current) clearTimeout(resetTimer.current);
    resetTimer.current = setTimeout(() => setCartState('idle'), 2500);
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
        {showActions && onToggleWishlist && <WishlistButton title={title} saved={isWishlisted} pending={wishlistPending}
          className={styles.wishlistBtn} onToggle={() => wishlistProduct ? onToggleWishlist(id, wishlistProduct) : onToggleWishlist(id)} />}
      </div>

      <div className={styles.content}>
        {category && <span className={styles.category}>{category}</span>}
        <h3 className={styles.title}>{href ? <a href={href} onClick={handleTitleClick}>{title}</a> : title}</h3>
        
        {rating !== undefined && rating !== null && (
          <div className={styles.ratingRow}>
            <Rating value={rating} className={styles.rating} />
            {reviewCount !== undefined && <span className={styles.reviewCount} aria-label={`${reviewCount} reviews`}>({reviewCount})</span>}
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

        {showActions && onAddToCart && <button
          type="button"
          className={styles.addBtn}
          onClick={handleAddToCart}
          disabled={availability === 'UNAVAILABLE' || cartState === 'adding'}
          aria-label={`Add ${title} to cart`}
        >
          {availability === 'UNAVAILABLE' ? 'Out of stock' : cartState === 'adding' ? 'Adding…' : cartState === 'added' ? 'Added ✓' : cartState === 'error' ? 'Try again' : 'Add to Cart'}
        </button>}
        {cartState === 'error' && <span role="alert" className={styles.cartFeedback}>{cartError}</span>}
        {cartState === 'added' && <span role="status" className={styles.srOnly}>{title} added to cart.</span>}
      </div>
    </div>
  );
}
