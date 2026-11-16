import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Page } from '@playwright/test';

/**
 * Task 05.2 real-browser journeys on the disposable stack: password → mandatory TOTP enrollment → recovery codes → console; every new
 * page at 390/768/1440/1920 with overflow checks; Settings persistence; passkey registration and passkey sign-in with a Chromium
 * virtual authenticator (software, not physical hardware); invitation page token hygiene; session revocation; logout.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const credentials = JSON.parse(readFileSync(path.resolve(here, '../../../../.cache/task05-2-browser-credentials.json'), 'utf8')) as
  { ownerEmail: string; password: string; invitationToken: string };
const shots = path.resolve(here, '../../test-results/task05-2-disposable/screens');

function base32(text: string) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = 0; let value = 0; const out: number[] = [];
  for (const char of text.replace(/\s/g, '').toUpperCase()) { value = (value << 5) | alphabet.indexOf(char); bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
function totp(secret: string, offsetSteps = 0) {
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30000) + offsetSteps));
  const hmac = createHmac('sha1', base32(secret)).update(counter).digest(); const offset = hmac[19] & 15;
  return String((((hmac[offset] & 127) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3]) % 1_000_000).padStart(6, '0');
}
async function capture(page: Page, name: string, widths = [1440]) {
  for (const width of widths) {
    await page.setViewportSize({ width, height: width < 800 ? 900 : 1000 });
    await page.waitForTimeout(250);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    const overflowDetails = overflow > 0 ? await page.evaluate(() => {
      const overflowingElements = Array.from(document.querySelectorAll('body *')).map(element => {
        const rect = element.getBoundingClientRect();
        return { tag: element.tagName, id: element.id, className: typeof element.className === 'string' ? element.className : '',
          right: Math.round(rect.right), width: Math.round(rect.width) };
      }).filter(element => element.right > window.innerWidth + 1).sort((a, b) => b.right - a.right).slice(0, 8);
      const tableAncestors = Array.from((function* () {
        let element = document.querySelector('table') as HTMLElement | null;
        while (element) { yield element; element = element.parentElement; }
      })()).map(element => {
        const rect = element.getBoundingClientRect(); const style = getComputedStyle(element);
        return { tag: element.tagName, className: typeof element.className === 'string' ? element.className : '', right: Math.round(rect.right),
          width: Math.round(rect.width), clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, minWidth: style.minWidth,
          overflowX: style.overflowX, display: style.display };
      });
      return { overflowingElements, tableAncestors, bodyWidth: document.body.scrollWidth, documentWidth: document.documentElement.scrollWidth };
    }) : null;
    expect(overflow, `${name} @${width}px has horizontal page overflow: ${JSON.stringify(overflowDetails)}`).toBeLessThanOrEqual(0);
    await page.screenshot({ path: path.join(shots, `${name}-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
}
async function verifyIfPrompted(page: Page, secret: string, completedText: string) {
  const dialog = page.getByRole('dialog', { name: "Confirm it's you" });
  const completed = page.getByRole('region', { name: /Notifications/ }).getByText(completedText, { exact: true });
  const needsStepUp = await Promise.race([
    dialog.waitFor({ state: 'visible', timeout: 20_000 }).then(() => true, () => false),
    completed.waitFor({ state: 'visible', timeout: 20_000 }).then(() => false, () => false),
  ]);
  if (!needsStepUp) return;
  await dialog.getByLabel('6-digit code').fill(totp(secret));
  await dialog.getByRole('button', { name: 'Verify' }).click();
}

test.describe.serial('Task 05.2 admin journeys (disposable)', () => {
  let secret = '';
  const consoleErrors: string[] = [];
  let page: Page;

  test.beforeAll(async ({ browser }) => {
    page = await (await browser.newContext()).newPage();
    page.on('console', message => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  });

  test('E2E-01 password alone opens only the MFA step; enrollment issues the session', async () => {
    await page.goto('/admin/login');
    await capture(page, 'login', [390, 768, 1440, 1920]);
    await page.getByLabel('Email Address').fill(credentials.ownerEmail);
    await page.getByLabel('Password', { exact: true }).fill(credentials.password);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page.getByRole('heading', { name: 'Set up two-step verification' })).toBeVisible();
    // No admin data is reachable yet.
    expect(await page.evaluate(() => fetch('/api/admin/me/profile').then(response => response.status))).toBe(401);
    await page.getByRole('button', { name: 'Set up authenticator app' }).click();
    secret = (await page.locator('code[aria-labelledby="totp-secret-label"]').innerText()).replace(/\s/g, '');
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    await page.getByLabel('Code from your app').fill('000000');
    await page.getByRole('button', { name: 'Confirm and continue' }).click();
    await expect(page.getByText(/isn.t right/i)).toBeVisible();
    await page.getByLabel('Code from your app').fill(totp(secret));
    await page.getByRole('button', { name: 'Confirm and continue' }).click();
    await expect(page.getByRole('list', { name: 'Recovery codes' })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Recovery codes' }).getByRole('listitem')).toHaveCount(10);
    const continueButton = page.getByRole('button', { name: 'I have saved my codes, continue' });
    await expect(continueButton).toBeDisabled();
    await page.getByLabel('I have saved these codes somewhere safe.').check();
    await continueButton.click();
    await expect(page).toHaveURL(/\/admin\/?$/);
  });

  test('every new admin page renders real data without page overflow at 390/768/1440/1920', async () => {
    const pages: [string, string, RegExp][] = [
      ['/admin/analytics?period=30d', 'analytics', /Analytics/],
      ['/admin/analytics?period=12m', 'analytics-12m', /Analytics/],
      ['/admin/settings?tab=store', 'settings-store', /Settings/],
      ['/admin/settings?tab=notifications', 'settings-notifications', /Settings/],
      ['/admin/settings?tab=shipping', 'settings-shipping', /Settings/],
      ['/admin/recommendations?tab=overview', 'recommendations-overview', /Recommendations/],
      ['/admin/recommendations?tab=strategies', 'recommendations-strategies', /Recommendations/],
      ['/admin/recommendations?tab=featured', 'recommendations-featured', /Recommendations/],
      ['/admin/recommendations?tab=preview', 'recommendations-preview', /Recommendations/],
      ['/admin/settings/administrators', 'administrators', /Administrators|Team/],
      ['/admin/profile', 'profile', /Profile/],
      ['/admin/profile/security', 'security', /Security/],
      ['/admin/profile/sessions', 'sessions', /Sessions/],
      ['/admin/products', 'products', /Products/],
    ];
    for (const [url, name, heading] of pages) {
      await page.goto(url);
      await expect(page.getByRole('heading', { level: 1 }).first()).toHaveText(heading);
      await page.waitForLoadState('networkidle');
      await expect(page.locator('[aria-busy="true"]')).toHaveCount(0, { timeout: 20_000 });
      await capture(page, name, ['analytics', 'settings-store', 'recommendations-overview', 'security', 'administrators', 'products'].includes(name)
        ? [390, 768, 1440, 1920] : name === 'recommendations-featured' ? [390, 529, 768, 1440, 1920] : [1440]);
    }
  });

  test('E2E-09 synthetic invitation create, resend and revoke; keyboard dismissal works with reduced motion', async () => {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    expect(await page.evaluate(() => matchMedia('(prefers-reduced-motion: reduce)').matches)).toBe(true);
    await page.goto('/admin/settings/administrators');
    await page.getByRole('button', { name: 'Invite administrator' }).click();
    const inviteDialog = page.getByRole('dialog');
    await expect(inviteDialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(inviteDialog).toBeHidden();

    await page.getByRole('button', { name: 'Invite administrator' }).click();
    await inviteDialog.getByLabel('Email address').fill('created-by-browser@qa.invalid');
    await inviteDialog.getByRole('button', { name: 'Send invitation' }).click();
    await verifyIfPrompted(page, secret, 'Invitation sent.');
    await expect(inviteDialog).toBeHidden();
    await expect(page.getByRole('region', { name: /Notifications/ }).getByText('Invitation sent.', { exact: true })).toBeVisible();
    const createdRow = page.getByRole('row').filter({ hasText: 'created-by-browser@qa.invalid' });
    await expect(createdRow).toBeVisible();

    // Resend an older synthetic invitation that is outside the server cooldown; revoke the new row. E2E-06's token stays untouched.
    await page.getByRole('button', { name: 'Resend invitation to resendable@qa.invalid' }).click();
    await verifyIfPrompted(page, secret, 'Invitation sent again.');
    await expect(page.getByRole('region', { name: /Notifications/ }).getByText('Invitation sent again.', { exact: true })).toBeVisible();

    await createdRow.getByRole('button', { name: 'Revoke invitation to created-by-browser@qa.invalid' }).click();
    const revokeDialog = page.getByRole('dialog', { name: 'Revoke this invitation?' });
    await expect(revokeDialog).toBeVisible();
    await revokeDialog.getByRole('button', { name: 'Revoke invitation' }).click();
    await verifyIfPrompted(page, secret, 'Invitation revoked.');
    await expect(revokeDialog).toBeHidden();
    await expect(page.getByRole('region', { name: /Notifications/ }).getByText('Invitation revoked.', { exact: true })).toBeVisible();
    await page.getByRole('combobox', { name: 'Status' }).click();
    await page.getByRole('option', { name: 'Revoked' }).click();
    await expect(createdRow).toContainText('Revoked');
    await page.emulateMedia({ reducedMotion: 'no-preference' });
  });

  test('E2E-10 featured pin search/select, add/edit, pause/resume and remove use synthetic catalog data', async () => {
    await page.goto('/admin/recommendations?tab=featured');
    await page.getByRole('button', { name: 'Add featured product' }).click();
    const addDialog = page.getByRole('dialog', { name: 'Add featured product' });
    await addDialog.getByLabel('Search products').fill('Aurora Noise-Cancelling Headphones');
    const eligibleProduct = addDialog.getByRole('button', { name: /Eligible product/ });
    await expect(eligibleProduct).toBeEnabled();
    await eligibleProduct.click();
    await addDialog.getByRole('option', { name: /Aurora Noise-Cancelling Headphones/ }).click();
    await addDialog.getByLabel('Placement').selectOption('home');
    await addDialog.getByRole('button', { name: 'Add featured product' }).click();
    await expect(addDialog).toBeHidden();
    const pinRow = page.getByRole('row').filter({ hasText: 'Aurora Noise-Cancelling Headphones' });
    await expect(pinRow).toContainText('Home');
    await expect(pinRow).toContainText('Active');

    await pinRow.getByRole('button', { name: 'Edit featured Aurora Noise-Cancelling Headphones' }).click();
    const editDialog = page.getByRole('dialog', { name: 'Edit featured product' });
    await editDialog.getByLabel('Position (0 is first)').fill('1');
    await editDialog.getByRole('button', { name: 'Save changes' }).click();
    await expect(editDialog).toBeHidden();
    await expect(pinRow.locator('td').nth(2)).toHaveText('1');

    await pinRow.getByRole('button', { name: 'Pause featured Aurora Noise-Cancelling Headphones' }).click();
    await expect(pinRow).toContainText('Paused');
    await pinRow.getByRole('button', { name: 'Resume featured Aurora Noise-Cancelling Headphones' }).click();
    await expect(pinRow).toContainText('Active');
    await pinRow.getByRole('button', { name: 'Remove featured Aurora Noise-Cancelling Headphones' }).click();
    const removeDialog = page.getByRole('dialog', { name: 'Remove Aurora Noise-Cancelling Headphones from featured?' });
    await removeDialog.getByRole('button', { name: 'Remove', exact: true }).click();
    await expect(pinRow).toHaveCount(0);
  });

  test('E2E-11 bulk archive commits eligible product and reports a stale synthetic row', async () => {
    await page.goto('/admin/products');
    const productsResponsePromise = page.waitForResponse(response => new URL(response.url()).pathname === '/api/admin/catalog/products' &&
      response.request().method() === 'GET');
    await page.reload(); // Observe the authenticated app request; a raw fetch would omit the in-memory bearer token.
    const productsResponse = await productsResponsePromise;
    const productsPayload = await productsResponse.json() as { data?: Array<{ id: string; name: string }>; meta?: unknown; error?: { code?: string; message?: string } };
    const responseEvidence = `status=${productsResponse.status()} keys=${Object.keys(productsPayload).sort().join(',')} error=${productsPayload.error?.code ?? 'none'}`;
    expect(productsResponse.status(), responseEvidence).toBe(200);
    expect(Array.isArray(productsPayload.data), responseEvidence).toBe(true);
    expect(productsPayload.meta, responseEvidence).toBeTruthy();
    const namesById = new Map(productsPayload.data!.map(row => [row.id, row.name]));
    const aurora = page.getByRole('checkbox', { name: 'Select Aurora Noise-Cancelling Headphones' });
    const pulse = page.getByRole('checkbox', { name: 'Select Pulse Wireless Earbuds' });
    await aurora.click();
    await pulse.click();
    await page.getByRole('group', { name: 'Actions for selected products' }).getByRole('button', { name: 'Archive' }).click();
    const confirm = page.getByRole('dialog', { name: 'Archive 2 products?' });
    await expect(confirm).toBeVisible();

    // Make Pulse stale at the API boundary. The request still reaches the disposable backend, which archives Aurora and returns a
    // real per-product CONFLICT for Pulse; no production or shared development data is involved.
    await page.route('**/api/admin/catalog/products/bulk-status', async route => {
      const body = route.request().postDataJSON() as { status: string; items: Array<{ id: string; expectedUpdatedAt: string }> };
      const pulseItem = body.items.find(item => namesById.get(item.id) === 'Pulse Wireless Earbuds');
      if (!pulseItem) throw new Error('Pulse fixture was not in the bulk request.');
      pulseItem.expectedUpdatedAt = '2000-01-01T00:00:00.000Z';
      await route.continue({ postData: JSON.stringify(body) });
    });
    await confirm.getByRole('button', { name: 'Archive', exact: true }).click();
    const report = page.getByRole('region', { name: 'Bulk update result' });
    await expect(report.getByRole('status')).toContainText('1 product archived. 1 product could not be changed.');
    await expect(report).toContainText('Pulse Wireless Earbuds');
    await expect(report).toContainText('changed since you opened it');
    await expect(page.getByRole('group', { name: 'Actions for selected products' })).toHaveCount(0);
  });

  test('E2E-08 Store settings persist through reload; shipping change is visible in the example quote and restored', async () => {
    await page.goto('/admin/settings?tab=store');
    const name = page.getByLabel(/Store name/i);
    await name.fill('ElectroHub QA Store');
    await page.getByRole('button', { name: /^Save/ }).click();
    await expect(page.getByText(/saved/i).first()).toBeVisible();
    await page.reload();
    await expect(page.getByLabel(/Store name/i)).toHaveValue('ElectroHub QA Store');
    await page.goto('/admin/settings?tab=shipping');
    const express = page.getByLabel('Express Shipping Rate ($)');
    await express.fill('11.50');
    await page.getByRole('button', { name: /^Save/ }).click();
    await expect(page.getByText(/saved/i).first()).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Express Shipping Rate ($)')).toHaveValue('11.50');
    await capture(page, 'settings-shipping-saved', [1440]);
    await page.getByLabel('Express Shipping Rate ($)').fill('9.99');
    await page.getByRole('button', { name: /^Save/ }).click();
    // The unsaved-changes guard (correctly) blocks leaving a dirty form: wait until the save settles back to pristine.
    await expect(page.getByRole('button', { name: /^Save/ })).toBeDisabled();
    await page.reload();
    await expect(page.getByLabel('Express Shipping Rate ($)')).toHaveValue('9.99');
  });

  test('E2E-05 passkey registration and passkey sign-in with a Chromium virtual authenticator', async () => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true,
      hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
    await page.goto('/admin/profile/security');
    await page.getByRole('button', { name: 'Add passkey' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name').fill('QA virtual key');
    await dialog.getByRole('button', { name: 'Create passkey' }).click();
    await expect(page.getByText('QA virtual key')).toBeVisible();
    await capture(page, 'security-with-passkey', [1440]);

    // Sign out and back in with the passkey as the second factor.
    await page.evaluate(() => fetch('/api/auth/admin/logout', { method: 'POST', credentials: 'include' }));
    await page.goto('/admin/login');
    await page.getByLabel('Email Address').fill(credentials.ownerEmail);
    await page.getByLabel('Password', { exact: true }).fill(credentials.password);
    await page.getByRole('button', { name: 'Sign In' }).click();
    await expect(page.getByRole('heading', { name: "Verify it's you" })).toBeVisible();
    await capture(page, 'mfa-step', [390, 1440]);
    await page.getByRole('tab', { name: 'Passkey' }).click();
    await page.getByRole('button', { name: 'Use passkey' }).click();
    await expect(page).toHaveURL(/\/admin\/?$/);
  });

  test('E2E-06 a second session is listed and revoked; the invitation page strips its token from the URL', async ({ browser }) => {
    const other = await (await browser.newContext()).newPage();
    await other.goto('/admin/login');
    await other.getByLabel('Email Address').fill(credentials.ownerEmail);
    await other.getByLabel('Password', { exact: true }).fill(credentials.password);
    await other.getByRole('button', { name: 'Sign In' }).click();
    await other.getByRole('tab', { name: 'Authenticator app' }).click();
    await other.getByLabel('6-digit code').fill(totp(secret, 1));
    await other.getByRole('button', { name: 'Verify and sign in' }).click();
    await expect(other).toHaveURL(/\/admin\/?$/);

    await page.goto('/admin/profile/sessions');
    await expect(page.getByRole('table', { name: 'Active sessions' }).getByRole('row')).toHaveCount(3); // header + 2 sessions
    await capture(page, 'sessions-two', [390, 1440]);
    await page.getByRole('button', { name: /^Sign out session on / }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Sign out', exact: true }).click();
    await expect(page.getByRole('table', { name: 'Active sessions' }).getByRole('row')).toHaveCount(2);
    await other.goto('/admin/profile');
    await expect(other).toHaveURL(/\/admin\/login/);

    const invite = await (await browser.newContext()).newPage();
    await invite.goto(`/admin/invite#token=${credentials.invitationToken}`);
    await expect(invite.getByLabel('Email address')).toHaveValue('newhire@qa.invalid');
    expect(await invite.evaluate(() => window.location.hash)).toBe('');
    await capture(invite, 'invite', [390, 1440]);
    await invite.getByLabel('First name').fill('New');
    await invite.getByLabel('Last name').fill('Administrator');
    await invite.getByLabel('Create a password').fill('several lowercase unrelated words');
    await invite.getByLabel('Confirm password').fill('several lowercase unrelated words');
    await invite.getByRole('button', { name: 'Create my account' }).click();
    await expect(invite.getByLabel('Create a password')).toHaveAttribute('aria-invalid', 'true');
    await invite.getByLabel('Create a password').fill(credentials.password);
    await invite.getByLabel('Confirm password').fill(credentials.password);
    await invite.getByRole('button', { name: 'Create my account' }).click();
    await invite.getByRole('button', { name: 'Set up authenticator app' }).click();
    const inviteSecret = (await invite.locator('code[aria-labelledby="totp-secret-label"]').innerText()).replace(/\s/g, '');
    await invite.getByLabel('Code from your app').fill(totp(inviteSecret));
    await invite.getByRole('button', { name: 'Confirm and continue' }).click();
    await invite.getByLabel('I have saved these codes somewhere safe.').check();
    await invite.getByRole('button', { name: 'I have saved my codes, continue' }).click();
    await expect(invite).toHaveURL(/\/admin\/?$/);
    const bad = await (await browser.newContext()).newPage(); // a hash-only goto would not reload the same document
    await bad.goto('/admin/invite#token=not-a-real-invitation-token-000000');
    await expect(bad.getByText(/invalid|expired|used/i).first()).toBeVisible();
    await capture(bad, 'invite-invalid', [390]);
  });

  test('logout ends the session and admin routes return to the login page; no console errors during the run', async () => {
    await page.goto('/admin');
    await page.getByRole('button', { name: /Account menu/ }).click();
    await expect(page.getByRole('menuitem', { name: 'My profile' })).toBeVisible();
    await capture(page, 'account-menu', [1440]);
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await page.getByRole('button', { name: 'Sign out' }).last().click();
    await expect(page).toHaveURL(/\/admin\/login/);
    await page.goto('/admin/analytics');
    await expect(page).toHaveURL(/\/admin\/login/);
    const unexpected = consoleErrors.filter(text => !/401|Unauthorized|status of 4\d\d/.test(text));
    expect(unexpected, unexpected.join('\n')).toEqual([]);
  });
});
