import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Mail, Package, Heart, MapPin, Settings, ChevronRight, User, Star } from 'lucide-react';
import { useAuth } from '@/features/auth/context/AuthContext';
import { Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/Breadcrumb';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { SignOutModal } from '@/features/auth/components/SignOutModal';
import { useMyReviews } from '@/features/products/queries';
import { ElectroHubLoader } from '@/components/ui/ElectroHubLoader/ElectroHubLoader';
import styles from './AccountPage.module.scss';

export function AccountPage() {
  const { user, isAuthenticated, isInitializing } = useAuth();
  const navigate = useNavigate();
  const [showSignOut, setShowSignOut] = useState(false);
  const reviewsQuery = useMyReviews(Boolean(isAuthenticated));

  if (isInitializing || !isAuthenticated || !user) {
    return <ElectroHubLoader page />;
  }

  const initial = user?.firstName?.[0]?.toUpperCase() || 'U';

  return (
    <div className={styles.page}>
      <div className={styles.container}>
        <div className={styles.breadcrumbWrapper}>
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem>
                <BreadcrumbLink asChild>
                  <Link to="/">Home</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                <BreadcrumbPage>Account</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </div>

        <section className={styles.profileCard}>
          <div className={styles.profileInfo}>
            <Avatar initials={initial} className={styles.avatar} />
            <div className={styles.profileDetails}>
              <h2 className={styles.profileName}>{user?.firstName} {user?.lastName}</h2>
              <div className={styles.profileEmail}>
                <Mail size={16} />
                <span>{user?.email}</span>
              </div>
            </div>
          </div>
          <Button variant="outline" className={styles.editProfileBtn} onClick={() => navigate('/account/profile')}>
            <Settings size={16} className={styles.editIcon} /> Edit profile
          </Button>
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Account</h2>
          <div className={styles.grid}>
            <Link to="/orders" className={styles.gridItem}>
              <div className={styles.itemIcon}><Package size={24} /></div>
              <div className={styles.itemBody}>
                <span className={styles.itemTitle}>My Orders</span>
                <span className={styles.itemDesc}>View order history and track deliveries</span>
              </div>
              <ChevronRight size={20} className={styles.chevron} />
            </Link>

            <Link to="/wishlist" className={styles.gridItem}>
              <div className={styles.itemIcon}><Heart size={24} /></div>
              <div className={styles.itemBody}>
                <span className={styles.itemTitle}>Wishlist</span>
                <span className={styles.itemDesc}>Products you've saved for later</span>
              </div>
              <ChevronRight size={20} className={styles.chevron} />
            </Link>

            <Link to="/orders" className={styles.gridItem}>
              <div className={styles.itemIcon}><MapPin size={24} /></div>
              <div className={styles.itemBody}>
                <span className={styles.itemTitle}>Delivery Tracking</span>
                <span className={styles.itemDesc}>Real-time tracking for active deliveries</span>
              </div>
              <ChevronRight size={20} className={styles.chevron} />
            </Link>

            <Link to="/account/profile" className={styles.gridItem}>
              <div className={styles.itemIcon}><Settings size={24} /></div>
              <div className={styles.itemBody}>
                <span className={styles.itemTitle}>Account Settings</span>
                <span className={styles.itemDesc}>Manage your profile and preferences</span>
              </div>
            </Link>
          </div>
        </section>

        <section className={styles.section} aria-labelledby="your-reviews-title">
          <div className={styles.reviewHeading}><div><h2 id="your-reviews-title">Your Reviews</h2><p>Products you've reviewed</p></div></div>
          {reviewsQuery.isPending && <div className={styles.reviewStrip} role="status" aria-label="Loading your reviews">
            {Array.from({ length: 3 }, (_, index) => <div key={index} className={`${styles.reviewProduct} ${styles.reviewSkeleton}`} aria-hidden="true">
              <span className={styles.reviewSkeletonImage} />
              <span className={styles.reviewSkeletonName} />
              <span className={styles.reviewSkeletonRating} />
              <span className={styles.reviewSkeletonDate} />
              <span className={styles.reviewSkeletonPreview} />
            </div>)}
          </div>}
          {reviewsQuery.isError && <div className={styles.reviewEmpty} role="alert"><h3>Reviews are unavailable</h3><p>Please try again in a moment.</p><Button type="button" variant="outline" onClick={() => void reviewsQuery.refetch()}>Retry</Button></div>}
          {reviewsQuery.data?.data.length === 0 && <div className={styles.reviewEmpty}><h3>No reviews yet</h3><p>Products you review will appear here.</p></div>}
          {!!reviewsQuery.data?.data.length && <div className={styles.reviewStrip} aria-label="Products you've reviewed">
            {reviewsQuery.data.data.map(review => <Link key={review.id} to={`/products/${encodeURIComponent(review.product.slug)}#reviews`} className={styles.reviewProduct}>
              {review.product.primaryImage ? <img src={review.product.primaryImage.url} alt={review.product.primaryImage.altText ?? review.product.name} loading="lazy" decoding="async" /> : <span className={styles.reviewImageFallback} aria-hidden="true"><Package /></span>}
              <span className={styles.reviewProductName}>{review.product.name}</span>
              <span className={styles.reviewProductRating}><Star size={15} fill="currentColor" aria-hidden="true" /> {review.rating}/5</span>
              <time className={styles.reviewDate} dateTime={review.createdAt}>{new Date(review.createdAt).toLocaleDateString()}</time>
              <span className={styles.reviewPreview}>{review.body}</span>
            </Link>)}
          </div>}
        </section>

        <section className={styles.section}>
          <h2 className={styles.sectionTitle}>Recent Orders</h2>
          <EmptyState
            icon={<User size={48} />}
            title="No orders yet"
            description="Your order history will appear here after your first purchase."
            action={
              <Button variant="primary" onClick={() => navigate('/products')}>
                Start shopping
              </Button>
            }
          />
        </section>

        <div className={styles.signOutWrapper}>
          <Button variant="outline" className={styles.signOutBtn} onClick={() => setShowSignOut(true)}>
            Sign out
          </Button>
        </div>
      </div>
      <SignOutModal 
        open={showSignOut} 
        onOpenChange={setShowSignOut} 
      />
    </div>
  );
}
