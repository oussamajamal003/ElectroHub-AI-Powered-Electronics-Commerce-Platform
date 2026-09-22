import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Mail, Package, Heart, MapPin, Settings, ChevronRight, User } from 'lucide-react';
import { useAuth } from '@/features/auth/context/AuthContext';
import { Breadcrumb, BreadcrumbList, BreadcrumbItem, BreadcrumbLink, BreadcrumbPage, BreadcrumbSeparator } from '@/components/ui/Breadcrumb';
import { Avatar } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { EmptyState } from '@/components/ui/EmptyState';
import { Footer } from '@/components/layout/Footer';
import { SignOutModal } from '@/features/auth/components/SignOutModal';
import styles from './AccountPage.module.scss';

export function AccountPage() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [showSignOut, setShowSignOut] = useState(false);

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

            <div className={`${styles.gridItem} ${styles.gridItemDisabled}`}>
              <div className={styles.itemIcon}><Settings size={24} /></div>
              <div className={styles.itemBody}>
                <div className={styles.itemTitleRow}>
                  <span className={styles.itemTitle}>Account Settings</span>
                  <span className={styles.comingSoonBadge}>Coming soon</span>
                </div>
                <span className={styles.itemDesc}>Manage your profile and preferences</span>
              </div>
            </div>
          </div>
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
      <Footer />
      
      <SignOutModal 
        open={showSignOut} 
        onOpenChange={setShowSignOut} 
      />
    </div>
  );
}
