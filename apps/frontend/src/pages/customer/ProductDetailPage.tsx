import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useNavigate, useParams, useNavigationType } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { ProductGallery } from '@/components/ui/ProductGallery';
import { ProductCard } from '@/components/ui/ProductCard';
import { ProductCardSkeleton } from '@/components/ui/ProductCard/ProductCardSkeleton';
import { ProductDetailsTabs } from '@/components/ui/ProductDetailsTabs/ProductDetailsTabs';
import { ProductReviews } from '@/components/ui/ProductReviews/ProductReviews';
import { ProductSpecifications } from '@/components/ui/ProductSpecifications/ProductSpecifications';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import { useAuth } from '@/features/auth/context/AuthContext';
import { useCart } from '@/features/cart/context';
import { QuantitySelector } from '@/components/ui/QuantitySelector';
import { useProduct, useMyReview, useReviewMutation, useReviews } from '@/features/products/queries';
import { useSearchResults } from '@/features/search/queries';
import { productCardProps } from '@/features/search/api';
import { ApiError } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import type { ProductDetail, ProductResponse } from '@/features/products/types';
import styles from './ProductDetailPage.module.scss';

function formatPrice(value: string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value));
}

export function ProductDetailPage() {
  const { addItem, data: cartData } = useCart();
  const [cartQuantity, setCartQuantity] = useState(1);
  const [cartPending, setCartPending] = useState(false);
  const [cartFeedback, setCartFeedback] = useState('');
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { slug = '' } = useParams();
  const navigationType = useNavigationType();

  useEffect(() => {
    if (navigationType !== 'POP') {
      try {
        window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
      } catch (_error) {
        void _error;
      }
      if (typeof window !== 'undefined' && window.scrollY !== 0) {
        window.scrollTo(0, 0);
      }
    }
  }, [slug, navigationType]);
  const { isAuthenticated, isInitializing } = useAuth();
  const productQuery = useProduct(slug);
  const product = productQuery.data?.data;
  useEffect(() => { setCartQuantity(1); setCartFeedback(''); }, [product?.id]);
  const currentCartQuantity = product ? cartData?.items.find(item => item.productId === product.id)?.quantity ?? 0 : 0;
  const remainingQuantity = product ? Math.max(0, Math.min(999, product.availableQuantity - currentCartQuantity)) : 0;
  useEffect(() => {
    if (cartQuantity > remainingQuantity) setCartQuantity(1);
  }, [cartQuantity, remainingQuantity]);
  const [reviewPage, setReviewPage] = useState(1);
  const [rating, setRating] = useState(5);
  const [body, setBody] = useState('');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [feedback, setFeedback] = useState('');
  const reviewQuery = useReviews(slug, reviewPage);
  const ownQuery = useMyReview(slug, isAuthenticated);
  const mutation = useReviewMutation(slug);
  const recommendations = useSearchResults({ q: '', category: product?.category.slug,
    page: 1, pageSize: 5 }, Boolean(product));

  useEffect(() => {
    setRating(ownQuery.data?.data?.rating ?? 5);
    setBody(ownQuery.data?.data?.body ?? '');
  }, [ownQuery.data]);
  useEffect(() => { setReviewPage(1); setConfirmDelete(false); setFeedback(''); }, [slug]);
  useEffect(() => {
    const productId = product?.id;
    const summary = reviewQuery.data?.summary;
    if (!productId || !summary) return;
    queryClient.setQueryData<ProductResponse<ProductDetail>>(queryKeys.products.detail(slug), current =>
      current?.data.id === productId ? { ...current, data: { ...current.data, ...summary } } : current);
  }, [product?.id, reviewQuery.data?.summary, queryClient, slug]);

  if (productQuery.isPending) return <main className={styles.container} role="status" aria-label="Loading product details"><div aria-hidden="true"><Skeleton width="38%" height={20} /><div className={styles.productTop}><div><div className={styles.detailSkeletonGallery}><Skeleton width="100%" height="100%" /></div><div className={styles.detailSkeletonThumbnails}><Skeleton width={74} height={74} /><Skeleton width={74} height={74} /></div></div><div className={styles.detailSkeletonSummary}><Skeleton width="28%" height={18} /><Skeleton width="90%" height={42} /><Skeleton width="55%" height={20} /><Skeleton width="42%" height={36} /><Skeleton width="82%" height={80} /><Skeleton width="65%" height={20} /></div></div><div className={styles.detailSkeletonTabs}><Skeleton width="100%" height={50} /></div></div></main>;
  if (productQuery.isError || !product) return <main className={styles.container}><h1>Product unavailable</h1><p>This product could not be loaded.</p><Button type="button" onClick={() => void productQuery.refetch()}>Retry</Button></main>;

  const submitReview = async (event: React.FormEvent) => {
    event.preventDefault();
    setFeedback('');
    if (!body.trim() || body.trim().length > 2000) { setFeedback('Write 1 to 2,000 characters for your review.'); return; }
    try {
      await mutation.mutateAsync({ method: ownQuery.data?.data ? 'PATCH' : 'POST', rating, body: body.trim() });
      setFeedback('Your review has been saved.');
    } catch (error) {
      setFeedback(error instanceof ApiError ? error.message : 'Review could not be saved. Please try again.');
    }
  };
  const removeReview = async () => {
    setFeedback('');
    try {
      await mutation.mutateAsync({ method: 'DELETE' });
      setConfirmDelete(false); setFeedback('Your review has been deleted.');
    } catch (error) {
      setFeedback(error instanceof ApiError ? error.message : 'Review could not be deleted. Please try again.');
    }
  };
  const related = recommendations.data?.data.filter(item => item.id !== product.id).slice(0, 4) ?? [];

  return <main className={styles.container}>
    <nav className={styles.breadcrumb} aria-label="Breadcrumb"><Link to="/">Home</Link><ChevronRight size={16} aria-hidden="true" /><Link to="/products">Products</Link><ChevronRight size={16} aria-hidden="true" /><Link to={`/products?category=${encodeURIComponent(product.category.slug)}`}>{product.category.name}</Link><ChevronRight size={16} aria-hidden="true" /><span aria-current="page">{product.name}</span></nav>
    <div className={styles.productTop}>
      <ProductGallery className={styles.gallery} images={product.images.map(image => ({ id: image.id, src: image.url, alt: image.altText ?? product.name }))} />
      <section className={styles.summary} aria-labelledby="product-title">
        <p className={styles.category}>{product.category.name}{product.brand ? ` · ${product.brand.name}` : ''}</p>
        <h1 id="product-title">{product.name}</h1>
        <p className={styles.model}>SKU: {product.sku}{product.modelNumber ? ` · Model: ${product.modelNumber}` : ''}</p>
        <p className={styles.rating}>{product.averageRating === null ? 'No reviews yet' : `★ ${product.averageRating} (${product.reviewCount} reviews)`}</p>
        <div className={styles.price}><strong>{formatPrice(product.price)}</strong>
          {product.compareAtPrice && product.discountPercent !== null && <><del>{formatPrice(product.compareAtPrice)}</del><span className={styles.discount}>-{product.discountPercent}%</span></>}
        </div>
        <p className={product.availability === 'AVAILABLE' ? styles.availability : styles.unavailable}>{product.availability === 'AVAILABLE' ? 'In stock' : 'Currently unavailable'}</p>
        <div className={styles.cartActions}>
          <div className={styles.quantityRow}><span>Qty</span><QuantitySelector quantity={cartQuantity} productName={product.name} maxQuantity={remainingQuantity} disabled={product.availability !== 'AVAILABLE' || cartPending} onIncrease={() => setCartQuantity(value => Math.min(remainingQuantity, value + 1))} onDecrease={() => setCartQuantity(value => Math.max(1, value - 1))} /></div>
          {product.availability !== 'AVAILABLE' || remainingQuantity === 0 ? <p role="status">{product.availability !== 'AVAILABLE' ? 'Currently unavailable.' : 'You already have the available stock in your cart.'}</p> : <p role="status">{remainingQuantity} more {remainingQuantity === 1 ? 'item' : 'items'} available to add.</p>}
          <Button type="button" disabled={product.availability !== 'AVAILABLE' || remainingQuantity === 0 || cartPending} isLoading={cartPending} onClick={async () => {
            setCartPending(true); setCartFeedback('');
            try { await addItem(product.id, cartQuantity); setCartFeedback(`${product.name} added to cart.`); }
            catch (error) { setCartFeedback(error instanceof ApiError && error.code === 'CART_STOCK_CONFLICT' || error instanceof Error && /^Only \d+ items? (?:is|are) currently available\.$/.test(error.message)
              ? error.message : 'Could not add this product. Check availability and try again.'); }
            finally { setCartPending(false); }
          }}>Add to Cart</Button>
          {cartFeedback && <p role="status" className={styles.cartFeedback}>{cartFeedback}</p>}
        </div>
        {product.description && <p className={styles.intro}>{product.description}</p>}
      </section>
    </div>

    <ProductDetailsTabs className={styles.tabs} reviewCount={product.reviewCount} defaultValue={location.hash === '#reviews' ? 'reviews' : 'description'}
      description={<section><h2>Product Description</h2><p>{product.description || 'No description is available.'}</p></section>}
      specifications={<section><h2>Specifications</h2><ProductSpecifications groups={product.specifications} /></section>}
      reviews={<><div className={styles.reviewsHeading}><h2>Customer Reviews</h2><p>{product.averageRating === null ? 'Not yet rated' : `★ ${product.averageRating} out of 5`} · {product.reviewCount} {product.reviewCount === 1 ? 'review' : 'reviews'}</p></div>
        <ProductReviews reviews={reviewQuery.data?.data ?? []} loading={reviewQuery.isPending}
          error={reviewQuery.isError && !reviewQuery.data} onRetry={() => void reviewQuery.refetch()} ownReviewId={ownQuery.data?.data?.id} />
        {reviewQuery.data && reviewQuery.data.meta.totalPages > 1 && <nav className={styles.reviewPages} aria-label="Review pages"><Button type="button" disabled={reviewPage <= 1} onClick={() => setReviewPage(page => page - 1)}>Previous</Button><span>Page {reviewPage} of {reviewQuery.data.meta.totalPages}</span><Button type="button" disabled={reviewPage >= reviewQuery.data.meta.totalPages} onClick={() => setReviewPage(page => page + 1)}>Next</Button></nav>}
        {isInitializing ? <div className={styles.reviewAuthLoading} role="status" aria-label="Checking review access"><Skeleton width="100%" height={96} /></div> : isAuthenticated ? <section className={styles.reviewForm}><h3>{ownQuery.data?.data ? 'Edit your review' : 'Write a review'}</h3>
          {ownQuery.isPending ? <div role="status" aria-label="Loading your review"><Skeleton width="100%" height={120} /></div> : <form onSubmit={event => void submitReview(event)}><Select label="Rating" value={String(rating)} onValueChange={value => setRating(Number(value))} options={[5, 4, 3, 2, 1].map(value => ({ value: String(value), label: `${value} ${value === 1 ? 'star' : 'stars'}` }))} square fullWidth /><label htmlFor="review-body">Your review</label><textarea id="review-body" value={body} onChange={event => setBody(event.target.value)} minLength={1} maxLength={2000} required rows={5} /><small>{body.length}/2000 characters</small><div className={styles.reviewActions}><Button type="submit" isLoading={mutation.isPending}>{ownQuery.data?.data ? 'Update review' : 'Post review'}</Button>{ownQuery.data?.data && !confirmDelete && <Button type="button" variant="destructive" disabled={mutation.isPending} onClick={() => setConfirmDelete(true)}>Delete review</Button>}</div></form>}
          {confirmDelete && <div className={styles.reviewConfirm} role="group" aria-label="Confirm review deletion"><p>Delete your review?</p><div className={styles.reviewActions}><Button type="button" variant="destructive" disabled={mutation.isPending} isLoading={mutation.isPending} onClick={() => void removeReview()}>Confirm delete</Button><Button type="button" variant="outline" disabled={mutation.isPending} onClick={() => setConfirmDelete(false)}>Cancel</Button></div></div>}
          {feedback && <p className={styles.reviewFeedback} role="status">{feedback}</p>}
        </section> : <section className={styles.reviewGuest}><h3>Share your experience</h3><p>Sign in to write a review of this product.</p><Button type="button" onClick={() => window.dispatchEvent(new Event('electrohub:open-auth'))}>Sign In</Button></section>}
      </>} />

    <section className={styles.related} aria-labelledby="related-title"><div className={styles.relatedHeading}><h2 id="related-title">More in {product.category.name}</h2><Link to={`/products?category=${encodeURIComponent(product.category.slug)}`}>View category →</Link></div>
      {recommendations.isPending && <div role="status" aria-label="Loading related products" className={styles.relatedGrid}>{Array.from({ length: 4 }, (_, index) => <ProductCardSkeleton key={index} />)}</div>}
      {recommendations.isError && <p role="alert">Related products are unavailable. <Button type="button" onClick={() => void recommendations.refetch()}>Retry</Button></p>}
      {related.length > 0 && <div className={styles.relatedGrid}>{related.map(item => <ProductCard key={item.id} {...productCardProps(item)} onNavigate={navigate} onAddToCart={() => addItem(item.id)} />)}</div>}
    </section>
  </main>;
}
