import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Browser, type Page, type Request } from '@playwright/test';

/**
 * Task 05.2 Administrators page access, real browser on the DISPOSABLE stack (TASK05_2_API_PORT=5204 TASK05_2_FRONTEND_PORT=3204
 * node scripts/task05-2-browser-stack.cjs; never shared DEV or PROD). Synthetic *.invalid identities only:
 *  ACC-UI-01  plain ADMIN: no Administrators entry in Settings; the direct URL shows Access Restricted (focused heading, Back to
 *             Dashboard by keyboard) and the browser never requests team data; the server still answers 403 CAPABILITY_REQUIRED.
 *  ACC-UI-02  Owner: Administrators entry and the full management page.
 *  ACC-UI-03  manager (granted by the Owner): normal page; the Owner removes management mid-session; the manager's next team
 *             request is refused by the server and the page is replaced by Access Restricted; the Settings entry disappears.
 *  ACC-UI-04  failures: capabilities unreachable (aborted request) and a team-list 500 are error states with retry, not Access Restricted.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const credentials = JSON.parse(readFileSync(path.resolve(here, '../../../../.cache/task05-2-browser-credentials-5204.json'), 'utf8')) as
  { ownerEmail: string; staffEmail: string; password: string; disposableDb: { psql: string; port: number; database: string } };
const shots = path.resolve(here, '../../test-results/task05-2-administrators-access-disposable/screens');

function base32(text: string) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = 0; let value = 0; const out: number[] = [];
  for (const char of text.replace(/\s/g, '').toUpperCase()) { value = (value << 5) | alphabet.indexOf(char); bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
function totp(secret: string) {
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000)));
  const hmac = createHmac('sha1', base32(secret)).update(counter).digest(); const offset = hmac[19] & 15;
  return String((((hmac[offset] & 127) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3]) % 1_000_000).padStart(6, '0');
}
/** A code from a time step no account in this run has used yet: the server accepts each step once per account. */
let lastStep = 0;
async function freshCode(secret: string) {
  while (Math.floor(Date.now() / 30000) <= lastStep) await new Promise(resolve => setTimeout(resolve, 1000));
  lastStep = Math.floor(Date.now() / 30000);
  return totp(secret);
}
async function submitPassword(page: Page, email: string, password: string) {
  await page.goto('/admin/login');
  await page.getByLabel('Email Address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign In' }).click();
}
async function enroll(page: Page) {
  await page.getByRole('button', { name: 'Set up authenticator app' }).click();
  const secret = (await page.locator('code[aria-labelledby="totp-secret-label"]').innerText()).replace(/\s/g, '');
  await page.getByLabel('Code from your app').fill(await freshCode(secret));
  await page.getByRole('button', { name: 'Confirm and continue' }).click();
  await page.getByLabel('I have saved these codes somewhere safe.').check();
  await page.getByRole('button', { name: 'I have saved my codes, continue' }).click();
  await expect(page).toHaveURL(/\/admin\/?$/);
  return secret;
}
async function capture(page: Page, name: string, widths: number[]) {
  for (const width of widths) {
    await page.setViewportSize({ width, height: width < 800 ? 900 : 1000 });
    await page.waitForTimeout(300);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `${name} @${width}px has horizontal page overflow`).toBeLessThanOrEqual(0);
    // Every dialog action stays reachable: the dialog itself scrolls when the viewport is short.
    const dialog = page.getByRole('dialog').last();
    if (await dialog.count()) {
      const box = await dialog.boundingBox();
      expect(box && box.x >= 0 && box.x + box.width <= width + 1, `${name} @${width}px dialog is clipped horizontally`).toBeTruthy();
    }
    await page.screenshot({ path: path.join(shots, `${name}-${width}.png`), fullPage: false });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
}
const newPage = async (browser: Browser, options: Parameters<Browser['newContext']>[0] = {}) => (await browser.newContext(options)).newPage();


/** A fresh access token for this page's own signed-in session (rotates its refresh cookie), to call the real API directly. */
async function apiAs(page: Page, method: 'GET' | 'POST', url: string, body?: object) {
  return page.evaluate(async ({ method, url, body }) => {
    const refreshed = await fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' });
    if (!refreshed.ok) return { status: refreshed.status, code: 'REFRESH_FAILED' };
    const { accessToken } = await refreshed.json() as { accessToken: string };
    const response = await fetch(url, { method, credentials: 'include',
      headers: { Authorization: `Bearer ${accessToken}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined });
    const json = await response.json().catch(() => null) as { error?: { code?: string } } | null;
    return { status: response.status, code: json?.error?.code ?? null };
  }, { method, url, body });
}


const isTeamRequest = (request: Request) => /^\/api\/admin\/(administrators|invitations)(\/|$)/.test(new URL(request.url()).pathname);
const ACCESS_TEXT = "You don't have permission to view or manage administrator accounts. Contact an Owner if you need access.";

test.describe.serial('Task 05.2 Administrators page access (disposable)', () => {
  let owner: Page;
  let staff: Page;

  test('ACC-UI-01 a regular administrator: no entry, Access Restricted on the direct URL, no team data requested, server 403 intact', async ({ browser }) => {
    staff = await newPage(browser);
    await submitPassword(staff, credentials.staffEmail, credentials.password);
    await enroll(staff);
    const teamRequests: string[] = [];
    staff.on('request', request => { if (isTeamRequest(request)) teamRequests.push(request.url()); });

    await staff.goto('/admin/settings');
    await expect(staff.getByRole('tab', { name: 'Store' })).toBeVisible();
    await expect(staff.getByRole('tab', { name: 'Administrators' })).toHaveCount(0);
    await staff.goto('/admin/settings?tab=administrators');
    await expect(staff.getByRole('heading', { name: 'Store Information' })).toBeVisible();
    await expect(staff.getByRole('link', { name: 'Manage administrators' })).toHaveCount(0);
    await expect(staff.getByRole('link', { name: /^Administrators$/ })).toHaveCount(0);

    await staff.goto('/admin/settings/administrators');
    const heading = staff.getByRole('heading', { level: 1, name: 'Access Restricted' });
    await expect(heading).toBeVisible();
    await expect(heading).toBeFocused();
    await expect(staff.getByText(ACCESS_TEXT)).toBeVisible();
    await expect(staff.getByRole('table')).toHaveCount(0);
    await expect(staff.getByText(/You can see the administrator team|Only owners can change access/)).toHaveCount(0);
    await expect(staff.getByRole('heading', { name: 'Invitations' })).toHaveCount(0);
    await expect(staff.getByRole('button', { name: 'Invite administrator' })).toHaveCount(0);
    await capture(staff, 'access-restricted', [390, 768, 1440, 1920]);
    // Native browser zoom is not scriptable in headless Chromium; 720 CSS px is a 1440px window at 200%.
    await capture(staff, 'access-restricted-200pct-equivalent', [720]);
    expect(teamRequests, 'no administrator/invitation request when access is known to be denied').toEqual([]);

    // The server is still the authority: the same session is refused the team data directly.
    expect(await apiAs(staff, 'GET', '/api/admin/administrators')).toEqual({ status: 403, code: 'CAPABILITY_REQUIRED' });
    expect(await apiAs(staff, 'GET', '/api/admin/invitations')).toEqual({ status: 403, code: 'CAPABILITY_REQUIRED' });

    // Keyboard: the primary action is reachable by Tab, shows a focus indicator and leaves for the dashboard.
    await staff.reload();
    await expect(heading).toBeFocused();
    const back = staff.getByRole('link', { name: 'Back to Dashboard' });
    await expect(back).toHaveAttribute('href', '/admin');
    await staff.keyboard.press('Tab');
    await expect(back).toBeFocused();
    const focusRing = await back.evaluate(element => { const style = getComputedStyle(element); return `${style.outlineStyle} ${style.boxShadow}`; });
    expect(focusRing, 'visible focus indicator on Back to Dashboard').not.toBe('none none');
    await capture(staff, 'access-restricted-focus', [1440]);
    await staff.keyboard.press('Enter');
    await expect(staff).toHaveURL(/\/admin\/?$/);
  });

  test('ACC-UI-02 an Owner sees the entry and the full management page', async ({ browser }) => {
    owner = await newPage(browser);
    await submitPassword(owner, credentials.ownerEmail, credentials.password);
    await enroll(owner);
    await owner.goto('/admin/settings');
    await owner.getByRole('tab', { name: 'Administrators' }).click();
    // The tab shows the team in place (no extra click), under the Settings page title.
    await expect(owner).toHaveURL(/\/admin\/settings\?tab=administrators$/);
    await expect(owner.getByRole('heading', { level: 2, name: 'Administrators' })).toBeVisible();
    await expect(owner.getByText(credentials.staffEmail)).toBeVisible();
    await capture(owner, 'owner-settings-administrators-tab', [390, 768, 1440, 1920]);
    await owner.goto('/admin/settings/administrators');
    await expect(owner.getByRole('heading', { level: 1, name: 'Administrators' })).toBeVisible();
    await expect(owner.getByText(credentials.staffEmail)).toBeVisible();
    await expect(owner.getByRole('button', { name: 'Invite administrator' })).toBeVisible();
    await expect(owner.getByRole('switch', { name: `Manage administrators for ${credentials.staffEmail}` })).toBeVisible();
    await expect(owner.getByRole('heading', { name: 'Access Restricted' })).toHaveCount(0);
    await capture(owner, 'owner-administrators', [1440]);
  });

  test('ACC-UI-03 a manager gets the normal page; management removed mid-session swaps it for Access Restricted', async () => {
    // The Owner grants management (fresh MFA sign-in, so the server's step-up window is open).
    const grant = owner.getByRole('switch', { name: `Manage administrators for ${credentials.staffEmail}` });
    await grant.click();
    await expect(grant).toBeChecked();

    await staff.goto('/admin/settings');
    await expect(staff.getByRole('tab', { name: 'Administrators' })).toBeVisible();
    await staff.goto('/admin/settings/administrators');
    await expect(staff.getByRole('heading', { level: 1, name: 'Administrators' })).toBeVisible();
    await expect(staff.getByText(credentials.ownerEmail)).toBeVisible();
    await expect(staff.getByRole('button', { name: 'Invite administrator' })).toBeVisible();
    await expect(staff.getByRole('button', { name: /to Owner$/ })).toHaveCount(0);
    await capture(staff, 'manager-administrators', [1440]);

    // The Owner removes management while the manager still has the page open.
    await owner.reload();
    await owner.getByRole('switch', { name: `Manage administrators for ${credentials.staffEmail}` }).click();
    await owner.getByRole('dialog', { name: 'Remove management access?' }).getByRole('button', { name: 'Remove access' }).click();
    await expect(owner.getByRole('switch', { name: `Manage administrators for ${credentials.staffEmail}` })).not.toBeChecked();

    // The manager's next team request (another invitation filter) is refused by the REAL server.
    const refused = staff.waitForResponse(response => response.url().includes('/api/admin/invitations') && response.status() === 403);
    await staff.getByRole('combobox', { name: 'Status' }).click();
    await staff.getByRole('option', { name: 'Expired' }).click();
    expect((await (await refused).json()).error.code).toBe('CAPABILITY_REQUIRED');
    const heading = staff.getByRole('heading', { level: 1, name: 'Access Restricted' });
    await expect(heading).toBeVisible();
    await expect(heading).toBeFocused();
    await expect(staff.getByText(credentials.ownerEmail)).toHaveCount(0);
    await expect(staff.getByRole('table')).toHaveCount(0);
    await capture(staff, 'access-removed-mid-session', [1440]);
    // Capabilities were re-read, so Settings no longer offers the entry either (client-side navigation, no reload).
    await staff.getByRole('link', { name: 'Back to Dashboard' }).click();
    await expect(staff).toHaveURL(/\/admin\/?$/);
    await staff.getByRole('link', { name: 'Settings', exact: true }).first().click();
    await expect(staff.getByRole('tab', { name: 'Store' })).toBeVisible();
    await expect(staff.getByRole('tab', { name: 'Administrators' })).toHaveCount(0);
  });

  test('ACC-UI-04 network and server failures are error states with retry, never Access Restricted', async () => {
    // Capabilities unreachable: the request is aborted in the browser, as a dropped connection would be.
    await staff.route('**/api/admin/me/profile', route => route.abort('internetdisconnected'));
    await staff.goto('/admin/settings/administrators');
    await expect(staff.getByText('Your administrator permissions could not be loaded.')).toBeVisible();
    await expect(staff.getByRole('button', { name: 'Retry' })).toBeVisible();
    await expect(staff.getByRole('heading', { name: 'Access Restricted' })).toHaveCount(0);
    await capture(staff, 'capabilities-unreachable', [390, 1440]);
    await staff.unroute('**/api/admin/me/profile');
    await staff.getByRole('button', { name: 'Retry' }).click();
    await expect(staff.getByRole('heading', { name: 'Access Restricted' })).toBeVisible();

    // An authorized Owner whose team list fails with a server error sees the list error, not Access Restricted.
    const failing = (url: URL) => url.pathname === '/api/admin/administrators';
    await owner.route(failing, route => route.fulfill({ status: 500, contentType: 'application/json',
      body: JSON.stringify({ success: false, error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } }) }));
    await owner.goto('/admin/settings/administrators');
    await expect(owner.getByText('The administrator list could not be loaded.')).toBeVisible();
    await expect(owner.getByRole('heading', { name: 'Access Restricted' })).toHaveCount(0);
    await capture(owner, 'team-list-server-error', [1440]);
    await owner.unroute(failing);
    await owner.getByRole('button', { name: 'Retry' }).first().click();
    await expect(owner.getByText(credentials.staffEmail)).toBeVisible();
  });
});
