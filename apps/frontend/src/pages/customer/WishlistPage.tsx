import { useEffect, useRef } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ChevronRight, Heart } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { ProductCard, ProductCardSkeleton } from '@/components/ui/ProductCard';
import { Skeleton } from '@/components/ui/Skeleton';
import { productCardProps } from '@/features/search/api';
import { getWishlistSkeletonCount } from '@/features/wishlist/skeletonCount';
import { useCart } from '@/features/cart/context';
import { useWishlist, type WishlistContextValue } from '@/features/wishlist/context';
import styles from './WishlistPage.module.scss';
const NO_ITEMS: NonNullable<WishlistContextValue['data']>['items'] = [];

export function WishlistPageContent({ wishlist, onAddToCart, onNavigate }: {
  wishlist: WishlistContextValue;
  onAddToCart: (productId: string) => Promise<void>;
  onNavigate: (href: string) => void;
}) {
  const root = useRef<HTMLDivElement>(null);
  const focusIndex = useRef<number | null>(null);
  const items = wishlist.data?.items ?? NO_ITEMS;
  useEffect(() => {
    if (focusIndex.current === null) return;
    const buttons = root.current?.querySelectorAll<HTMLButtonElement>('[data-wishlist-heart], [data-remove-unavailable]');
    if (buttons?.length) buttons[Math.min(focusIndex.current, buttons.length - 1)]?.focus();
    else root.current?.querySelector<HTMLAnchorElement>('[data-explore]')?.focus();
    focusIndex.current = null;
  }, [items]);
  const remove = (productId: string, index: number) => { focusIndex.current = index; wishlist.toggle(productId); };
  const initial = wishlist.isLoading;
  const displayedCount = !initial && (wishlist.totalItems > 0 || wishlist.data) ? wishlist.totalItems : undefined;
  const showEmpty = !wishlist.isLoading && Boolean(wishlist.data) && !wishlist.isError && !wishlist.isMerging && !wishlist.isLoggingOut
    && !wishlist.mergeError && wishlist.data?.totalItems === 0 && items.length === 0;
  return <main className={styles.page} ref={root}>
    <nav className={styles.breadcrumb} aria-label="Breadcrumb"><Link to="/">Home</Link><ChevronRight size={16} aria-hidden="true" /><span aria-current="page">Wishlist</span></nav>
    <div className={styles.heading}><h1>Wishlist</h1>{displayedCount === undefined
      ? <span role="status" aria-label="Wishlist count loading"><Skeleton width="4rem" height={16} /></span>
      : <span role="status" aria-label={`${displayedCount} ${displayedCount === 1 ? 'item' : 'items'}`}>{displayedCount} {displayedCount === 1 ? 'item' : 'items'}</span>}</div>
    {wishlist.error && <div className={styles.notice} role="alert">{wishlist.error}</div>}
    {wishlist.mergeError && <div className={styles.notice} role="alert"><p>{wishlist.mergeError}</p><Button onClick={() => void wishlist.retryMerge()}>Retry saved products</Button>
      <ul>{wishlist.unresolved.map(productId => <li key={productId}>Saved product unavailable <Button variant="ghost" onClick={() => wishlist.discardGuest(productId)}>Remove saved product</Button></li>)}</ul></div>}
    {wishlist.isMerging && <p role="status">Merging your saved products…</p>}
    {initial && <div className={styles.grid} role="status" aria-label="Loading wishlist"><div className={styles.skeletons} aria-hidden="true">{Array.from({ length: getWishlistSkeletonCount(wishlist.expectedCount) }, (_, index) => <ProductCardSkeleton key={index} />)}</div></div>}
    {wishlist.isError && <div className={styles.notice} role="alert"><h2>Unable to load your wishlist</h2><p>Your saved products are still safe. Please try again.</p><Button onClick={() => void wishlist.retry()}>Retry</Button></div>}
    {showEmpty && <section className={styles.empty}>
      <Heart size={40} aria-hidden="true" /><h2>Your wishlist is empty</h2><p>Save products you love and find them here whenever you need them.</p><Link to="/products" className={styles.primaryLink} data-explore>Explore Products</Link>
    </section>}
    {!initial && items.length > 0 && <div className={styles.grid}>{items.map((item, index) => item.product ? <ProductCard key={item.productId} {...productCardProps(item.product)}
      isWishlisted wishlistPending={wishlist.pending.includes(item.productId)} onToggleWishlist={() => remove(item.productId, index)} onNavigate={onNavigate}
      onAddToCart={() => onAddToCart(item.productId)} /> : <section key={item.productId} className={styles.unavailable}>
        <Heart size={32} aria-hidden="true" /><h2>Product unavailable</h2><p>This saved product is no longer available. You can remove it from your wishlist.</p>
        <Button variant="outline" data-remove-unavailable onClick={() => remove(item.productId, index)}>Remove unavailable product</Button>
      </section>)}</div>}
  </main>;
}
export function WishlistPage() {
  const wishlist = useWishlist();
  const cart = useCart();
  const navigate = useNavigate();
  if (!wishlist) throw new Error('WishlistPage requires WishlistProvider');
  return <WishlistPageContent wishlist={wishlist} onAddToCart={productId => cart.addItem(productId)} onNavigate={navigate} />;
}
