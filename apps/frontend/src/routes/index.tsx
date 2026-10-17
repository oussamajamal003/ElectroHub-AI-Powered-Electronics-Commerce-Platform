import { lazy, Suspense, useEffect, useRef } from 'react';
import { Routes, Route, useLocation } from 'react-router-dom';
import { NotFoundPage } from '../pages/NotFoundPage';
import { WishlistProvider } from '@/features/wishlist/WishlistProvider';
import { WishlistPage } from '@/pages/customer/WishlistPage';
import { AuthProvider } from '@/features/auth/context/AuthContext';
import { CartProvider } from '@/features/cart/CartProvider';
import { CustomerLayout } from '@/layouts/CustomerLayout';
import { AdminLayout } from '@/layouts/AdminLayout';
import { AdminLoginPage } from '@/pages/admin/AdminLoginPage';
import { ProtectedRoute } from '@/components/layout/ProtectedRoute/ProtectedRoute';
import { ElectroHubLoader } from '@/components/ui/ElectroHubLoader/ElectroHubLoader';
import { CheckoutDraftSession } from '@/features/checkout/CheckoutDraftSession';
import { PaymentLockProvider } from '@/features/checkout/PaymentLockContext';
import { OrdersPage } from '@/pages/customer/OrdersPage';
import { useCart } from '@/features/cart/context';

function CartRouteValidation() {
  const { isMutating, validateRoute } = useCart();
  const location = useLocation();
  const previousEntry = useRef(location.key);
  const pendingEntry = useRef(false);
  useEffect(() => {
    // Rapid away/back navigation can commit only the final pathname. The
    // history entry still changes, so validate that entry rather than a path delta.
    if (location.pathname === '/cart' && previousEntry.current !== location.key) pendingEntry.current = true;
    previousEntry.current = location.key;
    if (location.pathname !== '/cart' || !pendingEntry.current || isMutating) return;
    pendingEntry.current = false;
    void validateRoute();
  }, [location.pathname, location.key, isMutating, validateRoute]);
  return null;
}

const HomePage = lazy(() => import('../pages/HomePage').then(module => ({ default: module.HomePage })));
const AboutPage = lazy(() => import('../pages/AboutPage').then(module => ({ default: module.AboutPage })));
const ContactPage = lazy(() => import('../pages/ContactPage').then(module => ({ default: module.ContactPage })));
const SearchPage = lazy(() => import('@/features/search/SearchPage').then(module => ({ default: module.SearchPage })));
const ProductDetailPage = lazy(() => import('../pages/customer/ProductDetailPage').then(module => ({ default: module.ProductDetailPage })));
const CartPage = lazy(() => import('../pages/customer/CartPage').then(module => ({ default: module.CartPage })));
const AccountPage = lazy(() => import('../pages/customer/AccountPage').then(module => ({ default: module.AccountPage })));
const ProfilePage = lazy(() => import('../pages/customer/ProfilePage').then(module => ({ default: module.ProfilePage })));
const CheckoutPage = lazy(() => import('@/features/checkout/CheckoutPage').then(module => ({ default: module.CheckoutPage })));
const ConfirmationPage = lazy(() => import('@/features/checkout/ConfirmationPage').then(module => ({ default: module.ConfirmationPage })));
const PaymentRetryPage = lazy(() => import('@/features/checkout/PaymentRetryPage').then(module => ({ default: module.PaymentRetryPage })));
const PaymentStatusPage = lazy(() => import('@/features/checkout/PaymentStatusPage').then(module => ({ default: module.PaymentStatusPage })));
const route = (content: React.ReactNode) => <Suspense fallback={<ElectroHubLoader page />}>{content}</Suspense>;

export function AppRoutes() {
  return (
    <AuthProvider>
      <CartProvider>
      <WishlistProvider>
      <PaymentLockProvider>
      <CheckoutDraftSession />
      <CartRouteValidation />
      <Routes>
        {/* Customer Public Routes */}
        <Route element={<CustomerLayout />}>
          <Route path="/" element={route(<HomePage />)} />
          <Route path="/about" element={route(<AboutPage />)} />
          <Route path="/contact" element={route(<ContactPage />)} />
          <Route path="/search" element={route(<SearchPage />)} />
          <Route path="/products" element={route(<SearchPage catalog />)} />
          <Route path="/products/:slug" element={route(<ProductDetailPage />)} />
          <Route path="/cart" element={route(<CartPage />)} />
          <Route path="/wishlist" element={route(<WishlistPage />)} />
          <Route path="/orders" element={<OrdersPage />} />

          <Route element={<ProtectedRoute requiredRole="CUSTOMER" redirectTo="/cart" requireVerifiedSession preserveReturnPath />}>
            <Route path="/account/payment-retry/:attemptId" element={route(<PaymentRetryPage />)} />
            <Route path="/account/payment-status/:attemptId" element={route(<PaymentStatusPage />)} />
            <Route path="/checkout" element={route(<CheckoutPage key="cart" />)} />
            <Route path="/checkout/buy-now" element={route(<CheckoutPage key="buy-now" scope="BUY_NOW" />)} />
            <Route path="/checkout/confirmation/:orderReference" element={route(<ConfirmationPage />)} />
          </Route>
          {/* Customer Protected Routes — must be logged in */}
          <Route element={<ProtectedRoute requiredRole="CUSTOMER" redirectTo="/" />}>
            <Route path="/account" element={route(<AccountPage />)} />
            <Route path="/account/profile" element={route(<ProfilePage />)} />
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
      </PaymentLockProvider>
      </WishlistProvider>
      </CartProvider>
    </AuthProvider>
  );
}
