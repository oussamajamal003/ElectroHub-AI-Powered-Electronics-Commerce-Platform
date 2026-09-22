import { useState, useEffect, useRef, useCallback } from 'react';
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
  ChevronLeft,
  Package,
} from 'lucide-react';
import { Avatar } from '@/components/ui/Avatar';
import { Input } from '@/components/ui/Input';
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
} from '@/components/ui/DropdownMenu';
import { useAuth } from '@/features/auth/context/AuthContext';
import { AuthModal, AuthModalMode } from '@/features/auth/components/AuthModal';
import { SignOutModal } from '@/features/auth/components/SignOutModal';
import styles from './CustomerHeader.module.scss';

export interface CustomerHeaderProps {
  cartCount?: number;
  wishlistCount?: number;
}

export function CustomerHeader({ cartCount = 0, wishlistCount = 0 }: CustomerHeaderProps) {
  const { user, isAuthenticated, isInitializing } = useAuth();
  const navigate = useNavigate();

  // Auth modals
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [authMode, setAuthMode] = useState<AuthModalMode>('login');
  const [showSignOut, setShowSignOut] = useState(false);

  // Mobile menu
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  // Search expansion
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const searchInputRef = useRef<HTMLInputElement>(null);

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

  // Close mobile menu or search on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isMobileMenuOpen) setIsMobileMenuOpen(false);
        if (isSearchOpen) {
          setIsSearchOpen(false);
          setSearchQuery('');
        }
      }
    };
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [isMobileMenuOpen, isSearchOpen]);

  // Focus search input when opened
  useEffect(() => {
    if (isSearchOpen) {
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
  }, [isSearchOpen]);

  const getInitials = (firstName: string, lastName: string) => {
    return `${firstName?.[0] || ''}${lastName?.[0] || ''}`.toUpperCase();
  };

  const closeMobileMenu = useCallback(() => {
    setIsMobileMenuOpen(false);
  }, []);

  const handleSearchOpen = () => {
    setIsSearchOpen(true);
    setIsMobileMenuOpen(false);
  };

  const handleSearchClose = () => {
    setIsSearchOpen(false);
    setSearchQuery('');
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(`/products?search=${encodeURIComponent(searchQuery.trim())}`);
      handleSearchClose();
    }
  };

  const handleAccountClick = (e: React.MouseEvent) => {
    if (!isAuthenticated) {
      e.preventDefault();
      setAuthMode('login');
      setShowAuthModal(true);
    }
  };

  const handleMobileAccountClick = (e: React.MouseEvent) => {
    closeMobileMenu();
    if (!isAuthenticated) {
      e.preventDefault();
      setAuthMode('login');
      setShowAuthModal(true);
    } else {
      navigate('/account');
    }
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
        {/* ─── Subtle Promotional Utility Row ──────────────────────── */}
        <div className={styles.utilityRow} role="region" aria-label="Announcement">
          <p className={styles.utilityText}>
            Free delivery on orders over $100
          </p>
        </div>

        <div className={styles.container}>
          <div
            className={`${styles.headerMainContent} ${
              isSearchOpen ? styles.searchActive : ''
            }`}
          >
            {/* LEFT — Mobile Toggle + Brand */}
            <div className={styles.leftSection}>
              <button
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
                <span className={styles.logoText}>ElectroHub</span>
              </Link>
            </div>

            {/* CENTER — Desktop Navigation */}
            <nav className={styles.navigation} aria-label="Primary navigation">
              <NavLink to="/" end className={navLinkClass}>Home</NavLink>
              <NavLink to="/products" className={navLinkClass}>Products</NavLink>
              <NavLink to="/orders" className={navLinkClass}>Orders</NavLink>
              <NavLink
                to="/account"
                className={navLinkClass}
                onClick={handleAccountClick}
              >
                Account
              </NavLink>
            </nav>

            {/* RIGHT — Utility Icons + Avatar + Unified Search */}
            <div className={styles.actions}>
              {isSearchOpen ? (
                <form
                  className={styles.searchForm}
                  onSubmit={handleSearchSubmit}
                  role="search"
                >
                  <button
                    type="button"
                    className={styles.searchBackButton}
                    onClick={handleSearchClose}
                    aria-label="Close search"
                  >
                    <ChevronLeft size={20} />
                  </button>
                  <Input
                    ref={searchInputRef}
                    type="search"
                    placeholder="Search products..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    aria-label="Search products"
                    inputSize="medium"
                    fullWidth
                    endAdornment={
                      searchQuery ? (
                        <button
                          type="button"
                          className={styles.searchClearButton}
                          onClick={() => setSearchQuery('')}
                          aria-label="Clear search"
                        >
                          <X size={14} />
                        </button>
                      ) : null
                    }
                  />
                </form>
              ) : (
                <>
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
                    aria-label={cartCount > 0 ? `Cart (${cartCount})` : 'Cart'}
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
                  {!isInitializing && !isAuthenticated && (
                    <button
                      type="button"
                      className={styles.iconButton}
                      aria-label="Account"
                      onClick={() => {
                        setAuthMode('login');
                        setShowAuthModal(true);
                      }}
                    >
                      <UserIcon size={20} />
                    </button>
                  )}

                  {/* Authenticated — Avatar dropdown */}
                  {!isInitializing && isAuthenticated && user && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <button
                          className={styles.avatarButton}
                          aria-label={`Account menu for ${user.firstName} ${user.lastName}`}
                        >
                          <Avatar initials={getInitials(user.firstName, user.lastName)} />
                        </button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end" className={styles.dropdown}>
                        <div className={styles.userInfo}>
                          <p className={styles.userName}>{user.firstName} {user.lastName}</p>
                          <p className={styles.userEmail}>{user.email}</p>
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
                </>
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
            <NavLink to="/orders" className={mobileNavClass} onClick={closeMobileMenu}>
              Orders
            </NavLink>
            <NavLink
              to="/account"
              className={mobileNavClass}
              onClick={handleMobileAccountClick}
            >
              Account
            </NavLink>
          </nav>
        )}
      </header>

      {/* Auth Modals */}
      <AuthModal
        open={showAuthModal}
        onOpenChange={setShowAuthModal}
        initialMode={authMode}
      />
      <SignOutModal
        open={showSignOut}
        onOpenChange={setShowSignOut}
      />
    </>
  );
}
