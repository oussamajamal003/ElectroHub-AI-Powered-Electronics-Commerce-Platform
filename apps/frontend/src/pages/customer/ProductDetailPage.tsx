import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useNavigate, useParams, useNavigationType } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { ProductGallery } from '@/components/ui/ProductGallery';
import { ProductDetailsTabs } from '@/components/ui/ProductDetailsTabs/ProductDetailsTabs';
import { ProductReviews } from '@/components/ui/ProductReviews/ProductReviews';
import { ProductSpecifications } from '@/components/ui/ProductSpecifications/ProductSpecifications';
import { Button } from '@/components/ui/Button';
import { Select } from '@/components/ui/Select';
import { Skeleton } from '@/components/ui/Skeleton';
import { useAuth } from '@/features/auth/context/AuthContext';
import { useCart } from '@/features/cart/context';
import { useWishlist } from '@/features/wishlist/context';
import { WishlistButton } from '@/components/ui/WishlistButton/WishlistButton';
import { Rating } from '@/components/ui/Rating/Rating';
import { useProduct, useMyReview, useReviewMutation, useReviews } from '@/features/products/queries';
import { useProductRecommendations, useRecommendationPreferences, useRecordProductView } from '@/features/recommendations/queries';
import { RecommendationSectionRail } from '@/features/recommendations/components/RecommendationSectionRail';
import { ApiError } from '@/lib/api';
import { queryKeys } from '@/lib/query';
import type { ProductDetail, ProductResponse } from '@/features/products/types';
import styles from './ProductDetailPage.module.scss';
import { ProductPurchaseActions } from './ProductPurchaseActions';
import { saveBuyNow } from '@/features/checkout/buyNow';

const RECOMMENDATION_LIMIT = 4;

function formatPrice(value: string) {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value));
}

export function ProductDetailPage() {
  const { addItem, data: cartData } = useCart();
  const wishlist = useWishlist();
  const [cartQuantity, setCartQuantity] = useState(1);
  const [cartPending, setCartPending] = useState(false);
  const cartAction = useRef(false);
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
  const { isAuthenticated, isInitializing, user } = useAuth();
  const productQuery = useProduct(slug);
  // A stale cached detail may have become non-public (for example, a test fixture).
  // Render only after a fresh server read so a denied product never flashes from cache.
  const product = productQuery.isError || productQuery.isFetching ? undefined : productQuery.data?.data;
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
  // Task 04.4: one request returns Similar Products (D3 image embeddings, or an honestly labelled same-category
  // fallback), You May Also Like and Frequently Bought Together, already de-duplicated across rails.
  const recommendations = useProductRecommendations(slug, RECOMMENDATION_LIMIT, Boolean(product));
  const customerId = isAuthenticated && user?.role === 'CUSTOMER' ? user.id : undefined;
  const preferences = useRecommendationPreferences(customerId);
  const personalizationEnabled = preferences.data?.data.personalizationEnabled ?? false;
  useRecordProductView(product?.id, customerId, personalizationEnabled);

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

  if (productQuery.isPending || productQuery.isFetching) return <main className={styles.container} role="status" aria-label="Loading product details"><div aria-hidden="true"><Skeleton width="38%" height={20} /><div className={styles.productTop}><div><div className={styles.detailSkeletonGallery}><Skeleton width="100%" height="100%" /></div><div className={styles.detailSkeletonThumbnails}><Skeleton width={74} height={74} /><Skeleton width={74} height={74} /></div></div><div className={styles.detailSkeletonSummary}><Skeleton width="28%" height={18} /><Skeleton width="90%" height={42} /><Skeleton width="55%" height={20} /><Skeleton width="42%" height={36} /><Skeleton width="82%" height={80} /><Skeleton width="65%" height={20} /></div></div><div className={styles.detailSkeletonTabs}><Skeleton width="100%" height={50} /></div></div></main>;
  if (!product) return <main className={styles.container}><h1>Product unavailable</h1><p>This product could not be loaded.</p><Button type="button" onClick={() => void productQuery.refetch()}>Retry</Button></main>;

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
  // Only this product's response is ever rendered: the query key is the slug, and a section for another anchor cannot match.
  const sections = recommendations.data?.data.sections ?? [];
  const addToCart = async () => {
    if (cartAction.current || !product.purchasable || remainingQuantity < cartQuantity) return;
    cartAction.current = true;
    setCartPending(true); setCartFeedback('');
    try {
      await addItem(product.id, cartQuantity);
      setCartFeedback(`${product.name} added to cart.`);
    } catch (error) {
      setCartFeedback(error instanceof ApiError && error.code === 'CART_STOCK_CONFLICT' || error instanceof Error && /^Only \d+ items? (?:is|are) currently available\.$/.test(error.message)
        ? error.message : 'Could not add this product. Check availability and try again.');
    } finally { cartAction.current = false; setCartPending(false); }
  };
  // Buy Now purchases only this product/quantity through a server-owned BUY_NOW scope; the persistent Cart is never read or changed.
  const buyNow = () => {
    if (cartAction.current || !product.purchasable || product.availableQuantity < cartQuantity) return;
    if (!saveBuyNow({ productId: product.id, quantity: cartQuantity })) { setCartFeedback('Buy Now needs browser session storage to be enabled.'); return; }
    navigate('/checkout/buy-now');
  };

  return <main className={styles.container}>
    {productQuery.isError && <div role="status"><p>Current availability could not be refreshed. The last confirmed product is still visible.</p><Button type="button" variant="ghost" onClick={() => void productQuery.refetch()}>Retry availability</Button></div>}
    <nav className={styles.breadcrumb} aria-label="Breadcrumb"><Link to="/">Home</Link><ChevronRight size={16} aria-hidden="true" /><Link to="/products">Products</Link><ChevronRight size={16} aria-hidden="true" /><Link to={`/products?category=${encodeURIComponent(product.category.slug)}`}>{product.category.name}</Link><ChevronRight size={16} aria-hidden="true" /><span aria-current="page">{product.name}</span></nav>
    <div className={styles.productTop}>
      <ProductGallery productName={product.name} className={styles.gallery} images={product.images.map(image => ({ id: image.id, src: image.url, alt: image.altText?.trim() || product.name }))} />
      <section className={styles.summary} aria-labelledby="product-title">
        <p className={styles.category}>{product.category.name}{product.brand ? ` · ${product.brand.name}` : ''}</p>
        <h1 id="product-title">{product.name}</h1>
        <p className={styles.model}>SKU: {product.sku}{product.modelNumber ? ` · Model: ${product.modelNumber}` : ''}</p>
        <Rating value={Number(product.averageRating ?? 0)} reviewCount={product.reviewCount} className={styles.rating} />
        <div className={styles.price}><strong>{formatPrice(product.price)}</strong>
          {product.compareAtPrice && product.discountPercent !== null && <><del>{formatPrice(product.compareAtPrice)}</del><span className={styles.discount}>-{product.discountPercent}%</span></>}
        </div>
        {product.description && <p className={styles.intro} data-testid="product-description">{product.description}</p>}
        <ProductPurchaseActions product={product} quantity={cartQuantity} remainingQuantity={remainingQuantity} pending={cartPending} feedback={cartFeedback}
          onQuantityChange={setCartQuantity} wishlistError={wishlist?.error}
          wishlistAction={wishlist && <WishlistButton title={product.name} saved={wishlist.productIds.includes(product.id)} pending={wishlist.pending.includes(product.id)} onToggle={() => wishlist.toggle(product.id)} />}
          onAdd={() => addToCart()} onBuyNow={buyNow} />
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

    {recommendations.isPending && <RecommendationSectionRail id="similar-title" loading loadingTitle="Similar Products" />}
    {recommendations.isError && !recommendations.data && <RecommendationSectionRail id="similar-title" error loadingTitle="Similar Products"
      onRetry={() => void recommendations.refetch()} />}
    {sections.map(section => <RecommendationSectionRail key={section.mode} id={`${section.mode.toLowerCase().replace(/_/g, '-')}-title`}
      section={section} recordPersonalClicks={personalizationEnabled}
      action={section.strategy === 'FALLBACK_CATEGORY' && section.context
        ? { href: `/products?category=${encodeURIComponent(section.context.categorySlug)}`, label: 'View category' } : undefined} />)}
  </main>;
}
