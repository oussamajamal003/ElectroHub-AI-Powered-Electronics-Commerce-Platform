import { Link, Outlet } from 'react-router-dom';
import styles from './AdminLayout.module.scss';

export function AdminLayout() {
  return (
    <div className={styles.shell}>
      <aside className={styles.sidebar}>
        <h2 className={styles.brand}>ElectroHub Admin</h2>
        <nav className={styles.nav} aria-label="Admin navigation">
          <div>Dashboard</div>
          <Link to="/admin/products">Products</Link>
          <Link to="/admin/deliveries">Deliveries</Link>
          <div>Orders</div>
          <div>Customers</div>
        </nav>
      </aside>
      
      <main className={styles.main}>
        <Outlet />
      </main>
    </div>
  );
}
