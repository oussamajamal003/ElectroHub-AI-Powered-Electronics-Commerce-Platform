import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Browser, type Page } from '@playwright/test';

/**
 * Task 05.2 Owner succession, real browser on the DISPOSABLE stack (fresh run of scripts/task05-2-browser-stack.cjs; never shared DEV or
 * PROD). Synthetic *.invalid identities only:
 *  SUC-01 (C, B)  the seeded Owner is alone and nobody is eligible: helpful blocked state, factor-less admins excluded, nothing changes.
 *  SUC-02 (D)     the invited administrator enrolls and is promoted from Administrators; their old session dies; a fresh MFA sign-in is Owner.
 *  SUC-03         with two Owners, the promoted one deletes their own account the ordinary way (the last-Owner guard is not in the way).
 *  SUC-04 (E, A)  the last Owner transfers to the staff administrator: a tampered request naming a factor-less admin is refused by the
 *                 real server with nothing changed, then the genuine transfer commits; the old Owner is locked out and the successor is a
 *                 real Owner after a fresh MFA sign-in.
 *  SUC-05         keyboard, focus return and reduced motion on the wizard; 200%-zoom-equivalent reflow.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const credentials = JSON.parse(readFileSync(path.resolve(here, '../../../../.cache/task05-2-succession-credentials.json'), 'utf8')) as
  { ownerEmail: string; staffEmail: string; password: string; invitationToken: string; legacyDeliveryEmail: string };
const shots = path.resolve(here, '../../test-results/task05-2-succession-disposable/screens');

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
/** Answers the first matching request with the server's STEP_UP_REQUIRED shape so the real step-up dialog is exercised; later ones pass. */
async function forceStepUpOnce(page: Page, pattern: string) {
  let forced = false;
  await page.route(pattern, async route => {
    if (forced || route.request().method() !== 'POST') return route.continue();
    forced = true;
    return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: { code: 'STEP_UP_REQUIRED', message: 'Confirm it is you to continue.' } }) });
  });
}
const newPage = async (browser: Browser, options: Parameters<Browser['newContext']>[0] = {}) => (await browser.newContext(options)).newPage();

test.describe.serial('Task 05.2 Owner succession (disposable)', () => {
  let owner: Page;
  let ownerSecret = '';
  let staffSecret = '';
  let factorlessId = '';
  const NEWHIRE_PASSWORD = 'Newhire-Owner-8-Pass';

  test('SUC-01 last Owner with no eligible administrator: helpful blocked state, factor-less admins excluded, nothing changes', async ({ browser }) => {
    owner = await newPage(browser);
    await submitPassword(owner, credentials.ownerEmail, credentials.password);
    ownerSecret = await enroll(owner);

    // Administrators: factor-less accounts (staff before enrolling, legacy admins) are never offered for promotion.
    const listResponse = owner.waitForResponse(response => /\/api\/admin\/administrators(\?|$)/.test(response.url()) && response.request().method() === 'GET');
    await owner.goto('/admin/settings/administrators');
    const team = await (await listResponse).json() as { data: { id: string; email: string }[] };
    factorlessId = team.data.find(row => row.email === credentials.legacyDeliveryEmail)!.id;
    await expect(owner.getByText(credentials.staffEmail)).toBeVisible();
    await expect(owner.getByRole('button', { name: /to Owner$/ })).toHaveCount(0);

    await owner.goto('/admin/profile');
    await expect(owner.getByText('You are the last active Owner', { exact: true })).toBeVisible();
    await owner.getByRole('button', { name: /Transfer Ownership & Delete Account/ }).click();
    const dialog = owner.getByRole('dialog', { name: /Choose the next Owner/ });
    await expect(dialog.getByText('No eligible administrator is available')).toBeVisible();
    await expect(dialog.getByRole('radio')).toHaveCount(0);
    await capture(owner, 'wizard-no-eligible', [390, 1440]);
    await dialog.getByRole('button', { name: 'Manage Administrators' }).click();
    await expect(owner).toHaveURL(/\/admin\/settings\/administrators$/);
    // Nothing was transferred or deleted.
    await owner.goto('/admin/profile');
    await expect(owner.getByText('You are the last active Owner', { exact: true })).toBeVisible();
  });

  test('SUC-02 Owner promotes an enrolled administrator; the old session ends and a fresh MFA sign-in carries Owner', async ({ browser }) => {
    const newhire = await newPage(browser);
    await newhire.goto(`/admin/invite#token=${credentials.invitationToken}`);
    await newhire.getByLabel('First name').fill('Nora');
    await newhire.getByLabel('Last name').fill('Newhire');
    await newhire.getByLabel('Create a password').fill(NEWHIRE_PASSWORD);
    await newhire.getByLabel('Confirm password').fill(NEWHIRE_PASSWORD);
    await newhire.getByRole('button', { name: 'Create my account' }).click();
    const newhireSecret = await enroll(newhire);

    await owner.goto('/admin/settings/administrators');
    const promote = owner.getByRole('button', { name: 'Promote newhire@qa.invalid to Owner' });
    await expect(promote).toBeVisible();
    await expect(owner.getByRole('button', { name: /to Owner$/ })).toHaveCount(1); // factor-less staff/legacy rows still excluded
    await promote.click();
    const confirm = owner.getByRole('dialog', { name: 'Promote to Owner?' });
    await expect(confirm).toContainText('newhire@qa.invalid');
    await expect(confirm).toContainText('signed out everywhere');
    await capture(owner, 'promote-dialog', [390, 768, 1440, 1920]);
    await forceStepUpOnce(owner, '**/api/admin/administrators/*/grant-owner');
    await confirm.getByRole('button', { name: 'Promote to Owner' }).click();
    const stepUp = owner.getByRole('dialog', { name: "Confirm it's you" });
    await expect(stepUp).toBeVisible();
    await stepUp.getByLabel('6-digit code').fill(await freshCode(ownerSecret));
    await stepUp.getByRole('button', { name: 'Verify' }).click();
    await expect(confirm).toBeHidden();
    const row = owner.getByRole('row', { name: /newhire@qa\.invalid/ });
    await expect(row.getByText('Owner', { exact: true })).toBeVisible();
    await expect(owner.getByRole('button', { name: 'Promote newhire@qa.invalid to Owner' })).toHaveCount(0);
    await capture(owner, 'administrators-after-promotion', [1440]);
    await owner.unroute('**/api/admin/administrators/*/grant-owner');

    // The promoted administrator's existing session is revoked server-side.
    await newhire.goto('/admin/profile');
    await expect(newhire).toHaveURL(/\/admin\/login/);
    await signIn(newhire, 'newhire@qa.invalid', NEWHIRE_PASSWORD, newhireSecret);
    await newhire.goto('/admin/settings/administrators');
    await expect(newhire.getByText('As an owner you can turn access on or off.', { exact: false })).toBeVisible();

    // SUC-03 inline: with another Owner present the promoted Owner leaves through the ordinary deletion flow.
    await newhire.goto('/admin/profile');
    await expect(newhire.getByText('You are the last active Owner', { exact: true })).toHaveCount(0);
    await newhire.getByRole('button', { name: /Delete My Administrator Account/ }).click();
    const remove = newhire.getByRole('dialog', { name: /Delete your administrator account/ });
    await remove.getByLabel('Current password', { exact: true }).fill(NEWHIRE_PASSWORD);
    await remove.getByLabel('Type DELETE to confirm').fill('DELETE');
    await remove.getByRole('button', { name: 'Delete account' }).click();
    await expect(newhire).toHaveURL(/\/admin\/login/);
  });

  test('SUC-04 last Owner transfers ownership and is deleted atomically; a refused attempt changes nothing', async ({ browser }) => {
    const staff = await newPage(browser);
    await submitPassword(staff, credentials.staffEmail, credentials.password);
    staffSecret = await enroll(staff);

    await owner.goto('/admin/profile');
    await expect(owner.getByText('You are the last active Owner', { exact: true })).toBeVisible();
    await owner.getByRole('button', { name: /Transfer Ownership & Delete Account/ }).click();
    const dialog = owner.getByRole('dialog');
    await expect(dialog.getByRole('heading', { name: /Choose the next Owner/ })).toBeVisible();
    // Only the enrolled staff administrator is eligible: not the Owner, the deleted newhire, or factor-less legacy admins.
    await expect(dialog.getByRole('radio')).toHaveCount(1);
    const option = dialog.getByRole('radio', { name: /Sam Staff/ });
    await expect(dialog.getByText('Two-step verification on')).toBeVisible();
    await capture(owner, 'wizard-choose', [390, 768, 1440, 1920]);
    // Keyboard selection: focus the option and press Space.
    await option.focus();
    await owner.keyboard.press('Space');
    await expect(option).toBeChecked();
    await capture(owner, 'wizard-choose-selected', [1440]);
    await dialog.getByRole('button', { name: /Review transfer/ }).click();
    await expect(dialog.getByRole('heading', { name: 'Review Ownership Transfer' })).toBeVisible();
    await expect(dialog).toContainText(credentials.ownerEmail);
    await expect(dialog).toContainText(credentials.staffEmail);
    await expect(dialog).toContainText('This action permanently deletes your account and transfers the highest administrator authority to the selected person.');
    await capture(owner, 'wizard-review', [390, 768, 1440, 1920]);
    await dialog.getByRole('button', { name: /Continue/ }).click();

    const submit = dialog.getByRole('button', { name: 'Transfer Ownership & Delete My Account' });
    await expect(submit).toBeDisabled();
    await dialog.getByLabel('Current password', { exact: true }).fill(credentials.password);
    await dialog.getByLabel('Type DELETE to confirm').fill('DELETE');
    await expect(submit).toBeDisabled();
    await dialog.getByRole('checkbox', { name: /Sam Staff becomes the Owner/ }).click();
    await expect(submit).toBeEnabled();
    await capture(owner, 'wizard-confirm', [390, 768, 1440, 1920]);

    // Journey B/E: the request is tampered to name a factor-less administrator. The REAL server refuses it; nothing changes.
    let tampered = false;
    await owner.route('**/api/admin/me/ownership-transfer-and-delete', async route => {
      if (tampered) return route.continue();
      tampered = true;
      const body = JSON.parse(route.request().postData() ?? '{}') as Record<string, unknown>;
      return route.continue({ postData: JSON.stringify({ ...body, successorId: factorlessId }) });
    });
    await submit.click();
    await expect(dialog.getByText('This administrator is no longer eligible to become Owner. Choose another active administrator with two-step verification enabled.')).toBeVisible();
    await capture(owner, 'wizard-refused', [390, 1440]);
    await owner.unroute('**/api/admin/me/ownership-transfer-and-delete');
    await expect(owner).toHaveURL(/\/admin\/profile$/);
    // The staff session is untouched by the refused attempt.
    await staff.goto('/admin/profile');
    await expect(staff).toHaveURL(/\/admin\/profile$/);

    await dialog.getByRole('button', { name: 'Choose another administrator' }).click();
    await dialog.getByRole('radio', { name: /Sam Staff/ }).check();
    await dialog.getByRole('button', { name: /Review transfer/ }).click();
    await dialog.getByRole('button', { name: /Continue/ }).click();
    await dialog.getByRole('checkbox', { name: /Sam Staff becomes the Owner/ }).click();
    await forceStepUpOnce(owner, '**/api/admin/me/ownership-transfer-and-delete');
    await submit.click();
    const stepUp = owner.getByRole('dialog', { name: "Confirm it's you" });
    await expect(stepUp).toBeVisible();
    await capture(owner, 'wizard-step-up', [390, 1440]);
    await stepUp.getByLabel('6-digit code').fill(await freshCode(ownerSecret));
    await stepUp.getByRole('button', { name: 'Verify' }).click();
    await expect(owner).toHaveURL(/\/admin\/login/);
    await expect(owner.getByRole('status')).toContainText('Your administrator account has been deleted, and ownership has been transferred successfully.');
    await capture(owner, 'login-after-transfer', [390, 1440]);

    // The previous Owner can no longer authenticate or refresh.
    await owner.goto('/admin/profile');
    await expect(owner).toHaveURL(/\/admin\/login/);
    await owner.getByLabel('Email Address').fill(credentials.ownerEmail);
    await owner.getByLabel('Password', { exact: true }).fill(credentials.password);
    await owner.getByRole('button', { name: 'Sign In' }).click();
    await expect(owner.getByText(/Invalid|incorrect/i).first()).toBeVisible();
    expect(await owner.evaluate(() => fetch('/api/auth/refresh', { method: 'POST', credentials: 'include' }).then(response => response.status))).toBe(401);

    // The successor's old session was revoked; after a fresh MFA sign-in they are a real Owner (and now the last one).
    await staff.goto('/admin/profile');
    await expect(staff).toHaveURL(/\/admin\/login/);
    await signIn(staff, credentials.staffEmail, credentials.password, staffSecret);
    await staff.goto('/admin/profile');
    await expect(staff.getByText('You are the last active Owner', { exact: true })).toBeVisible();
    await staff.goto('/admin/settings/administrators');
    await expect(staff.getByText('As an owner you can turn access on or off.', { exact: false })).toBeVisible();
    await expect(staff.getByRole('switch', { name: `Active access for ${credentials.legacyDeliveryEmail}` })).toBeEnabled(); // Owner-only control
    owner = staff;
    ownerSecret = staffSecret;
  });

  test('SUC-05 keyboard, focus return, reduced motion and 200%-zoom-equivalent reflow', async ({ browser }) => {
    // The new Owner (staff) is now the last Owner with nobody eligible: the wizard opens on its blocked state.
    const page = await newPage(browser, { reducedMotion: 'reduce' });
    await signIn(page, credentials.staffEmail, credentials.password, staffSecret);
    await page.goto('/admin/profile');
    const trigger = page.getByRole('button', { name: /Transfer Ownership & Delete Account/ });
    await trigger.focus();
    await page.keyboard.press('Enter');
    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    // Focus is trapped inside the dialog while tabbing in both directions.
    for (let index = 0; index < 6; index++) {
      await page.keyboard.press('Tab');
      expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true);
    }
    await page.keyboard.press('Shift+Tab');
    expect(await page.evaluate(() => Boolean(document.activeElement?.closest('[role="dialog"]')))).toBe(true);
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();
    // Native browser zoom is not scriptable in headless Chromium; 720 CSS px is a 1440px window at 200%.
    await trigger.click();
    await capture(page, 'wizard-200pct-equivalent', [720]);
  });
});
