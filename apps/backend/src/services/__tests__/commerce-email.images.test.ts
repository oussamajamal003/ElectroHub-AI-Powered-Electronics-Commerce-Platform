/**
 * Task 03.8 email image origins (F-02) and loopback origin policy (F-04). Pure/mocked: no database, no provider.
 */
import { Prisma } from '@prisma/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { commerceEmailConfig, safeEmailImageUrl, trustedOrigin, type ImageSources } from '../commerce-email.config.js';
import { enqueuePaymentSucceeded } from '../commerce-email.producer.js';
import { commerceEmailSnapshot } from '../commerce-email.domain.js';
import { renderCommerceEmail } from '../../emails/commerce/templates.js';
import { assertTrustedOrigin } from '../../emails/commerce/escape.js';

const production: ImageSources = { hosts: ['yepfgjehdstlxbpespun.supabase.co', 'shop.example.test', 'res.cloudinary.com'], cloudinaryCloud: 'demo-cloud', allowLoopbackHttp: false };
const development: ImageSources = { hosts: ['pzxekjybdiulzmssalfo.supabase.co', 'localhost'], cloudinaryCloud: null, allowLoopbackHttp: true };
const approved = 'https://yepfgjehdstlxbpespun.supabase.co/storage/v1/object/public/product-media/products/p/i/r/phone.webp';
const historicalCloudinary = 'https://res.cloudinary.com/demo-cloud/image/upload/v1710000000/products/phone.webp';

describe('safeEmailImageUrl: approved asset origins only', () => {
  it('accepts a real approved HTTPS image and keeps it unchanged', () => {
    expect(safeEmailImageUrl(approved, production)).toBe(approved);
    expect(safeEmailImageUrl(historicalCloudinary, production)).toBe(historicalCloudinary);
    expect(safeEmailImageUrl('https://shop.example.test/products/phone.jpg', production)).toBe('https://shop.example.test/products/phone.jpg');
  });
  it('rejects an unapproved HTTPS host, including lookalikes and subdomains', () => {
    for (const value of ['https://evil.example/phone.jpg', 'https://yepfgjehdstlxbpespun.supabase.co.evil.example/a.jpg',
      'https://evil.yepfgjehdstlxbpespun.supabase.co/a.jpg', 'https://shop.example.test.evil.example/a.jpg']) expect(safeEmailImageUrl(value, production)).toBeNull();
  });
  it('rejects unapproved project hosts on the shared storage platform', () => {
    expect(safeEmailImageUrl('https://otherproject.supabase.co/storage/v1/object/public/product-media/a.webp', production)).toBeNull();
    expect(safeEmailImageUrl('https://yepfgjehdstlxbpespunx.supabase.co/storage/v1/object/public/product-media/a.webp', production)).toBeNull();
  });
  it('rejects wrong Cloudinary clouds, non-image resources, lookalike hosts, and unconfigured delivery hosts', () => {
    for (const value of [
      'https://res.cloudinary.com/another-cloud/image/upload/products/phone.webp',
      'https://res.cloudinary.com/demo-cloudx/image/upload/products/phone.webp',
      'https://res.cloudinary.com/demo-cloud/video/upload/products/phone.webp',
      'https://res.cloudinary.com/demo-cloud/raw/upload/products/phone.webp',
      'https://res.cloudinary.com.evil.example/demo-cloud/image/upload/products/phone.webp',
    ]) expect(safeEmailImageUrl(value, production)).toBeNull();
    expect(safeEmailImageUrl(historicalCloudinary, { hosts: ['res.cloudinary.com'], cloudinaryCloud: null, allowLoopbackHttp: false })).toBeNull();
  });
  it('rejects plain http in deployed environments and dangerous or unsupported schemes', () => {
    for (const value of ['http://shop.example.test/a.jpg', 'javascript:alert(1)', 'data:image/png;base64,AAAA', 'file:///etc/passwd',
      'ftp://shop.example.test/a.jpg', '//shop.example.test/a.jpg', '/products/a.jpg', 'products/a.jpg']) expect(safeEmailImageUrl(value, production)).toBeNull();
  });
  it('allows http only for an approved loopback host outside production', () => {
    expect(safeEmailImageUrl('http://localhost/a.jpg', development)).toBe('http://localhost/a.jpg');
    expect(safeEmailImageUrl('http://localhost:5173/a.jpg', development)).toBe('http://localhost:5173/a.jpg');
    expect(safeEmailImageUrl('http://localhost/a.jpg', { ...development, allowLoopbackHttp: false })).toBeNull();
    expect(safeEmailImageUrl('http://127.0.0.1/a.jpg', development)).toBeNull(); // loopback but not an approved host
  });
  it('rejects credentials, odd ports on deployed hosts, malformed and oversized values, and markup/quote characters', () => {
    for (const value of ['https://user:pass@yepfgjehdstlxbpespun.supabase.co/a.jpg', 'https://user@yepfgjehdstlxbpespun.supabase.co/a.jpg',
      'https://yepfgjehdstlxbpespun.supabase.co:8443/a.jpg', 'https://', 'not a url', '', `${approved}"onerror="x`, `${approved}'`, `${approved}<`, `${approved} x`,
      `${approved}\\x`, `https://yepfgjehdstlxbpespun.supabase.co/${'a'.repeat(2100)}.jpg`]) expect(safeEmailImageUrl(value, production)).toBeNull();
    expect(safeEmailImageUrl(null, production)).toBeNull();
    expect(safeEmailImageUrl(undefined, production)).toBeNull();
  });
});

describe('approved sources come from real configuration only', () => {
  const base = { NODE_ENV: 'production', COMMERCE_EMAIL_ORIGIN: 'https://shop.example.test' };
  it('defaults to the trusted origin host and nothing else', () => {
    expect(commerceEmailConfig({ ...base }).imageSources).toEqual({ hosts: ['shop.example.test'], cloudinaryCloud: null, allowLoopbackHttp: false });
  });
  it('restores the prior configured-cloud rule without exposing Cloudinary credentials', () => {
    const sources = commerceEmailConfig({ ...base, CLOUDINARY_URL: 'cloudinary://111:topsecret@Demo-Cloud' }).imageSources;
    expect(sources.hosts).toContain('res.cloudinary.com');
    expect(sources.cloudinaryCloud).toBe('demo-cloud');
    expect(JSON.stringify(sources)).not.toMatch(/topsecret|111/);
    expect(commerceEmailConfig({ ...base, CLOUDINARY_URL: 'malformed' }).imageSources.hosts).not.toContain('res.cloudinary.com');
  });
  it('preserves configured Supabase purchase snapshot images without accepting a different project', () => {
    const ref = 'yepfgjehdstlxbpespun';
    const sources = commerceEmailConfig({ ...base, SUPABASE_URL: `https://${ref}.supabase.co`, SUPABASE_PROJECT_REF: ref }).imageSources;
    const snapshot = `https://${ref}.supabase.co/storage/v1/object/public/product-media/products/p/i/r/original.webp`;
    expect(safeEmailImageUrl(snapshot, sources)).toBe(snapshot);
    expect(safeEmailImageUrl(snapshot, commerceEmailConfig({ ...base,
      SUPABASE_URL: 'https://pzxekjybdiulzmssalfo.supabase.co', SUPABASE_PROJECT_REF: ref }).imageSources)).toBeNull();
    expect(JSON.stringify(sources)).not.toMatch(/service_role|sb_secret_/);
  });
  it('adds the configured development Supabase storage host without accepting mismatched project refs', () => {
    const devRef = 'pzxekjybdiulzmssalfo';
    const devBase = { NODE_ENV: 'development', COMMERCE_EMAIL_ORIGIN: 'http://localhost:5173' };
    const sources = commerceEmailConfig({ ...devBase, SUPABASE_URL: `https://${devRef}.supabase.co`, SUPABASE_PROJECT_REF: devRef }).imageSources;
    expect(sources.hosts).toContain(`${devRef}.supabase.co`);
    expect(commerceEmailConfig({ ...devBase, SUPABASE_URL: 'garbage', SUPABASE_PROJECT_REF: devRef }).imageSources.hosts).not.toContain(`${devRef}.supabase.co`);
  });
  it('accepts an explicit operator list of hostnames and rejects malformed entries', () => {
    expect(commerceEmailConfig({ ...base, COMMERCE_EMAIL_IMAGE_HOSTS: 'Cdn.Example.test, img.example.test' }).imageSources.hosts)
      .toEqual(expect.arrayContaining(['cdn.example.test', 'img.example.test']));
    expect(() => commerceEmailConfig({ ...base, COMMERCE_EMAIL_IMAGE_HOSTS: 'https://cdn.example.test' })).toThrow(/COMMERCE_EMAIL_IMAGE_HOSTS/);
    expect(() => commerceEmailConfig({ ...base, COMMERCE_EMAIL_IMAGE_HOSTS: '*.example.test' })).toThrow(/COMMERCE_EMAIL_IMAGE_HOSTS/);
  });
});

describe('loopback origins: one policy in config and renderer (IPv6 loopback unsupported in both)', () => {
  it.each(['http://localhost:5173', 'http://127.0.0.1:5173', 'http://[::1]:5173', 'https://shop.example.test', 'http://shop.example.test'])(
    'config and renderer agree on %s', value => {
      const configAccepts = trustedOrigin(value, 'development') !== null;
      let rendererAccepts = true;
      try { assertTrustedOrigin(value); } catch { rendererAccepts = false; }
      expect(configAccepts).toBe(rendererAccepts);
    });
  it('keeps production HTTPS-only and refuses IPv6 loopback everywhere', () => {
    expect(trustedOrigin('http://localhost:5173', 'production')).toBeNull();
    expect(trustedOrigin('http://[::1]:5173', 'development')).toBeNull();
    expect(trustedOrigin('https://shop.example.test', 'production')).toBe('https://shop.example.test');
  });
});

describe('enqueuePaymentSucceeded: an unsafe optional image never invalidates the order email', () => {
  afterEach(() => vi.unstubAllEnvs());
  const orderId = '3f2c1a40-9b7e-4d1c-8a55-0e6d2b9c1f10';
  const item = (index: number, productImageUrl: string | null) => ({ id: `i${index}`, productName: `Phone ${index}`, sku: `SKU-${index}`, quantity: 1,
    unitPrice: new Prisma.Decimal('10.00'), lineTotal: new Prisma.Decimal('10.00'), productImageUrl });
  function transaction(images: (string | null)[]) {
    const queries: { values: unknown[] }[] = [];
    const tx = {
      order: { findUnique: vi.fn().mockResolvedValue({ id: orderId, userId: '9d1b6c52-77aa-4f0e-9b7c-5b6f6a9d0a11', status: 'CONFIRMED', currency: 'USD',
        subtotal: new Prisma.Decimal('10.00').mul(images.length), shippingCost: new Prisma.Decimal('0.00'), total: new Prisma.Decimal('10.00').mul(images.length),
        deliveryMethod: 'STANDARD', estimatedDeliveryStart: new Date('2026-11-01T00:00:00Z'), estimatedDeliveryEnd: new Date('2026-11-04T00:00:00Z'),
        shippingRecipient: 'Test Buyer', shippingLine1: '1 Main St', shippingLine2: null, shippingCity: 'Seoul', shippingState: null, shippingPostalCode: '04524',
        shippingCountry: 'KR', items: images.map((url, index) => item(index, url)),
        payment: { id: 'b1c2d3e4-1111-4222-8333-444455556666', status: 'SUCCEEDED', amount: new Prisma.Decimal('10.00').mul(images.length), currency: 'USD' },
        user: { email: 'buyer@example.test', isActive: true, firstName: 'Test' } }) },
      commerceEmailOutbox: { findUnique: vi.fn() },
      $queryRaw: vi.fn(async (query: { values: unknown[] }) => { queries.push(query); return [{ id: 'row' }]; }),
    };
    return { tx, queries };
  }
  const snapshotsOf = (queries: { values: unknown[] }[]) => queries.map(query => JSON.parse(query.values.find(value => typeof value === 'string' && value.startsWith('{')) as string));

  it('keeps approved images, drops the rest, and still creates a dispatchable, renderable order confirmation', async () => {
    vi.stubEnv('COMMERCE_EMAIL_ENQUEUE_ENABLED', 'true');
    vi.stubEnv('COMMERCE_EMAIL_ORIGIN', 'https://shop.example.test');
    vi.stubEnv('SUPABASE_URL', 'https://yepfgjehdstlxbpespun.supabase.co');
    vi.stubEnv('SUPABASE_PROJECT_REF', 'yepfgjehdstlxbpespun');
    vi.stubEnv('CLOUDINARY_URL', 'cloudinary://111:topsecret@demo-cloud');
    vi.stubEnv('NODE_ENV', 'production');
    const { tx, queries } = transaction([approved, historicalCloudinary, 'https://evil.example/pixel.gif', 'http://shop.example.test/a.jpg', 'javascript:alert(1)', null, '/products/a.jpg']);
    const created = await enqueuePaymentSucceeded(tx as never, { orderId, paidAt: new Date('2026-10-20T00:00:00Z'), card: null });
    expect(created.map(event => event?.suppressed)).toEqual([false, false]); // READY, not SUPPRESSED
    const [order] = snapshotsOf(queries);
    expect(order.items.map((entry: { imageUrl: string | null }) => entry.imageUrl)).toEqual([approved, historicalCloudinary, null, null, null, null, null]);
    const parsed = commerceEmailSnapshot.parse(order);
    const html = renderCommerceEmail(parsed, { origin: 'https://shop.example.test' }, 'v1');
    for (const index of [0, 1, 2, 3, 4, 5, 6]) expect(html.text).toContain(`Phone ${index}`); // every item is still listed
    expect(html.html).toContain(approved);
    expect(html.html).toContain(historicalCloudinary);
    expect(html.html).not.toMatch(/evil\.example|javascript:/);
  });
});
