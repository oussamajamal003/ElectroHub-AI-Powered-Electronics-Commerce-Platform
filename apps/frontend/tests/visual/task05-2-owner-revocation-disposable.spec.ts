import { createHmac } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Browser, type Page } from '@playwright/test';

/**
 * Task 05.2 Owner revocation, real browser on the DISPOSABLE stack (TASK05_2_API_PORT=5203 TASK05_2_FRONTEND_PORT=3203
 * node scripts/task05-2-browser-stack.cjs; never shared DEV or PROD). Synthetic *.invalid identities only:
 *  REV-UI-01 (A)  Owner A promotes staff B; B's fresh MFA sign-in has Owner access; A revokes B (typed REVOKE + REAL step-up);
 *                 B's old session dies; B's fresh sign-in is an ordinary ADMIN: Owner-only API 403, ordinary API 200.
 *  REV-UI-02 (B)  A cannot revoke themselves: no action on their own row, and the API refuses it.
 *  REV-UI-03 (D)  keyboard-only operation, focus containment and return, honest error announcement, 390–1920 px and 720 px reflow.
 *  Concurrency (C) is proven on real PostgreSQL by REV-05 (admin-security-pg.cjs), where requests can be truly simultaneous.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const credentials = JSON.parse(readFileSync(path.resolve(here, '../../../../.cache/task05-2-browser-credentials-5203.json'), 'utf8')) as
  { ownerEmail: string; staffEmail: string; password: string; disposableDb: { psql: string; port: number; database: string } };
const shots = path.resolve(here, '../../test-results/task05-2-revocation-disposable/screens');

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
async function signIn(page: Page, email: string, password: string, secret: string) {
  await submitPassword(page, email, password);
  await page.getByLabel('6-digit code').fill(await freshCode(secret));
  await page.getByRole('button', { name: 'Verify and sign in' }).click();
  // Signing in after a revoked session returns to the page that required it (e.g. /admin/profile); otherwise the dashboard.
  await expect(page).toHaveURL(/\/admin(\/profile)?\/?$/);
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
/**
 * Ages this administrator's live sessions past the 10-minute step-up window in the DISPOSABLE database (the same thing the PostgreSQL
 * suite does), so the REAL server answers the next sensitive request with STEP_UP_REQUIRED. No request is faked or intercepted.
 */
function expireStepUp(email: string) {
  const { psql, port, database } = credentials.disposableDb;
  if (!/^electrohub_disposable_browser_[0-9a-f]+$/.test(database)) throw new Error('Refusing to touch a non-disposable database.');
  // Prisma stores DateTime as UTC in `timestamp without time zone`; plain now() would be the database session's local time.
  const sql = `UPDATE admin_sessions SET "mfaVerifiedAt" = (now() AT TIME ZONE 'UTC') - interval '20 minutes', "stepUpAt" = NULL
    WHERE "userId" = (SELECT id FROM users WHERE email = '${email.replace(/'/g, "''")}') AND "revokedAt" IS NULL`;
  execFileSync(psql, ['-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1', '-q', '-c', sql]);
}
/** Waits for the server's own STEP_UP_REQUIRED answer to the next request matching `path`. */
const serverDemandsStepUp = (page: Page, path: string) => page.waitForResponse(async response =>
  response.url().includes(path) && response.request().method() === 'POST' && response.status() === 403
  && (await response.json().catch(() => null))?.error?.code === 'STEP_UP_REQUIRED');
const newPage = async (browser: Browser, options: Parameters<Browser['newContext']>[0] = {}) => (await browser.newContext(options)).newPage();

/** Runs one statement against the DISPOSABLE cluster only (name-checked), to stage a concurrent change. */
function disposableSql(sql: string) {
  const { psql, port, database } = credentials.disposableDb;
  if (!/^electrohub_disposable_browser_[0-9a-f]+$/.test(database)) throw new Error('Refusing to touch a non-disposable database.');
  execFileSync(psql, ['-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1', '-q', '-c', sql]);
}

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

test.describe.serial('Task 05.2 Owner revocation (disposable)', () => {
  let ownerA: Page;
  let ownerSecret = '';
  let staffB: Page;
  let staffSecret = '';
  let ownerId = '';

  test('REV-UI-01 promote B, B uses Owner access, A revokes B; B stays an ADMIN without Owner access after a fresh MFA sign-in', async ({ browser }) => {
    ownerA = await newPage(browser);
    await submitPassword(ownerA, credentials.ownerEmail, credentials.password);
    ownerSecret = await enroll(ownerA);
    staffB = await newPage(browser);
    await submitPassword(staffB, credentials.staffEmail, credentials.password);
    staffSecret = await enroll(staffB);

    const list = ownerA.waitForResponse(response => /\/api\/admin\/administrators(\?|$)/.test(response.url()) && response.request().method() === 'GET');
    await ownerA.goto('/admin/settings/administrators');
    const team = await (await list).json() as { data: { id: string; email: string }[] };

    ownerId = team.data.find(row => row.email === credentials.ownerEmail)!.id;

    // Promote B (real step-up).
    await ownerA.getByRole('button', { name: `Promote ${credentials.staffEmail} to Owner` }).click();
    const promote = ownerA.getByRole('dialog', { name: 'Promote to Owner?' });
    await expect(promote).toContainText('can later be revoked by another authorized Owner');
    await expect(promote).not.toContainText('no demotion');
    expireStepUp(credentials.ownerEmail);
    const promoteDemanded = serverDemandsStepUp(ownerA, '/grant-owner');
    await promote.getByRole('button', { name: 'Promote to Owner' }).click();
    await promoteDemanded;
    let stepUp = ownerA.getByRole('dialog', { name: "Confirm it's you" });
    await stepUp.getByLabel('6-digit code').fill(await freshCode(ownerSecret));
    await stepUp.getByRole('button', { name: 'Verify' }).click();
    await expect(promote).toBeHidden();
    const rowB = ownerA.getByRole('row').filter({ hasText: credentials.staffEmail });
    await expect(rowB.getByText('Owner', { exact: true })).toBeVisible();

    // B signs in again and really holds Owner access.
    await staffB.goto('/admin/profile');
    await expect(staffB).toHaveURL(/\/admin\/login/);
    await signIn(staffB, credentials.staffEmail, credentials.password, staffSecret);
    expect((await apiAs(staffB, 'GET', `/api/admin/administrators/${ownerId}/mfa-activation`)).status).toBe(200);

    // A revokes B: identity shown, typed REVOKE gates the action, the REAL server demands a step-up.
    await ownerA.reload();
    const revokeButton = ownerA.getByRole('button', { name: `Revoke Owner privileges for ${credentials.staffEmail}` });
    await revokeButton.click();
    const dialog = ownerA.getByRole('dialog', { name: 'Revoke Owner privileges?' });
    await expect(dialog).toContainText('This administrator will lose Owner access but will retain their ElectroHub administrator account.');
    await expect(dialog).toContainText(credentials.staffEmail);
    const confirm = dialog.getByRole('button', { name: 'Revoke Owner Privileges' });
    await expect(confirm).toBeDisabled();
    await dialog.getByLabel('Type REVOKE to confirm').fill('REVOKE');
    await expect(confirm).toBeEnabled();
    await capture(ownerA, 'revoke-dialog', [390, 768, 1440, 1920]);
    expireStepUp(credentials.ownerEmail);
    const revokeDemanded = serverDemandsStepUp(ownerA, '/revoke-owner');
    await confirm.click();
    await revokeDemanded;
    stepUp = ownerA.getByRole('dialog', { name: "Confirm it's you" });
    await expect(stepUp).toBeVisible();
    await capture(ownerA, 'revoke-step-up', [390, 1440]);
    await stepUp.getByLabel('6-digit code').fill(await freshCode(ownerSecret));
    await stepUp.getByRole('button', { name: 'Verify' }).click();
    await expect(dialog).toBeHidden();
    // The table reflects the server immediately: Administrator, no Owner pill, Promote available again; B is still active.
    await expect(rowB.getByText('Owner', { exact: true })).toHaveCount(0);
    await expect(rowB.getByText('Administrator', { exact: true })).toBeVisible();
    await expect(ownerA.getByRole('button', { name: `Promote ${credentials.staffEmail} to Owner` })).toBeVisible();
    await expect(ownerA.getByRole('switch', { name: `Active access for ${credentials.staffEmail}` })).toBeChecked();
    await expect(ownerA.getByRole('switch', { name: `Manage administrators for ${credentials.staffEmail}` })).not.toBeChecked();
    await capture(ownerA, 'administrators-after-revoke', [1440]);

    // B's existing session is gone; a fresh password + MFA sign-in works and is an ordinary ADMIN.
    await staffB.goto('/admin/profile');
    await expect(staffB).toHaveURL(/\/admin\/login/);
    await signIn(staffB, credentials.staffEmail, credentials.password, staffSecret);
    expect(await apiAs(staffB, 'GET', `/api/admin/administrators/${ownerId}/mfa-activation`)).toEqual({ status: 403, code: 'CAPABILITY_REQUIRED' });
    expect((await apiAs(staffB, 'POST', `/api/admin/administrators/${ownerId}/revoke-owner`, { confirmation: 'REVOKE' })).status).toBe(403);
    expect((await apiAs(staffB, 'GET', '/api/admin/catalog/products')).status).toBe(200);
    await staffB.goto('/admin/settings/administrators');
    await expect(staffB.getByText(/Only owners can change access|You can see the administrator team/).first()).toBeVisible();
    await expect(staffB.getByRole('button', { name: /^Revoke Owner privileges/ })).toHaveCount(0);
  });

  test('REV-UI-02 an Owner cannot revoke themselves: no action on their own row and the API refuses it', async () => {
    await ownerA.goto('/admin/settings/administrators');
    const self = ownerA.getByRole('row').filter({ hasText: credentials.ownerEmail });
    await expect(self.getByText('Owner', { exact: true })).toBeVisible();
    await expect(self.getByText('You', { exact: true })).toBeVisible();
    await expect(self.getByRole('button', { name: /Revoke/ })).toHaveCount(0);
    expect(await apiAs(ownerA, 'POST', `/api/admin/administrators/${ownerId}/revoke-owner`, { confirmation: 'REVOKE' }))
      .toEqual({ status: 409, code: 'SELF_OWNER_REVOCATION_FORBIDDEN' });
    await ownerA.reload();
    await expect(self.getByText('Owner', { exact: true })).toBeVisible();
  });

  test('REV-UI-03 keyboard-only revocation dialog, focus containment and return, error announcement, reflow', async ({ browser }) => {
    // Re-promote B so there is another Owner to act on; the request then fails honestly (server refusal announced).
    const page = await newPage(browser, { reducedMotion: 'reduce' });
    await signIn(page, credentials.ownerEmail, credentials.password, ownerSecret);
    await page.goto('/admin/settings/administrators');
    await page.getByRole('button', { name: `Promote ${credentials.staffEmail} to Owner` }).click();
    await page.getByRole('dialog', { name: 'Promote to Owner?' }).getByRole('button', { name: 'Promote to Owner' }).click();
    await expect(page.getByRole('button', { name: `Revoke Owner privileges for ${credentials.staffEmail}` })).toBeVisible();

    const trigger = page.getByRole('button', { name: `Revoke Owner privileges for ${credentials.staffEmail}` });
    await trigger.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog', { name: 'Revoke Owner privileges?' });
    await expect(dialog).toBeVisible();
    for (let index = 0; index < 6; index++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true);
    }
    await page.keyboard.press('Shift+Tab');
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();

    // Keyboard path to an honest refusal: B is deactivated while the dialog is open (a concurrent change, staged directly in the
    // disposable database), so the real server answers TARGET_INACTIVE and nothing changes.
    await trigger.press('Space');
    await dialog.getByLabel('Type REVOKE to confirm').focus();
    await page.keyboard.type('REVOKE');
    disposableSql(`UPDATE users SET "isActive" = false WHERE email = '${credentials.staffEmail}'`);
    await page.keyboard.press('Enter');
    await expect(dialog.getByRole('alert')).toContainText('This administrator is deactivated.');
    await capture(page, 'revoke-refused', [390, 1440]);
    // Native browser zoom is not scriptable in headless Chromium; 720 CSS px is a 1440px window at 200%.
    await capture(page, 'revoke-200pct-equivalent', [720]);
  });
});
