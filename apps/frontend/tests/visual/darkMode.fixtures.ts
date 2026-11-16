import type { Page, Route } from '@playwright/test';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cachedUserKey, emptyCartRecommendations, emptyWishlist, noSavedPurchases, refreshedSession } from '../../src/test/e2eApiFixtures';
import { categoriesFixture, customersFixture, deliveriesFixture, imageSearchFixture, inventoryFixture, overviewFixture, productsFixture,
  recommendationsFixture } from '../../src/features/admin/analytics/fixtures';

/**
 * Synthetic API for the dark-mode suite. Every /api request is answered in the browser: no backend, no DEV database,
 * no payment provider. Catalog content comes from the seed dataset in apps/backend/prisma/data (same as catalog.visual).
 */
const filename = fileURLToPath(import.meta.url);
const dataset = JSON.parse(readFileSync(path.resolve(path.dirname(filename), '../../../backend/prisma/data/products.json'), 'utf8')) as {
  categories: { name: string; slug: string; description: string }[];
  brands: { name: string; slug: string }[];
  products: { name: string; slug: string; sku: string; categorySlug: string; brandSlug: string; description: string; modelNumber: string | null;
    price: string; compareAtPrice: string | null; quantity: number; images: { url: string }[];
    specifications: { group: string; name: string; value: string; sortOrder: number }[] }[];
};

const NOW = '2026-11-05T12:00:00.000Z';
const category = (slug: string) => dataset.categories.find(item => item.slug === slug)!;
const brand = (slug: string) => dataset.brands.find(item => item.slug === slug)!;
const image = (slug: string, detail = false) => `/images/catalog/${slug}${detail ? '-detail' : ''}.jpg`;

export const summaries = dataset.products.map((product, index) => ({
  id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
  name: product.name, slug: product.slug, description: product.description.slice(0, 160), price: product.price,
  compareAtPrice: product.compareAtPrice, discountPercent: product.compareAtPrice && Number(product.compareAtPrice) > Number(product.price)
    ? Math.round((Number(product.compareAtPrice) - Number(product.price)) / Number(product.compareAtPrice) * 100) : null,
  averageRating: index % 5 === 0 ? null : (3.5 + index % 3 / 2).toFixed(1), reviewCount: index % 5 === 0 ? 0 : 3 + index * 2,
  currency: 'USD', availability: product.quantity > 0 ? 'AVAILABLE' : 'UNAVAILABLE',
  ...(product.quantity > 0 ? {} : { stockStatus: 'OUT_OF_STOCK' as const }),
  category: { id: product.categorySlug, name: category(product.categorySlug).name, slug: product.categorySlug },
  brand: { id: product.brandSlug, name: brand(product.brandSlug).name, slug: product.brandSlug },
  primaryImage: { id: `image-${index}`, url: image(product.categorySlug, index % 2 === 1), altText: `${product.categorySlug} studio photograph`, sortOrder: 0, isPrimary: true },
  secondaryImage: { id: `image-alt-${index}`, url: image(product.categorySlug, index % 2 === 0), altText: `${product.categorySlug} alternate photograph`, sortOrder: 1, isPrimary: false },
}));

export const CUSTOMER = { id: 'dark-mode-customer', role: 'CUSTOMER' as const, firstName: 'Dana', lastName: 'Dark', email: 'dana.dark@example.test',
  emailVerified: true };
export const ADMIN = { id: '8f2813b4-a388-44d3-b51e-5d4c40386677', email: 'qa.admin@example.test', role: 'ADMIN', firstName: 'QA',
  lastName: 'Administrator', emailVerified: true, isOwner: true, canManageAdmins: true };
const ADMIN_TOKEN = 'qa-admin-access-token';

const orderRows = ['CONFIRMED', 'PREPARING', 'OUT_FOR_DELIVERY', 'DELIVERED', 'CANCELLED', 'PENDING_PAYMENT'].map((status, index) => ({
  orderReference: `ORD-DARK-${1000 + index}`, status, paymentState: status === 'PENDING_PAYMENT' ? 'PENDING' : status === 'CANCELLED' ? 'REFUNDED' : 'PAID',
  total: (149.99 + index * 87.5).toFixed(2), currency: 'USD', createdAt: `2026-11-0${index + 1}T10:00:00.000Z`, deliveryMethod: index % 2 ? 'EXPRESS' : 'STANDARD',
  itemCount: index + 1, customer: { id: `customer-${index}`, name: ['Ava Stone', 'Liam Park', 'Noah Reed', 'Mia Chen', 'Zoe Hart', 'Eli Fox'][index],
    email: `customer${index}@example.test` }, delivery: status === 'OUT_FOR_DELIVERY' ? { trackingReference: 'TRK-DARK-1', revision: 2 } : null,
}));
const listMeta = (total: number, extra: object = {}) => ({ page: 1, pageSize: 20, total, totalPages: total ? 1 : 0, ...extra });
const adminProducts = summaries.slice(0, 12).map((product, index) => ({
  id: product.id, name: product.name, sku: dataset.products[index].sku, slug: product.slug, price: product.price, compareAtPrice: product.compareAtPrice,
  currency: 'USD', status: index === 4 ? 'INACTIVE' : 'ACTIVE', category: { id: product.category.id, name: product.category.name, isActive: true },
  brand: { id: product.brand.id, name: product.brand.name }, image: { url: product.primaryImage.url, altText: product.name }, imageCount: 2,
  inventory: { quantity: [24, 3, 0, 58][index % 4], lowStockAt: 5, status: ['IN_STOCK', 'LOW_STOCK', 'OUT_OF_STOCK', 'IN_STOCK'][index % 4], updatedAt: NOW },
  storefrontVisible: index !== 4, createdAt: NOW, updatedAt: NOW, deletable: false, deleteBlocker: 'Has order history',
}));
const inventoryRows = adminProducts.map(product => ({ productId: product.id, name: product.name, sku: product.sku, productStatus: product.status,
  category: product.category, image: product.image, quantity: product.inventory.quantity, held: 0, lowStockAt: 5, stockStatus: product.inventory.status,
  purchasable: product.inventory.quantity > 0, updatedAt: NOW }));
const dashboard = { generatedAt: NOW, window: { days: 30, since: '2026-10-06T00:00:00.000Z', timezone: 'UTC' },
  revenue: [{ currency: 'USD', amount: '12840.50', payments: 64 }],
  revenueSeries: Array.from({ length: 30 }, (_, index) => ({ currency: 'USD', amount: (180 + Math.round(Math.sin(index / 3) * 120 + index * 9)).toFixed(2),
    day: new Date(Date.UTC(2026, 9, 7 + index)).toISOString().slice(0, 10), payments: 2 + index % 4 })),
  orders: { total: 312, inWindow: 64, byStatus: { CONFIRMED: 9, PREPARING: 6, OUT_FOR_DELIVERY: 4, DELIVERED: 41, CANCELLED: 4 } },
  products: { total: 120, sellable: 112 }, customers: { total: 845, active: 790 },
  inventory: { inStock: 96, lowStock: 9, outOfStock: 3, untracked: 12, attention: inventoryRows.filter(row => row.stockStatus !== 'IN_STOCK').slice(0, 4)
    .map(row => ({ productId: row.productId, name: row.name, sku: row.sku, quantity: row.quantity ?? 0, lowStockAt: 5, stockStatus: row.stockStatus! })) },
  fulfillment: { awaitingFulfillment: 9, preparing: 6, outForDelivery: 4 },
  trends: { revenue: [{ currency: 'USD', current: '12840.50', previous: '10230.00', today: '412.00' }],
    orders: { current: 64, previous: 51, today: 3 }, products: { current: 8, previous: 5, today: 0 }, customers: { current: 72, previous: 80, today: 2 } },
  recentOrders: orderRows };
const customerRows = orderRows.map((order, index) => ({ id: order.customer.id, name: order.customer.name, email: order.customer.email,
  status: index === 4 ? 'SUSPENDED' : 'ACTIVE', emailVerified: true, createdAt: NOW, updatedAt: NOW, orderCount: index + 2,
  lastOrderAt: order.createdAt, paidSpend: [{ currency: 'USD', amount: order.total }] }));
const adminProfile = { ...ADMIN, capabilities: { isOwner: true, canManageAdmins: true }, stepUpUntil: null, deletion: { allowed: false, reason: 'LAST_OWNER' } };

type Mode = { customer?: boolean; admin?: boolean };

/** Installs the synthetic API. `customer`/`admin` decide which session the refresh endpoints restore. */
export async function installDarkModeApi(page: Page, mode: Mode = {}) {
  if (mode.customer) await page.addInitScript(([key, user]) => { window.sessionStorage.setItem(key, JSON.stringify(user)); }, [cachedUserKey, CUSTOMER] as const);
  const respond = (route: Route, body: unknown, status = 200) => route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) });
  await page.route(url => new URL(url).pathname.startsWith('/api/'), async route => {
    const request = route.request();
    const url = new URL(request.url());
    const p = url.pathname;
    // Sessions
    if (p === '/api/auth/customer/refresh') return mode.customer ? respond(route, refreshedSession(CUSTOMER)) : respond(route, { error: 'Unauthenticated' }, 401);
    if (p === '/api/auth/admin/refresh') return mode.admin ? respond(route, { accessToken: ADMIN_TOKEN, user: ADMIN }) : respond(route, { error: 'Unauthenticated' }, 401);
    if (p === '/api/auth/me') return mode.customer ? respond(route, { user: CUSTOMER }) : respond(route, { error: 'Unauthenticated' }, 401);
    if (p.startsWith('/api/auth/')) return respond(route, { error: { code: 'UNAUTHENTICATED', message: 'Unauthenticated' } }, 401);
    // Customer commerce
    if (p === '/api/cart') {
      const items = summaries.slice(0, 2).map((product, index) => ({ id: `line-${index}`, productId: product.id, quantity: index + 1,
        product: { slug: product.slug, name: product.name, category: product.category.name, price: product.price, image: { url: product.primaryImage.url, altText: product.name } },
        availableQuantity: 10, stockStatus: 'IN_STOCK' as const, availability: 'AVAILABLE' as const, lineTotal: (Number(product.price) * (index + 1)).toFixed(2) }));
      const subtotal = items.reduce((sum, item) => sum + Number(item.lineTotal), 0).toFixed(2);
      return respond(route, { data: { revision: 'dark-1', items, totalQuantity: 3, subtotal, shipping: '0.00', total: subtotal, currency: 'USD', canCheckout: true } });
    }
    if (p === '/api/wishlist') return respond(route, emptyWishlist);
    if (p === '/api/recommendations/cart') return respond(route, emptyCartRecommendations);
    if (p === '/api/checkout/payment-attempts') return respond(route, noSavedPurchases);
    if (p === '/api/orders') return respond(route, { data: [], meta: listMeta(0) });
    // Catalog
    if (p === '/api/categories') return respond(route, { data: dataset.categories.map(item => ({ ...item, id: item.slug, imageUrl: image(item.slug),
      productCount: summaries.filter(product => product.category.slug === item.slug).length })), meta: listMeta(dataset.categories.length) });
    if (p === '/api/brands') return respond(route, { data: dataset.brands.map(item => ({ ...item, id: item.slug })), meta: listMeta(dataset.brands.length) });
    if (p === '/api/products/deals') { const data = summaries.filter(item => item.discountPercent !== null).slice(0, 6); return respond(route, { data, meta: listMeta(data.length) }); }
    if (/^\/api\/products\/[^/]+\/reviews/.test(p)) return respond(route, p.endsWith('/me') ? { data: null }
      : { data: [{ id: 'review-1', rating: 5, body: 'Crisp display, excellent battery life.', createdAt: NOW, author: { displayName: 'Verified buyer' } }],
        summary: { averageRating: '5.0', reviewCount: 1 }, meta: listMeta(1) });
    if (/^\/api\/products\/[^/]+\/recommendations$/.test(p)) return respond(route, { data: { sections: [] } });
    if (p.startsWith('/api/products/')) {
      const slug = decodeURIComponent(p.split('/')[3] ?? '');
      const source = dataset.products.find(item => item.slug === slug); const summary = summaries.find(item => item.slug === slug);
      if (!source || !summary) return respond(route, { error: { code: 'PRODUCT_NOT_FOUND', message: 'Product not found.' } }, 404);
      return respond(route, { data: { ...summary, description: source.description, sku: source.sku, modelNumber: source.modelNumber,
        images: [0, 1].map(index => ({ id: `detail-${index}`, url: image(source.categorySlug, index === 1), altText: `${source.name} view ${index + 1}`, sortOrder: index, isPrimary: index === 0 })),
        specifications: [...new Set(source.specifications.map(item => item.group))].map(group => ({ group,
          items: source.specifications.filter(item => item.group === group).map((item, index) => ({ id: `${group}-${index}`, ...item })) })) } });
    }
    if (p === '/api/products' || p === '/api/search/products') {
      const q = (url.searchParams.get('q') ?? '').toLowerCase();
      const filtered = summaries.filter(product => !q || product.name.toLowerCase().includes(q));
      const pageSize = Number(url.searchParams.get('pageSize') ?? '20');
      return respond(route, { data: filtered.slice(0, pageSize), meta: { page: 1, pageSize, total: filtered.length, totalPages: Math.ceil(filtered.length / pageSize) } });
    }
    // Admin console
    if (p.startsWith('/api/admin/') && request.headers().authorization !== `Bearer ${ADMIN_TOKEN}`) return respond(route, { error: 'Forbidden' }, 403);
    if (p === '/api/admin/dashboard/alerts') return respond(route, { data: { lowStock: 9, outOfStock: 3, awaitingFulfillment: 9, preparing: 6, outForDelivery: 4, generatedAt: NOW } });
    if (p === '/api/admin/dashboard/overview') return respond(route, { data: dashboard });
    if (p === '/api/admin/catalog/products') return respond(route, { data: adminProducts, meta: listMeta(adminProducts.length) });
    if (p === '/api/admin/catalog/options') return respond(route, { data: { categories: dataset.categories.map(item => ({ id: item.slug, name: item.name, isActive: true })),
      brands: dataset.brands.map(item => ({ id: item.slug, name: item.name })), pairs: [] } });
    if (p.startsWith('/api/admin/catalog/products/')) return respond(route, { data: { ...adminProducts[0], description: dataset.products[0].description,
      modelNumber: dataset.products[0].modelNumber, orderLineCount: 3, specifications: dataset.products[0].specifications.slice(0, 4) } });
    if (p === '/api/admin/inventory') return respond(route, { data: inventoryRows, meta: listMeta(inventoryRows.length, { summary: { inStock: 6, lowStock: 3, outOfStock: 3, untracked: 0 } }) });
    if (p === '/api/admin/orders') return respond(route, { data: orderRows, meta: listMeta(orderRows.length, { statusCounts: { CONFIRMED: 1, PREPARING: 1, DELIVERED: 1 } }) });
    if (p === '/api/admin/customers') return respond(route, { data: customerRows, meta: listMeta(customerRows.length, { summary: { total: 6, active: 5, paidRevenue: [{ currency: 'USD', amount: '1842.47' }] } }) });
    if (p === '/api/admin/me/profile') return respond(route, { data: adminProfile });
    if (p === '/api/admin/me/security/factors') return respond(route, { data: { totp: [{ id: 'totp-1', label: 'Authenticator app', createdAt: NOW, lastUsedAt: NOW }],
      passkeys: [], recoveryCodes: { remaining: 8, generatedAt: NOW } } });
    if (p === '/api/admin/me/sessions') return respond(route, { data: [{ id: 'session-1', current: true, device: 'Chrome on Linux', ipMasked: '203.0.113.x',
      createdAt: NOW, lastActiveAt: NOW, mfaMethod: 'TOTP' }], meta: listMeta(1) });
    if (p === '/api/admin/me/login-history') return respond(route, { data: [{ id: 'event-1', event: 'LOGIN', outcome: 'SUCCESS', device: 'Chrome on Linux',
      ipMasked: '203.0.113.x', occurredAt: NOW }], meta: listMeta(1) });
    if (p === '/api/admin/me/notification-preferences') return respond(route, { data: { orderPaid: true, lowStock: true, invitationAccepted: true, version: 3 } });
    if (p === '/api/admin/settings/store') return respond(route, { data: { storeName: 'ElectroHub', supportEmail: 'help@example.test', supportPhone: '+1 555 0100',
      addressLine1: '123 Commerce Street', addressLine2: null, city: 'New York', region: 'NY', postalCode: '10001', country: 'United States',
      timezone: 'America/New_York', currency: 'USD', version: 4, updatedAt: NOW } });
    if (p === '/api/admin/settings/shipping') return respond(route, { data: { version: 2, currency: 'USD', freeShippingThreshold: '50.00', methods: [
      { method: 'STANDARD', label: 'Standard Delivery', enabled: true, price: '5.00', minDays: 5, maxDays: 7, estimate: '5-7 business days' },
      { method: 'EXPRESS', label: 'Express Delivery', enabled: true, price: '9.99', minDays: 2, maxDays: 3, estimate: '2-3 business days' }] } });
    if (p === '/api/admin/recommendations/overview') return respond(route, { data: { period: '30d', since: '2026-10-06T00:00:00.000Z',
      totals: { impressions: 1840, clicks: 132, ctr: 0.0717, fallbackImpressions: 210, fallbackShare: 0.114 }, breakdown: [] } });
    if (p === '/api/admin/categories') return respond(route, { data: dataset.categories.map(item => ({ id: item.slug, name: item.name, slug: item.slug,
      description: item.description, isActive: true, productCount: 8, createdAt: NOW, updatedAt: NOW })), meta: listMeta(dataset.categories.length) });
    const analytics: Record<string, unknown> = { overview: overviewFixture, products: productsFixture, categories: categoriesFixture, inventory: inventoryFixture,
      recommendations: recommendationsFixture, 'image-search': imageSearchFixture, deliveries: deliveriesFixture, customers: customersFixture };
    const report = p.match(/^\/api\/admin\/analytics\/([^/]+)$/)?.[1];
    if (report && analytics[report]) return respond(route, analytics[report]);
    // Anything else (optional panels): an inert empty list keeps the page in its themed empty/error state.
    return respond(route, { data: [], meta: listMeta(0) });
  });
}
