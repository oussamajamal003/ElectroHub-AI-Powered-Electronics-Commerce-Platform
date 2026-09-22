import { Routes, Route } from 'react-router-dom';
import { HomePage } from '../pages/HomePage';
import { NotFoundPage } from '../pages/NotFoundPage';
import { PlaceholderPage } from '../pages/PlaceholderPage';
import { AccountPage } from '../pages/customer/AccountPage';
import { ProfilePage } from '../pages/customer/ProfilePage';
import { AuthProvider } from '@/features/auth/context/AuthContext';
import { CustomerLayout } from '@/layouts/CustomerLayout';
import { AdminLayout } from '@/layouts/AdminLayout';
import { AdminLoginPage } from '@/pages/admin/AdminLoginPage';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute/ProtectedRoute';

export function AppRoutes() {
  return (
    <AuthProvider>
      <Routes>
        {/* Customer Public Routes */}
        <Route element={<CustomerLayout />}>
          <Route path="/" element={<HomePage />} />
          <Route path="/cart" element={<PlaceholderPage title="My Cart" type="cart" description="Your shopping cart will appear here." />} />

          {/* Customer Protected Routes — must be logged in */}
          <Route element={<ProtectedRoute requiredRole="CUSTOMER" redirectTo="/" />}>
            <Route path="/account" element={<AccountPage />} />
            <Route path="/account/profile" element={<ProfilePage />} />
            <Route path="/orders" element={<PlaceholderPage title="My Orders" type="orders" description="Your order history will appear here." />} />
            <Route path="/wishlist" element={<PlaceholderPage title="Wishlist" type="wishlist" description="Products you save for later will appear here." />} />
          </Route>
        </Route>

        {/* Admin Public Routes */}
        <Route path="/admin/login" element={<AdminLoginPage />} />

        {/* Admin Protected Routes */}
        <Route element={<ProtectedRoute requiredRole="ADMIN" redirectTo="/admin/login" />}>
          <Route element={<AdminLayout />}>
            <Route path="/admin" element={<div>Admin Dashboard</div>} />
            {/* Add more admin routes here later */}
          </Route>
        </Route>

        {/* Fallback */}
        <Route path="*" element={<NotFoundPage />} />
      </Routes>
    </AuthProvider>
  );
}
