import { Outlet } from 'react-router-dom';
import { CustomerHeader } from '@/components/layout/CustomerHeader/CustomerHeader';
import { Footer } from '@/components/layout/Footer';
import { Link } from 'react-router-dom';
import styles from './CustomerLayout.module.scss';
import { CustomerScrollRestoration } from './CustomerScrollRestoration';

export function CustomerLayout() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <CustomerScrollRestoration />
      <CustomerHeader />
      <main style={{ flex: 1 }}>
        <Outlet />
      </main>
            <Footer>
        <div className={styles.footerContent}>
          <div className={styles.footerGrid}>
            <div className={styles.leftCol}>
              <div className={styles.brandInfo}>
                <Link className={styles.brand} to="/">ElectroHub</Link>
                <p>Your destination for the<br />latest consumer electronics.</p>
              </div>
              <nav aria-label="Support" className={styles.navGroup}>
                <h2>Support</h2>
                <Link to="/contact">Help Center</Link>
                <Link to="/contact">Returns & Refunds</Link>
                <Link to="/contact">Warranty</Link>
                <Link to="/contact">Privacy Policy</Link>
                <Link to="/contact">Terms of Service</Link>
              </nav>
            </div>

            <nav aria-label="Shop" className={styles.navGroup}>
              <h2>Shop</h2>
              <Link to="/products">All Products</Link>
              <Link to="/products?category=laptops">Laptops</Link>
              <Link to="/products?category=phones">Phones</Link>
              <Link to="/products?category=audio">Audio</Link>
              <Link to="/products?category=tablets">Tablets</Link>
              <Link to="/products?category=accessories">Accessories</Link>
            </nav>

            <nav aria-label="Account" className={styles.navGroup}>
              <h2>Account</h2>
              <Link to="/account">My Account</Link>
              <Link to="/orders">Orders</Link>
              <Link to="/wishlist">Wishlist</Link>
              <Link to="/orders">Track Delivery</Link>
            </nav>

            <nav aria-label="Company" className={styles.navGroup}>
              <h2>Company</h2>
              <Link to="/about">About Us</Link>
              <Link to="/about">Careers</Link>
              <Link to="/about">Press</Link>
              <Link to="/contact">Contact</Link>
            </nav>
          </div>
          <div className={styles.footerBottom}>
            <span>© 2026 ElectroHub. All rights reserved.</span>
          </div>
        </div>
      </Footer>
    </div>
  );
}
