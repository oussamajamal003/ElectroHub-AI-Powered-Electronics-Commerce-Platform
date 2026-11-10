import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { commerceEmailSnapshot, TEMPLATE_VERSION } from '../../services/commerce-email.domain.js';
import { commerceEmailFixtures, type CommerceEmailFixtureName } from '../commerce/fixtures.js';
import { renderCommerceEmail } from '../commerce/templates.js';
import { EMAIL_LOGO_HEIGHT, EMAIL_LOGO_WIDTH, renderEmailHeader, resolveEmailLogoUrl } from '../brand.js';

// No database, no provider, no network: prisma and the store profile are stubbed and every send is captured in memory.
vi.mock('../../lib/prisma.js', () => ({ prisma: { emailDelivery: { create: vi.fn(async () => ({ id: 'delivery-1' })), update: vi.fn(async () => ({})) } } }));
vi.mock('../../integrations/brevo/brevo.provider.js', () => ({ brevoProvider: { sendTransactionalEmail: vi.fn() } }));
vi.mock('../../services/store-settings.service.js', () => ({ storeSettings: { getStore: vi.fn(async () => ({ storeName: 'ElectroHub', supportEmail: 'support@electrohub.example' })) } }));

const ORIGIN = 'https://shop.electrohub.example';
const LOGO = `${ORIGIN}/brand/electrohub-email-logo.png`;
type Sent = { to: string; subject: string; htmlContent: string; textContent?: string };
const sent: Sent[] = [];
const provider = { sendTransactionalEmail: vi.fn(async (message: Sent) => { sent.push(message); return { success: true, messageId: 'm-1' }; }) };

beforeAll(() => { vi.stubEnv('FRONTEND_URL', ORIGIN); vi.stubEnv('COMMERCE_EMAIL_ORIGIN', ''); vi.stubEnv('EMAIL_LOGO_URL', ''); });
beforeEach(() => { sent.length = 0; provider.sendTransactionalEmail.mockClear(); });

describe('resolveEmailLogoUrl', () => {
  it('derives the logo from the configured public origin, never from a hard-coded host', () => {
    expect(resolveEmailLogoUrl('https://shop.example.com/some/path', {})).toBe('https://shop.example.com/brand/electrohub-email-logo.png');
    expect(resolveEmailLogoUrl(undefined, { FRONTEND_URL: 'https://a.example' })).toBe('https://a.example/brand/electrohub-email-logo.png');
    expect(resolveEmailLogoUrl(undefined, { COMMERCE_EMAIL_ORIGIN: 'https://c.example', FRONTEND_URL: 'https://a.example' })).toBe('https://c.example/brand/electrohub-email-logo.png');
    expect(resolveEmailLogoUrl('https://shop.example.com', { EMAIL_LOGO_URL: 'https://cdn.example/logo.png' })).toBe('https://cdn.example/logo.png');
  });

  it('rejects anything that is not a plain public https (or loopback http) URL', () => {
    for (const bad of ['javascript:alert(1)', 'data:image/png;base64,AAAA', 'http://shop.example.com', 'https://user:pw@shop.example.com',
      'https://shop.example.com/?token=secret', 'https://shop.example.com/#x', 'not a url', '']) {
      expect(resolveEmailLogoUrl(bad, {}), bad).toBeNull();
      expect(resolveEmailLogoUrl(undefined, { EMAIL_LOGO_URL: bad }), bad).toBeNull();
    }
    expect(resolveEmailLogoUrl('http://localhost:3000', {})).toBe('http://localhost:3000/brand/electrohub-email-logo.png');
  });
});

describe('renderEmailHeader', () => {
  it('emits an accessible, sized, email-safe logo image', () => {
    const html = renderEmailHeader();
    expect(html).toContain('data-brand-header="electrohub"');
    expect(html).toContain(`src="${LOGO}"`);
    expect(html).toContain('alt="ElectroHub"');
    expect(html).toContain(`width="${EMAIL_LOGO_WIDTH}" height="${EMAIL_LOGO_HEIGHT}"`);
    expect(html).toMatch(/<table role="presentation"/);
    // Nothing a mail client strips or blocks: no SVG, no CSS background, no data: URI, no script.
    expect(html).not.toMatch(/\.svg|background(-image)?:|data:|<script|url\(/i);
  });

  it('falls back to the text wordmark (no broken image) when no trustworthy origin is configured', () => {
    vi.stubEnv('FRONTEND_URL', '');
    try {
      const html = renderEmailHeader();
      expect(html).not.toContain('<img');
      expect(html).toContain('data-brand-logo="electrohub-text"');
      expect(html).toContain('aria-label="ElectroHub"');
    } finally { vi.stubEnv('FRONTEND_URL', ORIGIN); }
  });

  it('keeps a renamed store\'s identity, escaped, and omits the line for the default name', () => {
    expect(renderEmailHeader({ storeName: 'ElectroHub' })).not.toMatch(/<\/td><\/tr><tr>/);
    const renamed = renderEmailHeader({ storeName: 'Volt <b>Mart</b> & Co' });
    expect(renamed).toContain('Volt &lt;b&gt;Mart&lt;/b&gt; &amp; Co');
    expect(renamed).not.toContain('<b>Mart');
  });
});

/** Collects every distinct HTML email the application can generate, through the real producers. */
async function collectEverySupportedEmail(): Promise<Array<{ name: string; html: string; text?: string }>> {
  const out: Array<{ name: string; html: string; text?: string }> = [];
  const capture = (name: string) => { const message = sent.at(-1)!; out.push({ name, html: message.htmlContent, text: message.textContent }); };

  const { EmailService } = await import('../../services/email.service.js');
  const customer = new EmailService(provider as never);
  await customer.sendAccountVerificationOtp('customer@example.com', '123456'); capture('account verification');
  await customer.sendPasswordResetOtp('customer@example.com', '654321'); capture('password reset');
  await customer.sendPasswordChangedNotification('customer@example.com'); capture('password changed');

  const invitation = await import('../../services/admin-invitation-email.js');
  const expiresAt = new Date('2030-01-01T00:00:00Z');
  await invitation.sendAdminInvitationEmail({ to: 'a@example.com', token: 'tok-invite', inviterName: 'Ada', expiresAt }, provider as never); capture('admin invitation');
  await invitation.sendAdminActivationEmail({ to: 'a@example.com', token: 'tok-activate', ownerName: 'Ada', expiresAt }, provider as never); capture('admin activation');
  await invitation.sendOwnerGrantedEmail({ to: 'a@example.com' }, provider as never); capture('owner granted');
  await invitation.sendOwnerRevokedEmail({ to: 'a@example.com' }, provider as never); capture('owner revoked');

  const change = await import('../../services/admin-email-change-email.js');
  await change.sendAdminEmailChangeOtp('new@example.com', '246810', 'user-1', provider as never); capture('admin email change code');
  const when = new Date('2030-01-01T00:00:00Z');
  for (const type of ['ADMIN_EMAIL_CHANGE_OLD', 'ADMIN_EMAIL_CHANGE_NEW'] as const) {
    const content = change.notificationContent(type, when);
    out.push({ name: `admin email change notice (${type})`, html: content.htmlContent, text: content.textContent });
  }

  const { buildDeletionEmail } = await import('../../services/admin-deletion-email.js');
  const deletion = buildDeletionEmail(when);
  out.push({ name: 'admin deletion notice', html: deletion.html, text: deletion.text });

  const ops = await import('../../services/admin-notification.service.js');
  for (const [name, email] of [['order paid alert', ops.orderPaidEmail('ORD-1', '10.00', 'USD', `${ORIGIN}/admin/orders`)],
    ['low stock alert (digest)', ops.lowStockEmail('Cable', 'LOW_STOCK', 2)], ['invitation accepted alert', ops.invitationAcceptedEmail()]] as const) {
    out.push({ name, html: email.html, text: email.text });
  }

  const { emailFor } = await import('../../services/stock-alert.service.js');
  for (const status of ['LOW_STOCK', 'OUT_OF_STOCK'] as const) {
    const email = emailFor({ productName: 'Cable', sku: 'SKU-1', status, quantity: 1, lowStockAt: 5 });
    out.push({ name: `stock alert ${status}`, html: email.html, text: email.text });
  }

  const { StorefrontContactService } = await import('../../services/storefront-contact.service.js');
  await new StorefrontContactService(provider as never).send({ name: 'Sam', email: 'sam@example.com', subject: 'Hi', message: 'Hello\nthere' }, 'support@electrohub.example'); capture('storefront contact');

  for (const name of Object.keys(commerceEmailFixtures) as CommerceEmailFixtureName[]) {
    const rendered = renderCommerceEmail(commerceEmailSnapshot.parse(commerceEmailFixtures[name]), { origin: ORIGIN }, TEMPLATE_VERSION);
    out.push({ name: `commerce ${name}`, html: rendered.html, text: rendered.text });
  }
  return out;
}

describe('every application-generated HTML email carries the ElectroHub header', () => {
  it('renders the shared logo header once, with alt text and dimensions, in all templates', async () => {
    const emails = await collectEverySupportedEmail();
    // 3 customer + 4 admin lifecycle + 3 email change + 1 deletion + 3 operational + 2 stock + 1 contact + commerce fixtures.
    expect(emails.length).toBeGreaterThanOrEqual(17 + Object.keys(commerceEmailFixtures).length);
    for (const { name, html } of emails) {
      expect(html.match(/data-brand-header="electrohub"/g), name).toHaveLength(1);
      const logo = html.match(/<img data-brand-logo="electrohub"[^>]*>/g) ?? [];
      expect(logo, name).toHaveLength(1);
      expect(logo[0], name).toContain(`src="${LOGO}"`);
      expect(logo[0], name).toContain('alt="ElectroHub"');
      expect(logo[0], name).toContain(`width="${EMAIL_LOGO_WIDTH}"`);
      expect(logo[0], name).toContain(`height="${EMAIL_LOGO_HEIGHT}"`);
      // The old plain-text/blue-div brand line is gone everywhere, so the header is the single brand element.
      expect(html, name).not.toMatch(/class="brand"/);
      expect(html, name).not.toMatch(/font-size:22px;font-weight:700;color:#2563eb;text-align:center/);
    }
  });

  it('leaves security codes, links and plain-text alternatives untouched', async () => {
    const byName = new Map((await collectEverySupportedEmail()).map(email => [email.name, email]));
    const code = (name: string, value: string) => { const email = byName.get(name)!; expect(email.html, name).toContain(value); expect(email.text, name).toContain(value); };
    code('account verification', '123456');
    code('password reset', '654321');
    code('admin email change code', '246810');
    code('admin invitation', 'tok-invite');
    code('admin activation', 'tok-activate');
    for (const [name, email] of byName) expect(email.text?.trim().length, `${name} plain text`).toBeGreaterThan(20);
    expect(byName.get('password changed')!.html).toContain('has been changed recently');
    expect(byName.get('storefront contact')!.html).toContain('Hello<br>there');
  });

  it('does not let attacker-controlled data reach the header or break escaping', async () => {
    const { html } = renderCommerceEmail(commerceEmailSnapshot.parse(commerceEmailFixtures.orderConfirmedMaliciousNames), { origin: ORIGIN }, TEMPLATE_VERSION);
    const header = html.match(/<table role="presentation"[^>]*data-brand-header[\s\S]*?<\/table>/)?.[0] ?? '';
    expect(header).toContain(LOGO);
    expect(header).not.toMatch(/script|onerror/i);
  });
});
