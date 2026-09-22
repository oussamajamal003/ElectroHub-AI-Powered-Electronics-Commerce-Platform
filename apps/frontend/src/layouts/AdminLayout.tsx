import { Outlet } from 'react-router-dom';

export function AdminLayout() {
  return (
    <div style={{ display: 'flex', minHeight: '100vh', background: 'var(--color-secondary)' }}>
      {/* Sidebar would go here */}
      <aside style={{ width: 260, background: 'var(--color-background)', borderRight: '1px solid var(--color-border)', padding: '24px' }}>
        <h2 style={{ fontFamily: 'var(--font-primary)', fontSize: '20px', margin: '0 0 32px 0' }}>ElectroHub Admin</h2>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          <div>Dashboard</div>
          <div>Products</div>
          <div>Orders</div>
          <div>Customers</div>
        </nav>
      </aside>
      
      <main style={{ flex: 1, padding: '32px' }}>
        <Outlet />
      </main>
    </div>
  );
}
