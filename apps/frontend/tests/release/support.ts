import { createHmac } from 'node:crypto';
import { deflateSync } from 'node:zlib';
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, request, type APIRequestContext, type Locator, type Page, type TestInfo } from '@playwright/test';

/**
 * Task 06.1 release-critical suite support. Fixtures come from apps/backend/scripts/fixtures/release-e2e-seed.ts (written per stack
 * start into the git-ignored .cache/release-e2e). Every browser project has its own shopper and admin pair, so projects can run in
 * parallel without sharing carts, wishlists, orders or MFA enrollment.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
export const repositoryRoot = path.resolve(here, '../../../..');
export const releaseHome = path.join(repositoryRoot, '.cache', 'release-e2e');
export const apiOrigin = `http://127.0.0.1:${process.env.RELEASE_E2E_API_PORT ?? '5206'}`;
export const supportToken = process.env.E2E_TEST_SUPPORT_TOKEN ?? 'electrohub-release-e2e-support-only';

export type SeededProduct = { id: string; sku: string; name: string; slug: string; price: number; quantity: number };
type Fixtures = {
  password: string;
  admins: Record<string, { ownerEmail: string; staffEmail: string; privacyEmail: string }>;
  shoppers: Record<string, { email: string; orderId: string; orderReference: string }>;
  outsider: { email: string; orderId: string; orderReference: string };
  products: SeededProduct[];
};

let cached: Fixtures | undefined;
export function fixtures(): Fixtures {
  cached ??= JSON.parse(readFileSync(path.join(releaseHome, 'fixtures.json'), 'utf8')) as Fixtures;
  return cached;
}

/** The fixture slot a project uses (`chromium-desktop` → chromium, `mobile-390` → mobile, ...). */
export function slot(testInfo: TestInfo): string {
  const name = testInfo.project.name;
  for (const candidate of ['chromium', 'firefox', 'webkit', 'mobile', 'tablet', 'wide']) if (name.startsWith(candidate)) return candidate;
  throw new Error(`No release fixture slot for project ${name}`);
}
export type Family = 'auth' | 'cart' | 'checkout' | 'orders' | 'admin' | 'privacy';
/** The shopper for this project and spec family (families run in parallel workers, so they never share a cart or order). */
export const shopper = (testInfo: TestInfo, family: Family) => fixtures().shoppers[`${slot(testInfo)}-${family}`];
export const admins = (testInfo: TestInfo) => fixtures().admins[slot(testInfo)];
export const product = (sku: string) => {
  const found = fixtures().products.find(item => item.sku === sku);
  if (!found) throw new Error(`Seeded product ${sku} missing`);
  return found;
};
export const money = (value: number) => `$${value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Distinct documentation-range source address per test, so the real per-IP auth limiters never couple unrelated tests. */
export async function distinctClientAddress(page: Page, testInfo: TestInfo) {
  const seed = `${testInfo.project.name}:${testInfo.titlePath.join('>')}:${testInfo.retry}`;
  let hash = 0;
  for (const char of seed) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  await page.context().setExtraHTTPHeaders({ 'X-Forwarded-For': `198.51.${100 + (hash % 3)}.${(hash >>> 8) % 254 + 1}` });
}

export function isNarrow(page: Page) {
  return (page.viewportSize()?.width ?? 1440) < 768;
}

export async function openAccountDialog(page: Page) {
  await page.getByRole('button', { name: 'Account', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Welcome Back' })).toBeVisible();
  // The same dialog is renamed as it moves between sign-in, registration and verification.
  return page.getByRole('dialog');
}

/** Customer sign-in through the real login dialog. */
export async function signInCustomer(page: Page, email: string, password = fixtures().password) {
  if (page.url() === 'about:blank') await page.goto('/');
  const dialog = await openAccountDialog(page);
  await dialog.getByRole('textbox', { name: 'Email Address' }).fill(email);
  await dialog.getByLabel('Password', { exact: true }).fill(password);
  await dialog.getByRole('button', { name: 'Login' }).click();
  await expect(dialog).toBeHidden();
  await expect(accountMenu(page)).toBeVisible();
}

/** The signed-in customer's header account menu button. */
export const accountMenu = (page: Page) => page.getByRole('button', { name: /^Account menu for / });

/**
 * API context authenticated as a customer (bearer token from the real login endpoint). Harness contexts send `Connection: close`:
 * on a cold stack a reused keep-alive socket was intermittently reset between two back-to-back requests ("socket hang up", the second
 * request never reached the server log). Browser traffic is unaffected; see the Task 06.1 evidence (harness observation H-1).
 */
let harnessLogins = 0;
/**
 * A distinct RFC 5737 documentation address per harness API login. The real per-IP login limiter (30 per 15 min) stays fully enabled;
 * the harness simply does not pretend that every fixture call comes from one client.
 */
function harnessAddress() {
  const worker = Number(process.env.TEST_PARALLEL_INDEX ?? 0);
  const network = ['192.0.2', '203.0.113'][worker % 2];
  return `${network}.${(worker * 61 + harnessLogins++) % 254 + 1}`;
}

export async function customerApi(email: string, password = fixtures().password, address = harnessAddress()): Promise<APIRequestContext> {
  const anonymous = await request.newContext({ baseURL: apiOrigin, extraHTTPHeaders: { 'X-Forwarded-For': address, Connection: 'close' } });
  const response = await anonymous.post('/api/auth/login', { data: { email, password } });
  expect(response.status(), 'customer API login').toBe(200);
  const { accessToken } = await response.json() as { accessToken: string };
  await anonymous.dispose();
  return request.newContext({ baseURL: apiOrigin, extraHTTPHeaders: { Authorization: `Bearer ${accessToken}`, 'X-Forwarded-For': address, Connection: 'close' } });
}

export async function resetCustomerState(email: string) {
  const api = await customerApi(email);
  const cart = await (await api.get('/api/cart')).json() as { data?: { items?: { productId: string }[] } };
  for (const item of cart.data?.items ?? []) expect((await api.delete(`/api/cart/items/${item.productId}`)).ok()).toBe(true);
  const wishlist = await (await api.get('/api/wishlist')).json() as { data?: { items?: { productId: string }[] } };
  for (const item of wishlist.data?.items ?? []) expect((await api.delete(`/api/wishlist/items/${item.productId}`)).ok()).toBe(true);
  await api.dispose();
}

/** RFC 6238 TOTP (SHA-1, 30 s, 6 digits) for the software authenticator used in admin enrollment. */
export function totp(secret: string, offsetSteps = 0) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0; let value = 0; const bytes: number[] = [];
  for (const char of secret.replace(/\s/g, '').toUpperCase()) {
    value = (value << 5) | alphabet.indexOf(char); bits += 5;
    if (bits >= 8) { bytes.push((value >>> (bits - 8)) & 255); bits -= 8; }
  }
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000) + offsetSteps));
  const hmac = createHmac('sha1', Buffer.from(bytes)).update(counter).digest();
  const offset = hmac[19] & 15;
  return String((((hmac[offset] & 127) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3]) % 1_000_000).padStart(6, '0');
}

/**
 * Administrator sign-in through the real flow: password, then whichever step the server asks for. A fresh stack start seeds an open
 * enrollment window, so the first sign-in completes the mandatory TOTP enrollment and acknowledges the 10 recovery codes; later
 * sign-ins answer the TOTP challenge. The secret is kept in the git-ignored release home (mode 0600, keyed by this stack start's fixture
 * password) as soon as enrollment is confirmed, so a run that stalls after confirmation can still sign in next time. A TOTP step is
 * never reused (the backend rejects replays), so a repeated sign-in waits for the next 30 s step.
 */
const secretsFile = () => path.join(releaseHome, 'admin-totp.json');
type SecretStore = Record<string, { secret: string; lastStep: number }>;
const secretKey = (email: string) => `${fixtures().password}:${email}`;
function readSecrets(): SecretStore {
  return existsSync(secretsFile()) ? JSON.parse(readFileSync(secretsFile(), 'utf8')) as SecretStore : {};
}
function writeSecret(email: string, secret: string) {
  const store = readSecrets();
  store[secretKey(email)] = { secret, lastStep: Math.floor(Date.now() / 30_000) };
  writeFileSync(secretsFile(), JSON.stringify(store), { mode: 0o600 });
  chmodSync(secretsFile(), 0o600);
}

export async function signInAdmin(page: Page, email: string): Promise<string> {
  await page.goto('/admin/login');
  await page.getByLabel('Email Address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(fixtures().password);
  await page.getByRole('button', { name: 'Sign In' }).click();
  const enroll = page.getByRole('heading', { name: 'Set up two-step verification' });
  const challenge = page.getByRole('heading', { name: /^Verify it(’|')s you$/ });
  const recoveryCodes = page.getByRole('list', { name: 'Recovery codes' });
  await expect(enroll.or(challenge)).toBeVisible();

  let secret: string;
  if (await enroll.isVisible()) {
    await page.getByRole('button', { name: 'Set up authenticator app' }).click();
    secret = (await page.locator('code[aria-labelledby="totp-secret-label"]').innerText()).replace(/\s/g, '');
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    await page.getByLabel('Code from your app').fill(totp(secret));
    await page.getByRole('button', { name: 'Confirm and continue' }).click();
    writeSecret(email, secret);
  } else {
    const known = readSecrets()[secretKey(email)];
    if (!known) throw new Error(`${email} is already enrolled but its TOTP secret was not kept: restart the release stack to reseed it.`);
    secret = known.secret;
    while (Math.floor(Date.now() / 30_000) <= known.lastStep) await page.waitForTimeout(1_000);
    await page.getByLabel('6-digit code').fill(totp(secret));
    await page.getByRole('button', { name: 'Verify and sign in' }).click();
    writeSecret(email, secret);
  }
  // Recovery codes are shown once, right after enrollment; acknowledge them whenever the server presents them.
  const dashboard = page.getByRole('heading', { level: 1, name: 'Dashboard' });
  // The first console render can include a cold Vite compile of the dashboard chunk.
  await expect(recoveryCodes.or(dashboard)).toBeVisible({ timeout: 30_000 });
  if (await recoveryCodes.isVisible()) {
    await expect(recoveryCodes.getByRole('listitem')).toHaveCount(10);
    await page.getByLabel('I have saved these codes somewhere safe.').check();
    await page.getByRole('button', { name: 'I have saved my codes, continue' }).click();
  }
  await expect(page).toHaveURL(/\/admin\/?$/);
  await expect(dashboard).toBeVisible({ timeout: 30_000 });
  return secret;
}

/** No horizontal page overflow, with the offending elements in the failure message. */
export async function expectNoHorizontalOverflow(page: Page, label: string) {
  const overflow = await page.evaluate(() => {
    const extra = document.documentElement.scrollWidth - window.innerWidth;
    const offenders = extra > 0 ? Array.from(document.querySelectorAll('body *')).map(element => {
      const rect = element.getBoundingClientRect();
      return { tag: element.tagName.toLowerCase(), className: typeof element.className === 'string' ? element.className.slice(0, 60) : '', right: Math.round(rect.right) };
    }).filter(element => element.right > window.innerWidth + 1).slice(0, 6) : [];
    return { extra, offenders };
  });
  expect(overflow.extra, `${label}: horizontal overflow ${JSON.stringify(overflow.offenders)}`).toBeLessThanOrEqual(0);
}

/** A control is usable: visible, inside the viewport horizontally, and at least 24×24 CSS px (WCAG 2.2 target size minimum). */
export async function expectUsableControl(control: Locator, label: string) {
  await expect(control, label).toBeVisible();
  const box = await control.boundingBox();
  // A real browser window (viewport: null, e.g. native zoom) has no emulated size; use its CSS layout width instead.
  const width = control.page().viewportSize()?.width ?? await control.page().evaluate(() => window.innerWidth);
  expect(box, `${label} has a layout box`).not.toBeNull();
  expect(box!.x, `${label} starts inside the viewport`).toBeGreaterThanOrEqual(-1);
  expect(box!.x + box!.width, `${label} ends inside the viewport`).toBeLessThanOrEqual(width + 1);
  expect(Math.min(box!.width, box!.height), `${label} target size`).toBeGreaterThanOrEqual(24);
}

/** Header cart link, whose accessible name carries the server-reconciled count. */
export const cartLink = (page: Page, count: number) =>
  page.getByRole('link', { name: `Cart, ${count} ${count === 1 ? 'item' : 'items'}` }).first();

/**
 * A returning shopper who already answered the cookie banner with "Reject optional" (the privacy-preserving choice), stored exactly as
 * the app stores it. For journeys that are not about consent: on a 390 px phone the fixed banner covers the lower third of the viewport.
 * Consent itself is covered by privacy.release.spec.ts, which never calls this.
 */
export async function rememberRejectedCookieChoice(page: Page) {
  await page.addInitScript(() => {
    const key = 'electrohub.privacy.v1';
    if (!localStorage.getItem(key)) localStorage.setItem(key, JSON.stringify({ version: 1, analytics: false, savedAt: Date.now() }));
  });
}

/**
 * Presses a control after bringing it to the middle of the viewport at once. The storefront scrolls smoothly and keeps a sticky header,
 * so Playwright's own scroll-into-view can leave a small control animating under the header when the press starts (seen on mobile WebKit).
 */
export async function pressInView(control: Locator) {
  await control.evaluate(element => element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' }));
  await expect(control).toBeInViewport();
  await control.click();
}

/** A real, decodable 48×48 PNG with a varied pattern (not a blank image), built without any image dependency. */
export function samplePng(): Buffer {
  const size = 48;
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (bytes: Buffer) => { let c = 0xffffffff; for (const byte of bytes) c = crcTable[(c ^ byte) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type: string, data: Buffer) => {
    const head = Buffer.alloc(4); head.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
    const tail = Buffer.alloc(4); tail.writeUInt32BE(crc(body));
    return Buffer.concat([head, body, tail]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0); header.writeUInt32BE(size, 4); header[8] = 8; header[9] = 2;
  const rows: number[] = [];
  for (let y = 0; y < size; y++) {
    rows.push(0);
    for (let x = 0; x < size; x++) rows.push((x * 5) % 256, (y * 5) % 256, ((x + y) * 3 + 90) % 256);
  }
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', header), chunk('IDAT', deflateSync(Buffer.from(rows))), chunk('IEND', Buffer.alloc(0))]);
}
