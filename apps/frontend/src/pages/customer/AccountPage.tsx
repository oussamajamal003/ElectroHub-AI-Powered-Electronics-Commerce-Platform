import { DeliveryNotificationPreferences } from '@/features/notifications/DeliveryNotificationPreferences';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Mail, Package, Heart, MapPin, Settings, ChevronRight, Star, ShieldCheck } from 'lucide-react';
import { useAuth } from '@/features/auth/context/AuthContext';
import { Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/Breadcrumb';
import { Avatar } from '@/components/ui/Avatar';
import { openCookieSettings } from '@/features/privacy/consent';
import { Button } from '@/components/ui/Button';
import { RecentOrders } from '@/features/account/RecentOrders';
import { SignOutModal } from '@/features/auth/components/SignOutModal';
import { useMyReviews } from '@/features/products/queries';
import { CustomerAccountSkeleton } from '@/features/account/AccountSkeleton';
import { PersonalizationPanel } from '@/features/recommendations/components/PersonalizationPanel';
import { useProfilePhoto } from '@/features/profilePhoto/queries';
import styles from './AccountPage.module.scss';

export function AccountPage() {
  const { user, isAuthenticated, isInitializing, isSessionVerified } = useAuth();
  const profilePhoto = useProfilePhoto('customer', user?.id, isSessionVerified);
  const navigate = useNavigate();
  const [showSignOut, setShowSignOut] = useState(false);
  const reviewsQuery = useMyReviews(Boolean(isAuthenticated && !isInitializing));

  if (isInitializing || !isAuthenticated || !user) {
    return <CustomerAccountSkeleton />;
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

        <header className={styles.pageIntro}>
          <p className={styles.pageEyebrow}>Your ElectroHub</p>
          <h1>My Account</h1>
          <p>Manage your profile, orders, saved products and preferences.</p>
        </header>

        <section className={styles.profileCard} aria-label="Your profile">
          <div className={styles.profileInfo}>
            <Avatar src={profilePhoto.data?.url ?? undefined} alt="" initials={initial} className={styles.avatar} />
            <div className={styles.profileDetails}>
              <h2 className={styles.profileName}>{user?.firstName} {user?.lastName}</h2>
              <div className={styles.profileEmail}>
                <Mail size={16} aria-hidden="true" />
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
              <div className={styles.itemIcon} aria-hidden="true"><Package size={22} /></div>
              <div className={styles.itemBody}>
                <span className={styles.itemTitle}>My Orders</span>
                <span className={styles.itemDesc}>View order history and track deliveries</span>
              </div>
              <ChevronRight size={20} className={styles.chevron} aria-hidden="true" />
            </Link>

            <Link to="/wishlist" className={styles.gridItem}>
              <div className={styles.itemIcon} aria-hidden="true"><Heart size={22} /></div>
              <div className={styles.itemBody}>
                <span className={styles.itemTitle}>Wishlist</span>
                <span className={styles.itemDesc}>Products you've saved for later</span>
              </div>
              <ChevronRight size={20} className={styles.chevron} aria-hidden="true" />
            </Link>

            <Link to="/orders" className={styles.gridItem}>
              <div className={styles.itemIcon} aria-hidden="true"><MapPin size={22} /></div>
              <div className={styles.itemBody}>
                <span className={styles.itemTitle}>Delivery Tracking</span>
                <span className={styles.itemDesc}>Real-time tracking for active deliveries</span>
              </div>
              <ChevronRight size={20} className={styles.chevron} aria-hidden="true" />
            </Link>

            <Link to="/account/profile" className={styles.gridItem}>
              <div className={styles.itemIcon} aria-hidden="true"><Settings size={22} /></div>
              <div className={styles.itemBody}>
                <span className={styles.itemTitle}>Account Settings</span>
                <span className={styles.itemDesc}>Manage your profile and preferences</span>
              </div>
              <ChevronRight size={20} className={styles.chevron} aria-hidden="true" />
            </Link>
          </div>
          <p className={styles.privacyLinks}>
            <ShieldCheck size={16} aria-hidden="true" /> Privacy:{' '}
            <Link to="/cookie-policy">Cookie Policy</Link>
            <span aria-hidden="true">·</span>
            <button type="button" onClick={openCookieSettings}>Cookie preferences</button>
          </p>
        </section>

        {user.role === 'CUSTOMER' && <div className={styles.section}>
          <DeliveryNotificationPreferences userId={user.id} />
          <PersonalizationPanel userId={user.id} />
        </div>}

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
          <RecentOrders />
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
