import { useState, useEffect, useCallback, useRef } from 'react';
import { NavLink, Link, useNavigate } from 'react-router-dom';
import {
  ShoppingCart,
  Heart,
  LogOut,
  Zap,
  Search,
  User as UserIcon,
  Menu,
  X,
  Package,
} from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/DropdownMenu';
import { useAuth } from '@/features/auth/context/AuthContext';
import { useCart } from '@/features/cart/context';
import { useWishlist } from '@/features/wishlist/context';
import { AuthModal, AuthModalMode } from '@/features/auth/components/AuthModal';
import { customerReturnPath, type CustomerReturnPath } from '@/features/auth/returnPath';
import { SignOutModal } from '@/features/auth/components/SignOutModal';
import styles from './CustomerHeader.module.scss';

export interface CustomerHeaderProps {
  cartCount?: number;
  wishlistCount?: number;
}

export function CustomerHeader({ cartCount: countOverride, wishlistCount: wishlistOverride }: CustomerHeaderProps) {
  const wishlist = useWishlist();
  const wishlistCount = wishlist?.isLoading ? 0 : wishlistOverride ?? wishlist?.totalItems ?? 0;
  const { totalQuantity } = useCart();
  const cartCount = countOverride ?? totalQuantity;
  const [authReturnTo, setAuthReturnTo] = useState<CustomerReturnPath | undefined>();
  const { user, rememberedUser, isAuthenticated, isInitializing } = useAuth();
  const headerUser = isInitializing ? rememberedUser : user;
  const showAuthenticatedHeader = isInitializing ? Boolean(rememberedUser) : isAuthenticated;
  const navigate = useNavigate();

  // Auth modals
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState<AuthModalMode>('login');
  const [showSignOut, setShowSignOut] = useState(false);

  // Mobile menu
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const mobileMenuToggle = useRef<HTMLButtonElement>(null);
  const mobileSignOut = useRef(false);

  // Scroll state
  const [isScrolled, setIsScrolled] = useState(false);

  // Scroll listener
  useEffect(() => {
    const handleScroll = () => {
      setIsScrolled(window.scrollY > 8);
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  useEffect(() => {
    const openAuth = (event: Event) => {
      setAuthReturnTo(customerReturnPath((event as CustomEvent<{ returnTo?: string }>).detail?.returnTo));
      setAuthMode('login'); setShowAuthModal(true);
    };
    window.addEventListener('electrohub:open-auth', openAuth);
    return () => window.removeEventListener('electrohub:open-auth', openAuth);
  }, []);

  // Close mobile menu or search on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isMobileMenuOpen) setIsMobileMenuOpen(false);
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isMobileMenuOpen]);

  const getInitials = (firstName: string, lastName: string) => {
    return `${firstName?.[0] || ''}${lastName?.[0] || ''}`.toUpperCase();
  };

  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [isAuthenticated]);

  const closeMobileMenu = useCallback(() => {
    setIsMobileMenuOpen(false);
  }, []);

  const handleSearchOpen = () => {
    setIsMobileMenuOpen(false);
    navigate('/search');
  };

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    isActive ? `${styles.navLink} ${styles.navLinkActive}` : styles.navLink;

  const mobileNavClass = ({ isActive }: { isActive: boolean }) =>
    isActive
      ? `${styles.mobileMenuItem} ${styles.mobileMenuItemActive}`
      : styles.mobileMenuItem;

  return (
    <>
      {/* ─── Header Shell ────────────────────────────────────────── */}
      <header
        className={`${styles.header} ${isScrolled ? styles.scrolled : ''}`}
        role="banner"
      >

        <div className={styles.container}>
          <div
            className={styles.headerMainContent}
          >
            {/* LEFT — Mobile Toggle + Brand */}
            <div className={styles.leftSection}>
              <button
                ref={mobileMenuToggle}
                type="button"
                className={styles.mobileMenuToggle}
                onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}
                aria-label={isMobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
                aria-expanded={isMobileMenuOpen}
                aria-controls="mobile-nav"
              >
                {isMobileMenuOpen ? <X size={22} /> : <Menu size={22} />}
              </button>

              <Link to="/" className={styles.logoLink} aria-label="ElectroHub — Home">
                <div className={styles.logoIcon} aria-hidden="true">
                  <Zap size={18} className={styles.zap} />
                </div>
                <span className={styles.logoText}>Electro<span className={styles.logoHub}>Hub</span></span>
              </Link>
            </div>

            {/* CENTER — Desktop Navigation */}
            <nav className={styles.navigation} aria-label="Primary navigation">
              <NavLink to="/" end className={navLinkClass}>Home</NavLink>
              <NavLink to="/products" className={navLinkClass}>Products</NavLink>
              {showAuthenticatedHeader && (
                <NavLink to="/orders" className={navLinkClass}>Orders</NavLink>
              )}
              <NavLink to="/about" className={navLinkClass}>About</NavLink>
              <NavLink to="/contact" className={navLinkClass}>Contact</NavLink>
            </nav>

            {/* RIGHT — Utility Icons + Avatar + Unified Search */}
            <div className={styles.actions}>

                  <button
                    type="button"
                    className={styles.iconButton}
                    aria-label="Search"
                    onClick={handleSearchOpen}
                  >
                    <Search size={20} />
                  </button>

                  <Link
                    to="/cart"
                    className={styles.iconButton}
                    aria-label={cartCount > 0 ? `Cart, ${cartCount} ${cartCount === 1 ? 'item' : 'items'}` : 'Cart, 0 items'}
                  >
                    <ShoppingCart size={20} />
                    {cartCount > 0 && (
                      <span className={styles.badge} aria-hidden="true">
                        {cartCount > 99 ? '99+' : cartCount}
                      </span>
                    )}
                  </Link>

                  <Link
                    to="/wishlist"
                    className={styles.iconButton}
                    aria-label={wishlistCount > 0 ? `Wishlist (${wishlistCount})` : 'Wishlist'}
                  >
                    <Heart
                      size={20}
                      className={wishlistCount > 0 ? styles.heartActive : ''}
                    />
                    {wishlistCount > 0 && (
                      <span className={styles.badge} aria-hidden="true">
                        {wishlistCount > 99 ? '99+' : wishlistCount}
                      </span>
                    )}
                  </Link>

                  {/* Unauthenticated — Account icon */}
                  {isInitializing && !rememberedUser && (
                    <button type="button" className={styles.iconButton} aria-label="Restoring account" disabled>
                      <UserIcon size={20} />
                    </button>
                  )}
                  {!isInitializing && !isAuthenticated && (
                    <button
                      type="button"
                      className={styles.iconButton}
                      aria-label="Account"
                      onClick={() => {
                        setAuthReturnTo(undefined);
                        setAuthMode('login');
                        setShowAuthModal(true);
                      }}
                    >
                      <UserIcon size={20} />
                    </button>
                  )}

                  {/* Authenticated — Avatar dropdown */}
                  {showAuthenticatedHeader && headerUser && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          className={styles.avatarButton}
                          aria-label={`Account menu for ${headerUser.firstName} ${headerUser.lastName}`}
                          disabled={isInitializing}
                        >
                          <Avatar initials={getInitials(headerUser.firstName, headerUser.lastName)} />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className={styles.dropdown}>
                        <div className={styles.userInfo}>
                          <p className={styles.userName}>{headerUser.firstName} {headerUser.lastName}</p>
                          {user && <p className={styles.userEmail}>{user.email}</p>}
                        </div>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem asChild>
                          <Link to="/account" className={styles.dropdownLink}>
                            <UserIcon size={15} aria-hidden="true" />
                            <span>My Account</span>
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild>
                          <Link to="/account/profile" className={styles.dropdownLink}>
                            <UserIcon size={15} aria-hidden="true" />
                            <span>My Profile</span>
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild>
                          <Link to="/orders" className={styles.dropdownLink}>
                            <Package size={15} aria-hidden="true" />
                            <span>My Orders</span>
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuItem asChild>
                          <Link to="/wishlist" className={styles.dropdownLink}>
                            <Heart size={15} aria-hidden="true" />
                            <span>Wishlist</span>
                          </Link>
                        </DropdownMenuItem>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          variant="destructive"
                          onClick={() => setShowSignOut(true)}
                          className={styles.logoutItem}
                        >
                          <LogOut size={15} aria-hidden="true" />
                          <span>Sign Out</span>
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}

            </div>
          </div>
        </div>

        {/* ─── Mobile Vertical Expanded Sidebar (4 Items Only) ───────── */}
        {isMobileMenuOpen && (
          <nav
            id="mobile-nav"
            className={styles.mobileMenu}
            aria-label="Mobile Navigation"
          >
            <NavLink to="/" end className={mobileNavClass} onClick={closeMobileMenu}>
              Home
            </NavLink>
            <NavLink to="/products" className={mobileNavClass} onClick={closeMobileMenu}>
              Products
            </NavLink>
            {showAuthenticatedHeader && (
              <NavLink to="/orders" className={mobileNavClass} onClick={closeMobileMenu}>
                Orders
              </NavLink>
            )}
            <NavLink to="/about" className={mobileNavClass} onClick={closeMobileMenu}>About</NavLink>
            <NavLink to="/contact" className={mobileNavClass} onClick={closeMobileMenu}>Contact</NavLink>
          </nav>
        )}
      </header>

      {/* Auth Modals */}
      <AuthModal
        open={showAuthModal}
        onOpenChange={setShowAuthModal}
        onAuthenticated={closeMobileMenu}
        initialMode={authMode}
        returnTo={authReturnTo}
      />
      <SignOutModal
        open={showSignOut}
        onOpenChange={open => {
          setShowSignOut(open);
          if (!open && mobileSignOut.current) {
            mobileSignOut.current = false;
            requestAnimationFrame(() => mobileMenuToggle.current?.focus());
          }
        }}
      />
    </>
  );
}
