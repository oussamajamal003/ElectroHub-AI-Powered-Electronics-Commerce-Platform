import { Outlet } from 'react-router-dom';
import { CustomerHeader } from '@/components/layout/CustomerHeader/CustomerHeader';
// import { Footer } from '@/components/layout/Footer'; // Assume footer exists or will be added

export function CustomerLayout() {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh' }}>
      <CustomerHeader />
      <main style={{ flex: 1 }}>
        <Outlet />
      </main>
      {/* <Footer /> */}
    </div>
  );
}
