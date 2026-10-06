import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { ChevronRight, ShoppingCart } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { CartItem } from '@/components/ui/CartItem';
import { Skeleton } from '@/components/ui/Skeleton';
import { ApiError } from '@/lib/api';
import { useCart, type CartContextValue } from '@/features/cart/context';
import type { CartLine } from '@/features/cart/types';
import { customerReturnPath } from '@/features/auth/returnPath';
import styles from './CartPage.module.scss';

function money(value: string) { return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value)); }

function CartSkeleton() {
  return <div className={styles.layout} role="status" aria-label="Loading cart" data-testid="cart-skeleton">
    <div className={styles.list}>{[0, 1].map(index => <div key={index} className={styles.skeletonRow} data-testid="cart-skeleton-row">
      <div className={styles.skeletonProduct}><Skeleton className={styles.skeletonImage} />
        <div className={styles.skeletonCopy}><Skeleton width="75%" height={20} /><Skeleton width="50%" height={16} /><Skeleton width="40%" height={20} /></div>
      </div>
      <div className={styles.skeletonActions}><Skeleton width={100} height={38} /><Skeleton width={24} height={24} /></div>
    </div>)}</div>
    <aside className={`${styles.summary} ${styles.skeletonSummary}`} data-testid="cart-skeleton-summary"><Skeleton width="60%" height={28} />
      <div className={styles.summaryLine}><Skeleton width="45%" height={18} /><Skeleton width="22%" height={18} /></div>
      <div className={styles.summaryLine}><Skeleton width="32%" height={18} /><Skeleton width="18%" height={18} /></div>
      <div className={`${styles.summaryLine} ${styles.total}`}><Skeleton width="22%" height={22} /><Skeleton width="25%" height={22} /></div>
      <Skeleton width="100%" height={48} /><Skeleton width="45%" height={18} className={styles.skeletonContinue} />
    </aside>
  </div>;
}

export function CartPageContent({ cart }: { cart: CartContextValue }) {
  const navigate = useNavigate(); const location = useLocation();
  const returnTo = customerReturnPath(location.state?.from) ?? '/checkout';
  const [actionError, setActionError] = useState('');

  useEffect(() => {
    setActionError('');
  }, [cart.isGuest]);

  const act = async (operation: () => Promise<void>) => {
    setActionError('');
    try { await operation(); }
    catch (error) {
      if (error instanceof ApiError && error.code === 'CART_STOCK_CONFLICT') setActionError(error.message);
      else if (error instanceof Error && /^Only \d+ items? (?:is|are) currently available\.$/.test(error.message)) setActionError(error.message);
      else setActionError('Cart could not be updated. Please try again.');
    }
  };
  const line = (item: CartLine) => <div key={item.productId} className={styles.line}>
    <CartItem id={item.productId} title={item.product?.name ?? 'Product unavailable'} subtitle={item.product?.category}
      productHref={item.product ? `/products/${encodeURIComponent(item.product.slug)}` : undefined}
      price={item.product ? Number(item.product.price) : null} imageUrl={item.product?.image?.url ?? ''} quantity={item.quantity}
      stockStatus={item.stockStatus} maxQuantity={Math.min(999, item.availableQuantity)} unavailable={item.availability === 'OUT_OF_STOCK' || item.availability === 'UNAVAILABLE' || item.availability === 'NOT_FOUND'}
      onQuantityChange={(_, quantity) => void act(() => cart.setQuantity(item.productId, quantity))}
      onRemove={() => void act(() => cart.removeItem(item.productId))} />
      {item.availability !== 'AVAILABLE' && <p className={styles.warning} role="status">{item.availability === 'LOW_STOCK' ? `Only ${item.availableQuantity} left. Reduce quantity to continue.` : item.availability === 'OUT_OF_STOCK' ? 'Out of stock. Reduce quantity or remove this item to continue.' : 'This product is unavailable. Remove it to continue.'}</p>}
  </div>;

  return <main className={styles.page}>
    <nav className={styles.breadcrumb} aria-label="Breadcrumb"><Link to="/">Home</Link><ChevronRight size={16} aria-hidden="true" /><span aria-current="page">Cart</span></nav>
    <h1>Shopping Cart</h1>
    {cart.mergeError && <div className={styles.notice} role="alert"><p>{cart.mergeError}</p><Button type="button" onClick={() => void cart.retryMerge()}>Retry saved items</Button>
      <ul>{cart.pendingGuestItems.map(item => <li key={item.productId}>Saved product {item.productId.slice(0, 8)} · Qty {item.quantity} <Button type="button" variant="ghost" onClick={() => cart.removePendingGuestItem(item.productId)}>Remove saved item</Button></li>)}</ul></div>}
    {cart.isError && cart.data && <div className={styles.notice} role="alert"><p>Current availability could not be confirmed. Your cart is still visible.</p><Button type="button" onClick={() => void cart.retry()}>Retry availability</Button></div>}
    {actionError && <p className={styles.notice} role="alert">{actionError}</p>}
    {cart.isLoading && !cart.data && <CartSkeleton />}
    {cart.isError && !cart.data && <div className={styles.empty} role="alert"><h2>Unable to load your cart</h2><p>Your items are still saved. Please try again.</p><Button type="button" onClick={() => void cart.retry()}>Retry</Button></div>}
    {cart.data && cart.data.items.length === 0 && <div className={styles.empty}><ShoppingCart size={42} aria-hidden="true" /><h2>Your cart is empty</h2><p>Explore our latest electronics and find your next upgrade.</p><Link className={styles.primaryLink} to="/products">Explore Products</Link></div>}
    {cart.data && cart.data.items.length > 0 && <div className={styles.layout}>
      <div className={styles.list}>{cart.data.items.map(line)}</div>
      <aside className={styles.summary} aria-labelledby="cart-summary-heading"><h2 id="cart-summary-heading">Order Summary</h2>
        <div className={styles.summaryLine}><span>Subtotal ({cart.data.totalQuantity} {cart.data.totalQuantity === 1 ? 'item' : 'items'})</span><span>{money(cart.data.subtotal)}</span></div>
        <div className={styles.summaryLine}><span>Shipping</span><span className={styles.free}>Free</span></div>
        <div className={`${styles.summaryLine} ${styles.total}`}><strong>Total</strong><strong>{money(cart.data.total)}</strong></div>
        {!cart.data.canCheckout && <p className={styles.warning}>Remove unavailable items or reduce quantities to continue.</p>}
        {cart.isGuest ? <Button type="button" className={styles.checkout} disabled={!cart.data.canCheckout || cart.isError} onClick={() => window.dispatchEvent(new CustomEvent('electrohub:open-auth', { detail: { returnTo } }))}>Sign in to Checkout</Button>
          : <Button type="button" className={styles.checkout} disabled={!cart.data.canCheckout || cart.isError || cart.isLoading || cart.isLoggingOut || cart.isMutating || Boolean(cart.mergeError)} onClick={() => navigate(returnTo)}>Proceed to Checkout</Button>}
        <Link className={styles.continue} to="/products">Continue shopping</Link>
      </aside>
    </div>}
  </main>;
}

export function CartPage() {
  const cart = useCart();
  const [revalidateCached] = useState(() => Boolean(cart.data) && !cart.isLoading);
  const retry = cart.retry;
  const didRevalidate = useRef(false);
  useEffect(() => {
    if (revalidateCached && !didRevalidate.current) {
      didRevalidate.current = true;
      void retry();
    }
  }, [revalidateCached, retry]);
  return <CartPageContent cart={cart} />;
}
