import { Boxes, FolderTree, LayoutDashboard, Package, ShoppingCart, Truck, Users, type LucideIcon } from 'lucide-react';

export interface AdminNavItem { to: string; label: string; icon: LucideIcon; /** Exact match only (the dashboard root). */ end?: boolean }
export interface AdminNavSection { label: string; items: AdminNavItem[] }

/**
 * Single source of truth for the admin console navigation. Only implemented 05.1 modules are listed: Analytics and Settings
 * (Task 05.2) are deliberately absent rather than shown as inert links.
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
];

export const SIDEBAR_PREFERENCE_KEY = 'electrohub:admin-sidebar-collapsed';
