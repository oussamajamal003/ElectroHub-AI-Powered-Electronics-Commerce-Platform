import { lazy, Suspense } from 'react';
import { Routes, Route } from 'react-router-dom';
import { NotFoundPage } from '../pages/NotFoundPage';
import { PlaceholderPage } from '../pages/PlaceholderPage';
import { AuthProvider } from '@/features/auth/context/AuthContext';
import { CustomerLayout } from '@/layouts/CustomerLayout';
import { AdminLayout } from '@/layouts/AdminLayout';
import { AdminLoginPage } from '@/pages/admin/AdminLoginPage';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute/ProtectedRoute';
import { ElectroHubLoader } from '@/components/ui/ElectroHubLoader/ElectroHubLoader';
import { OrdersPage } from '@/pages/customer/OrdersPage';

const HomePage = lazy(() => import('../pages/HomePage').then(module => ({ default: module.HomePage })));
const AboutPage = lazy(() => import('../pages/AboutPage').then(module => ({ default: module.AboutPage })));
const ContactPage = lazy(() => import('../pages/ContactPage').then(module => ({ default: module.ContactPage })));
const SearchPage = lazy(() => import('@/features/search/SearchPage').then(module => ({ default: module.SearchPage })));
const ProductDetailPage = lazy(() => import('../pages/customer/ProductDetailPage').then(module => ({ default: module.ProductDetailPage })));
const AccountPage = lazy(() => import('../pages/customer/AccountPage').then(module => ({ default: module.AccountPage })));
const ProfilePage = lazy(() => import('../pages/customer/ProfilePage').then(module => ({ default: module.ProfilePage })));
const route = (content: React.ReactNode) => <Suspense fallback={<ElectroHubLoader page />}>{content}</Suspense>;

export function AppRoutes() {
  return (
    <AuthProvider>
      <Routes>
        {/* Customer Public Routes */}
        <Route element={<CustomerLayout />}>
          <Route path="/" element={route(<HomePage />)} />
          <Route path="/about" element={route(<AboutPage />)} />
          <Route path="/contact" element={route(<ContactPage />)} />
          <Route path="/search" element={route(<SearchPage />)} />
          <Route path="/products" element={route(<SearchPage catalog />)} />
          <Route path="/products/:slug" element={route(<ProductDetailPage />)} />
          <Route path="/cart" element={<PlaceholderPage title="My Cart" type="cart" description="Your shopping cart will appear here." />} />
          <Route path="/orders" element={<OrdersPage />} />

          {/* Customer Protected Routes — must be logged in */}
          <Route element={<ProtectedRoute requiredRole="CUSTOMER" redirectTo="/" />}>
            <Route path="/account" element={route(<AccountPage />)} />
            <Route path="/account/profile" element={route(<ProfilePage />)} />
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
