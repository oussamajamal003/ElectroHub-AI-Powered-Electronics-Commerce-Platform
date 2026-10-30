import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ProductCard } from '@/components/ui/ProductCard';
import { ProductCardSkeleton } from '@/components/ui/ProductCard/ProductCardSkeleton';
import { Button } from '@/components/ui/Button';
import { productCardProps } from '@/features/search/api';
import type { ProductSummary } from '@/features/products/types';
import styles from './RecommendationRail.module.scss';

export interface RecommendationRailProps {
  /** Stable id for the heading (aria-labelledby). */
  id: string;
  /** Omit only while loading when the final heading is not known yet (the server may answer with a different section type): the skeleton is then headingless. */
  title?: string;
  description?: string;
  products: ProductSummary[];
  /** Initial load with nothing to show yet: structural skeletons, never a "no results" message. */
  loading?: boolean;
  /** Failure with nothing to show: a quiet retry instead of the rail. With products, cards stay visible. */
  error?: boolean;
  onRetry?: () => void;
  skeletonCount?: number;
  columns?: 3 | 4;
  action?: { href: string; label: string };
  headingLevel?: 'h2' | 'h3';
  wishlistIds?: readonly string[];
  wishlistPending?: readonly string[];
  onToggleWishlist?: (productId: string, product: ProductSummary) => void;
  onAddToCart?: (productId: string) => Promise<void> | void;
  onNavigate?: (href: string, product: ProductSummary) => void;
  onRemove?: (productId: string) => void;
  removeDisabled?: boolean;
  /** Ref for viewability tracking of each card wrapper. */
  cardRef?: (productId: string) => (element: HTMLElement | null) => void;
  footer?: ReactNode;
}

/**
 * Shared recommendation rail: a semantic, responsive grid of the existing ProductCard (no carousel, so there is no
 * scroll trap and every card is reachable by Tab). Card actions are the same cart, wishlist and navigation as anywhere
 * else in the store.
 */
export function RecommendationRail({
  id, title, description, products, loading = false, error = false, onRetry, skeletonCount = 4, columns = 4, action,
  headingLevel = 'h2', wishlistIds, wishlistPending, onToggleWishlist, onAddToCart, onNavigate, cardRef, footer,
  onRemove, removeDisabled = false,
}: RecommendationRailProps) {
  const Heading = headingLevel;
  const showSkeleton = loading && products.length === 0;
  const showError = error && products.length === 0 && !loading;
  if (!showSkeleton && !showError && products.length === 0) return null;
  const neutral = !title;
  const gridClass = `${styles.grid} ${columns === 3 ? styles.threeColumns : ''}`;

  return <section className={styles.rail} aria-labelledby={neutral ? undefined : id} aria-label={neutral ? 'Loading recommendations' : undefined} aria-busy={showSkeleton || undefined} data-testid={`rail-${id}`}>
    {!neutral && <div className={styles.heading}>
      <div>
        <Heading id={id}>{title}</Heading>
        {description && <p className={styles.description}>{description}</p>}
      </div>
      {action && products.length > 0 && <Link to={action.href} className={styles.action}>{action.label} <span aria-hidden="true">→</span></Link>}
    </div>}
    {showSkeleton && <div className={gridClass} role="status" aria-label={`Loading ${title ?? 'recommendations'}`}>
      {Array.from({ length: skeletonCount }, (_, index) => <ProductCardSkeleton key={index} />)}
    </div>}
    {showError && <p className={styles.unavailable} role="status">
      These suggestions are unavailable right now.
      {onRetry && <Button type="button" variant="ghost" onClick={onRetry}>Try again</Button>}
    </p>}
    {products.length > 0 && <ul className={gridClass} aria-label={title ?? 'Recommendations'}>
      {products.map(product => <li key={product.id} ref={cardRef?.(product.id)} className={`${styles.item} ${onRemove ? styles.itemWithRemove : ''}`}>
        <ProductCard {...productCardProps(product)}
          isWishlisted={wishlistIds?.includes(product.id)} wishlistPending={wishlistPending?.includes(product.id)}
          onToggleWishlist={onToggleWishlist ? (_, summary) => onToggleWishlist(product.id, summary ?? product) : undefined}
          onAddToCart={onAddToCart ? () => onAddToCart(product.id) : undefined}
          onNavigate={onNavigate ? href => onNavigate(href, product) : undefined} />
        {onRemove && <Button type="button" variant="ghost" disabled={removeDisabled} onClick={() => onRemove(product.id)} aria-label={`Remove ${product.name} from recently viewed`}>Remove from history</Button>}
      </li>)}
    </ul>}
    {footer}
  </section>;
}
