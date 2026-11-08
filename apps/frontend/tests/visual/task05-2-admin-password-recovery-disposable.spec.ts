import { createHmac, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, request as playwrightRequest, test, type APIRequestContext, type Browser, type Page } from '@playwright/test';

/**
 * Task 05.2 administrator forgot-password, real browser on the DISPOSABLE stack (fresh run of scripts/task05-2-browser-stack.cjs; never shared DEV
 * or PROD). The stack has no email provider, so the "mail sink" is the disposable database itself: after the UI requests a code, the spec replaces
 * that challenge's hash with the HMAC of a known code (the development OTP secret is the documented fallback outside production). Everything else
 * is real: the Express API, the OTP/MFA verification, TOTP replay guard, WebAuthn through a Chromium virtual authenticator, session revocation.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const API_PORT = process.env.TASK05_2_API_PORT || '5200';
const credentials = JSON.parse(readFileSync(path.resolve(here, `../../../../.cache/task05-2-browser-credentials${API_PORT === '5200' ? '' : `-${API_PORT}`}.json`), 'utf8')) as
  { ownerEmail: string; staffEmail: string; customerEmail: string; password: string; legacyUnactivatedEmail: string; disposableDb: { psql: string; port: number; database: string } };
const shots = path.resolve(here, '../../test-results/task05-2-password-recovery-disposable/screens');
const BASE = `http://localhost:${process.env.TASK05_2_FRONTEND_PORT || '3200'}`;
const KNOWN_CODE = '135790';
const OTP_FALLBACK_SECRET = 'development_otp_fallback_secret_12345678';

function base32(text: string) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'; let bits = 0; let value = 0; const out: number[] = [];
  for (const char of text.replace(/\s/g, '').toUpperCase()) { value = (value << 5) | alphabet.indexOf(char); bits += 5; if (bits >= 8) { out.push((value >>> (bits - 8)) & 255); bits -= 8; } }
  return Buffer.from(out);
}
function totp(secret: string, step: number) {
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(step));
  const hmac = createHmac('sha1', base32(secret)).update(counter).digest(); const offset = hmac[19] & 15;
  return String((((hmac[offset] & 127) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3]) % 1_000_000).padStart(6, '0');
}
/** A code from a time step this account has not used yet: the server accepts each step of a secret once. */
const lastStep = new Map<string, number>();
async function freshCode(secret: string) {
  while (Math.floor(Date.now() / 30000) <= (lastStep.get(secret) ?? 0)) await new Promise(resolve => setTimeout(resolve, 1000));
  const step = Math.floor(Date.now() / 30000);
  lastStep.set(secret, step);
  return totp(secret, step);
}
function sql(statement: string) {
  const { psql, port, database } = credentials.disposableDb;
  if (!/^electrohub_disposable_browser_[0-9a-f]+$/.test(database)) throw new Error('Refusing to touch a non-disposable database.');
  execFileSync(psql, ['-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1', '-q', '-c', statement]);
}
/** Synthetic mail sink: makes the freshly requested reset code known (the real one only exists in an email this stack cannot send). */
function plantEmailCode(email: string) {
  const hash = createHmac('sha256', OTP_FALLBACK_SECRET).update(KNOWN_CODE).digest('hex');
  sql(`UPDATE otp_challenges SET "codeHash" = '${hash}', "expiresAt" = (now() AT TIME ZONE 'UTC') + interval '5 minutes', "attempts" = 0, "lockedAt" = NULL
    WHERE "userId" = (SELECT id FROM users WHERE email = '${email.replace(/'/g, "''")}') AND purpose = 'PASSWORD_RESET' AND "consumedAt" IS NULL`);
}
async function capture(page: Page, name: string, widths: number[]) {
  for (const width of widths) {
    await page.setViewportSize({ width, height: width < 800 ? 900 : 1000 });
    await page.waitForTimeout(200);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), `${name} @${width}px overflows horizontally`).toBeLessThanOrEqual(0);
    await page.screenshot({ path: path.join(shots, `${name}-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
}
const newPage = async (browser: Browser) => (await browser.newContext()).newPage();

interface Enrolled { email: string; secret: string; recoveryCodes: string[] }
/** Password sign-in → first-factor enrollment through the real API; returns the TOTP secret and the recovery codes. */
async function enrollViaApi(api: APIRequestContext, email: string): Promise<Enrolled> {
  const login = await (await api.post('/api/auth/login', { data: { email, password: credentials.password } })).json();
  const start = await (await api.post('/api/auth/admin/mfa/enrollment/start', { data: { mfaToken: login.mfaToken } })).json();
  const confirm = await api.post('/api/auth/admin/mfa/enrollment/confirm', { data: { mfaToken: login.mfaToken, factorId: start.factorId, code: await freshCode(start.secret) } });
  expect(confirm.status()).toBe(200);
  return { email, secret: start.secret, recoveryCodes: (await confirm.json()).recoveryCodes };
}
/** Opens Forgot Password from the login page and walks the email stage; leaves the page on the MFA step. */
async function reachMfaStep(page: Page, email: string) {
  await page.goto('/admin/login');
  await page.getByRole('link', { name: 'Forgot Password?' }).click();
  await expect(page).toHaveURL(/\/admin\/forgot-password$/);
  await expect(page.getByRole('heading', { name: 'Reset your administrator password' })).toBeVisible();
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button', { name: 'Send verification code' }).click();
  await expect(page.getByRole('heading', { name: 'Verify your email' })).toBeVisible();
  plantEmailCode(email);
  await page.getByLabel('Verification code').fill(KNOWN_CODE);
  await page.getByRole('button', { name: 'Continue' }).click();
  await expect(page.getByRole('heading', { name: 'Confirm your identity' })).toBeVisible();
}
async function setNewPassword(page: Page, password: string, currentPassword?: string) {
  await expect(page.getByRole('heading', { name: 'Create a new password' })).toBeVisible();
  await page.getByLabel('New password', { exact: true }).fill('weakpassword');
  await page.getByLabel('Confirm password').fill('different');
  await page.getByRole('button', { name: 'Reset password' }).click();
  await expect(page.getByText('The passwords do not match.')).toBeVisible();
  if (currentPassword) {
    // The current password is refused by the server; the same reset authorization stays usable afterwards.
    await page.getByLabel('New password', { exact: true }).fill(currentPassword);
    await page.getByLabel('Confirm password').fill(currentPassword);
    await page.getByRole('button', { name: 'Reset password' }).click();
    await expect(page.getByText('Your new password must be different from your current password.')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Create a new password' })).toBeVisible();
  }
  await page.getByLabel('New password', { exact: true }).fill(password);
  await page.getByLabel('Confirm password').fill(password);
  await page.keyboard.press('Enter'); // the form submits from the keyboard
  // The email code and the factor were verified once; the backend issues the MFA-assured session and the console opens with no second prompt.
  await expect(page).toHaveURL(/\/admin\/?$/);
  await expect(page.getByRole('heading', { name: "Verify it's you" })).toHaveCount(0);
}
/** The recovery session is real (it refreshes) and is then ended so the next steps exercise the normal sign-in. */
async function endRecoverySession(page: Page) {
  await expect.poll(async () => (await page.request.post('/api/auth/admin/refresh')).status()).toBe(200);
  await page.evaluate(() => fetch('/api/auth/admin/logout', { method: 'POST', credentials: 'include' }));
  await page.context().clearCookies();
}
async function signInPasswordStep(page: Page, email: string, password: string) {
  await page.goto('/admin/login');
  await page.getByLabel('Email Address').fill(email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: 'Sign In' }).click();
}

test.describe.serial('Task 05.2 administrator forgot-password (disposable)', () => {
  let api: APIRequestContext;
  let staff: Enrolled;
  let owner: Enrolled;
  const STAFF_PASSWORD_1 = `Recovered-${randomUUID().slice(0, 6)}-Pass1`;
  const STAFF_PASSWORD_2 = `Recovered-${randomUUID().slice(0, 6)}-Pass2`;
  const OWNER_PASSWORD = `Recovered-${randomUUID().slice(0, 6)}-Pass3`;

  test.beforeAll(async () => {
    api = await playwrightRequest.newContext({ baseURL: BASE });
    staff = await enrollViaApi(api, credentials.staffEmail);
    owner = await enrollViaApi(api, credentials.ownerEmail);
  });
  test.afterAll(async () => { await api.dispose(); });

  test('REC-UI-01 Journey A: Forgot Password → email code → authenticator → new password → dashboard with no second MFA; a later normal sign-in still needs password + TOTP', async ({ browser }) => {
    const page = await newPage(browser);
    await page.goto('/admin/login');
    await expect(page.getByRole('link', { name: 'Forgot Password?' })).toBeVisible(); // wait for the lazy page before capturing
    await capture(page, 'login-with-forgot-link', [390, 1440]);
    await reachMfaStep(page, staff.email);
    await expect(page.getByRole('tab', { name: /Authenticator app/ })).toBeVisible();
    await expect(page.getByRole('tab', { name: /Passkey/ })).toHaveCount(0); // only registered methods are offered
    await capture(page, 'recovery-mfa', [390, 768, 1440, 1920]);
    // A wrong code is refused and the journey stays on the step.
    await page.getByLabel('6-digit code').fill('000000');
    await page.keyboard.press('Enter');
    await expect(page.getByText(/isn't right|not valid/i).first()).toBeVisible();
    await page.getByLabel('6-digit code').fill(await freshCode(staff.secret));
    await page.keyboard.press('Enter');
    await capture(page, 'recovery-new-password', [390, 1440]);
    await setNewPassword(page, STAFF_PASSWORD_1, credentials.password);
    await capture(page, 'recovery-dashboard', [390, 1440]);
    // Nothing sensitive is kept in the browser; the session lives in the memory/cookie the normal login also uses.
    expect(await page.evaluate(() => Object.keys(window.localStorage).concat(Object.keys(window.sessionStorage)).join(','))).not.toMatch(/token|password/i);
    await endRecoverySession(page);

    // Old password is dead; the new one only reaches the normal MFA step, never the console.
    await signInPasswordStep(page, staff.email, credentials.password);
    await expect(page.getByRole('alert').first()).toBeVisible();
    await signInPasswordStep(page, staff.email, STAFF_PASSWORD_1);
    await expect(page.getByRole('heading', { name: "Verify it's you" })).toBeVisible();
    // Skipping the second verification: the console and its API stay closed, and nothing was stored.
    await page.goto('/admin/orders');
    await expect(page).toHaveURL(/\/admin\/login/);
    expect((await page.request.get('/api/admin/dashboard/overview')).status()).toBe(401);
    expect(await page.evaluate(() => Object.keys(window.localStorage).concat(Object.keys(window.sessionStorage)).join(','))).not.toMatch(/token|password/i);
    await signInPasswordStep(page, staff.email, STAFF_PASSWORD_1);
    await expect(page.getByRole('heading', { name: "Verify it's you" })).toBeVisible();
    await page.getByLabel('6-digit code').fill(await freshCode(staff.secret));
    await page.getByRole('button', { name: 'Verify and sign in' }).click();
    await expect(page).toHaveURL(/\/admin(\/orders)?\/?$/); // returns to the page that was requested before sign-in
    // The login MFA produced a fresh, MFA-assured session: the API now answers for this browser.
    await expect.poll(async () => (await page.request.post('/api/auth/admin/refresh')).status()).toBe(200);
  });

  test('REC-UI-02 Journey C + F: a recovery code works once, and the reset signs out every existing session', async ({ browser }) => {
    // Two independent signed-in sessions (recovery codes 1 and 2), then the reset from a third context with code 0.
    const sessions: Page[] = [];
    for (const code of [staff.recoveryCodes[1], staff.recoveryCodes[2]]) {
      const page = await newPage(browser);
      await signInPasswordStep(page, staff.email, STAFF_PASSWORD_1);
      await page.getByRole('tab', { name: 'Recovery code' }).click();
      await page.getByRole('textbox', { name: 'Recovery code' }).fill(code);
      await page.getByRole('button', { name: 'Verify and sign in' }).click();
      await expect(page).toHaveURL(/\/admin\/?$/);
      sessions.push(page);
    }
    const recoverer = await newPage(browser);
    await reachMfaStep(recoverer, staff.email);
    await recoverer.getByRole('tab', { name: 'Recovery code' }).click();
    await recoverer.getByRole('textbox', { name: 'Recovery code' }).fill(staff.recoveryCodes[0]);
    await recoverer.keyboard.press('Enter');
    await setNewPassword(recoverer, STAFF_PASSWORD_2);

    for (const page of sessions) {
      await page.goto('/admin/products');
      await expect(page).toHaveURL(/\/admin\/login/); // the live session is gone, not merely the cookie
    }
    // The same recovery code cannot prove a second recovery.
    const replay = await newPage(browser);
    await reachMfaStep(replay, staff.email);
    await replay.getByRole('tab', { name: 'Recovery code' }).click();
    await replay.getByRole('textbox', { name: 'Recovery code' }).fill(staff.recoveryCodes[0]);
    await replay.keyboard.press('Enter');
    await expect(replay.getByText(/not valid or has already been used/i)).toBeVisible();
    await expect(replay.getByRole('heading', { name: 'Create a new password' })).toHaveCount(0);
  });

  test('REC-UI-03 Journey B: a registered passkey proves identity once (Chromium virtual authenticator) and earns the session', async ({ browser }) => {
    const page = await newPage(browser);
    const cdp = await page.context().newCDPSession(page);
    await cdp.send('WebAuthn.enable');
    await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true,
      hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true } });
    await signInPasswordStep(page, owner.email, credentials.password);
    await page.getByLabel('6-digit code').fill(await freshCode(owner.secret));
    await page.getByRole('button', { name: 'Verify and sign in' }).click();
    await expect(page).toHaveURL(/\/admin\/?$/);
    await page.goto('/admin/profile/security');
    await page.getByRole('button', { name: 'Add passkey' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name').fill('Recovery virtual key');
    await dialog.getByRole('button', { name: 'Create passkey' }).click();
    await expect(page.getByText('Recovery virtual key')).toBeVisible();
    await page.evaluate(() => fetch('/api/auth/admin/logout', { method: 'POST', credentials: 'include' }));

    await reachMfaStep(page, owner.email);
    await page.getByRole('tab', { name: /Passkey/ }).click();
    await page.getByRole('button', { name: 'Use passkey' }).click(); // a real WebAuthn assertion, verified server-side
    await setNewPassword(page, OWNER_PASSWORD);
    // The passkey proof earned this session; ending it, the console is closed again until password + MFA.
    await endRecoverySession(page);
    await page.goto('/admin');
    await expect(page).toHaveURL(/\/admin\/login/);
    await signInPasswordStep(page, owner.email, OWNER_PASSWORD);
    await page.getByRole('tab', { name: 'Passkey' }).click();
    await page.getByRole('button', { name: 'Use passkey' }).click();
    await expect(page).toHaveURL(/\/admin\/?$/);
  });

  test('REC-UI-04 Journeys D, E, G: email alone cannot reset an administrator, the legacy endpoints are no bypass, and a factor-less account gets guidance', async ({ browser }) => {
    // E: the customer reset endpoints refuse an administrator even when the attacker controls the mailbox.
    const attacker = await playwrightRequest.newContext({ baseURL: BASE });
    await attacker.post('/api/auth/forgot-password', { data: { email: staff.email } });
    await attacker.post('/api/auth/admin/password-recovery/request', { data: { email: staff.email } });
    plantEmailCode(staff.email);
    const legacy = await attacker.post('/api/auth/verify-reset-otp', { data: { email: staff.email, code: KNOWN_CODE } });
    expect(legacy.status()).toBe(400);
    expect((await legacy.json()).resetToken).toBeUndefined();
    // D: the email code opens only a restricted transaction; it cannot be exchanged for a password reset.
    const emailOnly = await attacker.post('/api/auth/admin/password-recovery/verify-email', { data: { email: staff.email, code: KNOWN_CODE } });
    expect(emailOnly.status()).toBe(200);
    const body = await emailOnly.json();
    expect(body.resetToken).toBeUndefined();
    expect(body.accessToken).toBeUndefined();
    // (Exchanging the recovery token at /complete is refused too: PostgreSQL REC-03. Not repeated here to stay inside the per-IP recovery rate limit.)
    await attacker.dispose();

    // G: an administrator with no registered factor is told what to do, and there is no way to continue.
    const page = await newPage(browser);
    await reachMfaStep(page, credentials.legacyUnactivatedEmail);
    await expect(page.getByText(/cannot be recovered by email alone/i)).toBeVisible();
    await expect(page.getByRole('tab')).toHaveCount(0);
    await page.getByText("Can't access your verification methods?").click();
    await expect(page.getByText(/an Owner must confirm your identity/i)).toBeVisible();
    await capture(page, 'recovery-no-factor', [390, 1440]);
  });

  test('REC-UI-05 Journey H: customer password recovery is unchanged', async () => {
    const customer = await playwrightRequest.newContext({ baseURL: BASE });
    expect((await customer.post('/api/auth/forgot-password', { data: { email: credentials.customerEmail } })).status()).toBe(200);
    plantEmailCode(credentials.customerEmail);
    const verified = await customer.post('/api/auth/verify-reset-otp', { data: { email: credentials.customerEmail, code: KNOWN_CODE } });
    expect(verified.status()).toBe(200);
    const next = `Customer-${randomUUID().slice(0, 6)}-Pass7`;
    expect((await customer.post('/api/auth/reset-password', { data: { resetToken: (await verified.json()).resetToken, newPassword: next } })).status()).toBe(200);
    expect((await customer.post('/api/auth/login', { data: { email: credentials.customerEmail, password: next } })).status()).toBe(200);
    await customer.dispose();
  });
});
