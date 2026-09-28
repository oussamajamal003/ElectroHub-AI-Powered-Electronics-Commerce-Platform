import { Outlet } from 'react-router-dom';
import { CustomerHeader } from '@/components/layout/CustomerHeader/CustomerHeader';
import { Footer } from '@/components/layout/Footer';
import { Link } from 'react-router-dom';
import styles from './CustomerLayout.module.scss';

export function CustomerLayout() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <CustomerHeader />
      <main style={{ flex: 1 }}>
        <Outlet />
      </main>
      <Footer>
        <div className={styles.footerContent}>
          <div className={styles.footerGrid}>
            <section><Link className={styles.brand} to="/">ElectroHub</Link><p>Your destination for the<br />latest consumer electronics.</p></section>
            <nav aria-label="Shop"><h2>Shop</h2><Link to="/products">All Products</Link><Link to="/products?category=laptops">Laptops</Link><Link to="/products?category=smartphones">Phones</Link><Link to="/products?category=audio">Audio</Link><Link to="/products?category=tablets">Tablets</Link><Link to="/products?category=accessories">Accessories</Link></nav>
            <nav aria-label="Account"><h2>Account</h2><Link to="/account">My Account</Link><Link to="/orders">Orders</Link><Link to="/wishlist">Wishlist</Link><Link to="/orders">Track Delivery</Link></nav>
            <nav aria-label="Company"><h2>Company</h2><Link to="/">About Us</Link><Link to="/">Careers</Link><Link to="/">Press</Link><Link to="/">Contact</Link></nav>
          </div>
          <nav className={styles.support} aria-label="Support"><h2>Support</h2><Link to="/">Help Center</Link><Link to="/">Returns &amp; Refunds</Link><Link to="/">Warranty</Link><Link to="/">Privacy Policy</Link><Link to="/">Terms of Service</Link></nav>
          <div className={styles.footerBottom}><span>© 2026 ElectroHub. All rights reserved.</span></div>
        </div>
      </Footer>
    </div>
  );
}
