import { BarChart3, Boxes, FolderTree, LayoutDashboard, Package, Settings, ShoppingCart, Sparkles, Truck, Users, type LucideIcon } from 'lucide-react';

export interface AdminNavItem { to: string; label: string; icon: LucideIcon; /** Exact match only (the dashboard root). */ end?: boolean }
export interface AdminNavSection { label: string; items: AdminNavItem[] }

/**
 * Single source of truth for the admin console navigation. Every entry is an implemented page (05.1 operations, 05.2 growth and
 * administration); personal Profile/Security/Sessions live in the avatar menu, not here.
 */
export const ADMIN_NAVIGATION: AdminNavSection[] = [
  { label: 'Main', items: [
    { to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true },
    { to: '/admin/products', label: 'Products', icon: Package },
    { to: '/admin/categories', label: 'Categories', icon: FolderTree },
    { to: '/admin/inventory', label: 'Inventory', icon: Boxes },
  ] },
  { label: 'Operations', items: [
    { to: '/admin/orders', label: 'Orders', icon: ShoppingCart },
    { to: '/admin/deliveries', label: 'Delivery', icon: Truck },
    { to: '/admin/customers', label: 'Customers', icon: Users },
  ] },
  { label: 'Growth & Insights', items: [
    { to: '/admin/recommendations', label: 'Recommendations', icon: Sparkles },
    { to: '/admin/analytics', label: 'Analytics', icon: BarChart3 },
  ] },
  { label: 'Administration', items: [
    { to: '/admin/settings', label: 'Settings', icon: Settings },
  ] },
];

export const SIDEBAR_PREFERENCE_KEY = 'electrohub:admin-sidebar-collapsed';
