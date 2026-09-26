import { expect, request, test } from '@playwright/test';
import { createHash, randomUUID } from 'node:crypto';
import { readFile, readdir, unlink } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const outboxDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../test-results/auth-outbox');
const runId = randomUUID();
const projectEmail = (projectName: string) => `e2e-auth-${runId}-${projectName}@electrohub.invalid`;
const supportToken = 'electrohub-e2e-support-only';
const supportBaseURL = `http://localhost:${process.env.E2E_AUTH_BACKEND_PORT ?? '5202'}`;
const firstPassword = 'TestPassword#2026';
const secondPassword = 'NewPassword#2026';
let testRecordsCreated = false;

async function capturedCode(subject: string, recipientEmail: string): Promise<string> {
  const fileName = createHash('sha256').update(`${recipientEmail}:${subject}`).digest('hex');
  try {
    const record = JSON.parse(await readFile(path.join(outboxDirectory, `${fileName}.json`), 'utf8')) as { textContent: string };
    return record.textContent.match(/\b\d{6}\b/)?.[0] ?? '';
  } catch {
    return '';
  }
}

async function openLogin(page: import('@playwright/test').Page) {
  await page.goto('/');
  if (await page.getByRole('navigation', { name: 'Primary navigation' }).isVisible()) {
    await page.getByRole('navigation', { name: 'Primary navigation' }).getByRole('link', { name: 'Account' }).click();
  } else {
    await page.getByRole('button', { name: 'Account', exact: true }).click();
  }
  return page.getByRole('dialog');
}

test.describe.serial('customer security flows', () => {
  test.beforeAll(async () => {
    expect(supportToken).toBeTruthy();
    const api = await request.newContext({ baseURL: supportBaseURL });
    const health = await api.get('/api/health');
    expect((await health.json()).data.environment).toBe('test');
    const response = await api.post('/api/__e2e/cleanup', {
      headers: { 'x-e2e-test-support-token': supportToken! },
      data: { runId },
    });
    expect(response.status()).toBe(200);
    await api.dispose();
  });

  test.afterAll(async () => {
    const api = await request.newContext({ baseURL: supportBaseURL });
    const response = await api.post('/api/__e2e/cleanup', {
      headers: { 'x-e2e-test-support-token': supportToken! },
      data: { runId },
    });
    expect(response.status()).toBe(200);
    const counts = await response.json() as { users: number; emailDeliveries: number };
    if (testRecordsCreated) expect(counts.users).toBeGreaterThan(0);
    const secondCleanup = await api.post('/api/__e2e/cleanup', {
      headers: { 'x-e2e-test-support-token': supportToken! },
      data: { runId },
    });
    expect(await secondCleanup.json()).toMatchObject({ users: 0, emailDeliveries: 0 });
    await api.dispose();

    for (const fileName of await readdir(outboxDirectory).catch(() => [])) {
      const filePath = path.join(outboxDirectory, fileName);
      const record = JSON.parse(await readFile(filePath, 'utf8')) as { to?: string };
      if (record.to?.includes(runId)) await unlink(filePath);
    }
  });

  test.beforeEach(async ({ page }, testInfo) => {
    const hash = createHash('sha256').update(`${testInfo.project.name}:${testInfo.title}`).digest('hex');
    const source = Number.parseInt(hash.slice(0, 2), 16) % 254 + 1;
    await page.context().setExtraHTTPHeaders({ 'X-Forwarded-For': `198.51.100.${source}` });
  });

  test('registers through UI, rejects a wrong OTP, then verifies and authenticates', async ({ page }, testInfo) => {
    const email = projectEmail(testInfo.project.name);
    const dialog = await openLogin(page);
    await dialog.getByRole('button', { name: 'Register' }).click();
    await dialog.getByLabel('Full Name').fill('E2E Customer');
    await dialog.getByLabel('Email Address').fill(email);
    await dialog.getByRole('button', { name: 'Show password' }).first().click();
    await expect(dialog.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'text');
    await dialog.getByRole('button', { name: 'Hide password' }).click();
    await dialog.getByLabel('Password', { exact: true }).fill(firstPassword);
    await dialog.getByRole('button', { name: 'Show password' }).nth(1).click();
    await expect(dialog.getByLabel('Confirm Password')).toHaveAttribute('type', 'text');
    await dialog.getByRole('button', { name: 'Hide password' }).click();
    await dialog.getByLabel('Confirm Password').fill(firstPassword);
    await dialog.getByRole('button', { name: 'Create Account' }).click();

    await expect(dialog.getByText(`Enter the 6-digit code sent to e***@electrohub.invalid`)).toBeVisible();
    testRecordsCreated = true;
    await expect(dialog.getByRole('textbox', { name: 'Verification code, digit 1 of 6' })).toBeVisible();
    await expect(dialog.getByText(/Resend available in \d+s/)).toBeVisible();
    await expect(page.locator('body')).not.toContainText(/prisma\.user\.findUnique|self-signed certificate|DATABASE_URL/i);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: testInfo.outputPath('verification-ui.png') });
    const inputs = dialog.getByRole('group', { name: 'Verification code' }).getByRole('textbox');
    await inputs.nth(0).press('Enter');
    await expect(dialog.getByRole('button', { name: 'Verify' })).toBeDisabled();
    await expect(dialog.getByText('Incorrect verification code. Please try again.')).toHaveCount(0);
    for (const [index, digit] of [...'000000'].entries()) await inputs.nth(index).fill(digit);
    await dialog.getByRole('button', { name: 'Verify' }).click();
    await expect(dialog.getByRole('alert')).toHaveText('Incorrect verification code. Please try again.');

    await expect.poll(() => capturedCode('Verify your ElectroHub account', email)).toMatch(/^\d{6}$/);
    const originalCode = await capturedCode('Verify your ElectroHub account', email);
    await expect(dialog.getByRole('button', { name: 'Resend Code' })).toBeVisible({ timeout: 70_000 });
    await dialog.getByRole('button', { name: 'Resend Code' }).click();
    await expect(dialog.getByText(/Resend available in \d+s/)).toBeVisible();
    await expect.poll(() => capturedCode('Verify your ElectroHub account', email)).not.toBe(originalCode);
    const code = await capturedCode('Verify your ElectroHub account', email);
    await inputs.nth(0).focus();
    await page.keyboard.type(code);
    await expect(inputs.nth(5)).toHaveValue(code[5]!);
    await inputs.nth(5).press('Enter');
    await expect(page).toHaveURL(/\/account/);
    await expect(dialog).not.toBeVisible();
    await expect(page.getByText(email).first()).toBeVisible();
    const replay = await page.request.post('/api/auth/verify-email', { data: { email, code } });
    expect(replay.status()).toBe(400);
    await page.screenshot({ path: testInfo.outputPath('verified-account.png') });
  });

  test('forgot password uses a captured test OTP and invalidates the old password', async ({ page }) => {
    const email = projectEmail(test.info().project.name);
    const directApi = await request.newContext({ baseURL: supportBaseURL });
    let ipOctet = 10;
    const nextIpHeaders = () => ({ 'X-Forwarded-For': `192.0.2.${ipOctet++}` });
    const requestResetCode = async () => {
      const response = await page.request.post('/api/auth/forgot-password', { data: { email }, headers: nextIpHeaders() });
      expect(response.status()).toBe(200);
      await expect.poll(() => capturedCode('Reset your ElectroHub password', email)).toMatch(/^\d{6}$/);
      return capturedCode('Reset your ElectroHub password', email);
    };
    const assertPasswordWorks = async (password: string) => {
      const response = await directApi.post('/api/auth/login', { data: { email, password }, headers: nextIpHeaders() });
      expect(response.status()).toBe(200);
    };
    const oldSession = await page.request.post('/api/auth/login', { data: { email, password: firstPassword } });
    expect(oldSession.status()).toBe(200);
    const oldCookie = oldSession.headers()['set-cookie']?.split(';')[0];
    expect(oldCookie).toBeTruthy();

    const expiredOtp = await requestResetCode();
    const expiredChallenge = await page.request.post(`${supportBaseURL}/api/__e2e/expire-otp`, {
      headers: { 'x-e2e-test-support-token': supportToken!, ...nextIpHeaders() },
      data: { email, purpose: 'PASSWORD_RESET' },
    });
    expect(await expiredChallenge.json()).toMatchObject({ expired: 1 });
    const expiredOtpResponse = await page.request.post('/api/auth/verify-reset-otp', {
      headers: nextIpHeaders(), data: { email, code: expiredOtp },
    });
    expect(expiredOtpResponse.status()).toBe(400);
    expect((await expiredOtpResponse.json()).error.code).toBe('OTP_EXPIRED');
    await assertPasswordWorks(firstPassword);

    const lockedOtp = await requestResetCode();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const wrongAttempt = await page.request.post('/api/auth/verify-reset-otp', {
        headers: nextIpHeaders(), data: { email, code: '000000' },
      });
      expect(wrongAttempt.status()).toBe(attempt === 4 ? 429 : 400);
    }
    const correctAfterLock = await page.request.post('/api/auth/verify-reset-otp', {
      headers: nextIpHeaders(), data: { email, code: lockedOtp },
    });
    expect(correctAfterLock.status()).toBe(429);
    expect((await correctAfterLock.json()).error.code).toBe('OTP_ATTEMPTS_EXHAUSTED');

    const replayOtp = await requestResetCode();
    const authorizationResponse = await page.request.post('/api/auth/verify-reset-otp', {
      headers: nextIpHeaders(), data: { email, code: replayOtp },
    });
    expect(authorizationResponse.status()).toBe(200);
    const firstResetToken = (await authorizationResponse.json()).resetToken as string;
    expect((await page.request.post('/api/auth/verify-reset-otp', {
      headers: nextIpHeaders(), data: { email, code: replayOtp },
    })).status()).toBe(400);
    expect((await page.request.post('/api/auth/reset-password', {
      headers: nextIpHeaders(), data: { resetToken: `${firstResetToken}tampered`, newPassword: secondPassword },
    })).status()).toBe(400);
    await assertPasswordWorks(firstPassword);
    const expiredAuthorization = await page.request.post(`${supportBaseURL}/api/__e2e/expire-reset-authorization`, {
      headers: { 'x-e2e-test-support-token': supportToken!, ...nextIpHeaders() },
      data: { email },
    });
    expect(await expiredAuthorization.json()).toMatchObject({ expired: 1 });
    expect((await page.request.post('/api/auth/reset-password', {
      headers: nextIpHeaders(), data: { resetToken: firstResetToken, newPassword: secondPassword },
    })).status()).toBe(400);
    await assertPasswordWorks(firstPassword);

    await page.context().clearCookies();

    const dialog = await openLogin(page);
    await dialog.getByLabel('Email Address').fill(email);
    await dialog.getByRole('button', { name: 'Forgot Password?' }).click();
    await expect(dialog.getByLabel('Email Address')).toHaveValue(email);
    await expect(dialog.getByLabel('Email Address')).toBeEnabled();
    await dialog.getByRole('button', { name: 'Send Reset Code' }).click();
    await expect(dialog.getByText('Verify your email')).toBeVisible();
    await expect.poll(() => capturedCode('Reset your ElectroHub password', email)).toMatch(/^\d{6}$/);
    const resetDigits = dialog.getByRole('group', { name: 'Verification code' }).getByRole('textbox');
    const resetCode = await capturedCode('Reset your ElectroHub password', email);
    for (const [index, digit] of [...resetCode].entries()) await resetDigits.nth(index).fill(digit);
    let successfulResetToken = '';
    page.on('response', async (response) => {
      if (response.url().endsWith('/api/auth/verify-reset-otp') && response.status() === 200) {
        successfulResetToken = (await response.json()).resetToken as string;
      }
    });
    await dialog.getByRole('button', { name: 'Verify' }).click();
    await expect(dialog.getByRole('heading', { name: 'Create new password' })).toBeVisible();
    await dialog.getByRole('button', { name: 'Show password' }).nth(0).click();
    await expect(dialog.getByLabel('New Password')).toHaveAttribute('type', 'text');
    await dialog.getByRole('button', { name: 'Hide password' }).nth(0).click();
    await dialog.getByRole('button', { name: 'Show password' }).nth(1).click();
    await expect(dialog.getByLabel('Confirm Password')).toHaveAttribute('type', 'text');
    await dialog.getByRole('button', { name: 'Hide password' }).nth(0).click();
    await dialog.getByLabel('New Password').fill(secondPassword);
    await dialog.getByLabel('Confirm Password').fill(secondPassword);
    await dialog.getByRole('button', { name: /Reset Password/i }).click();
    await expect(dialog.getByText('Password changed successfully.')).toBeVisible();
    expect(successfulResetToken).toBeTruthy();
    expect((await page.request.post('/api/auth/reset-password', {
      headers: nextIpHeaders(), data: { resetToken: successfulResetToken, newPassword: 'ThirdPassword#2026' },
    })).status()).toBe(400);
    await assertPasswordWorks(secondPassword);
    const oldRefresh = await page.request.post('/api/auth/refresh', { headers: { Cookie: oldCookie! } });
    expect(oldRefresh.status()).toBe(401);
    await dialog.getByRole('button', { name: 'Continue to Login' }).click();
    await expect(dialog.getByLabel('Email Address')).toHaveValue(email);
    await expect(dialog.getByLabel('Password', { exact: true })).toHaveValue('');
    expect((await page.context().cookies()).some((cookie) => cookie.name === 'electrohub_refresh')).toBe(false);
    expect((await page.request.get('/api/auth/me')).status()).toBe(401);
    await dialog.getByLabel('Password', { exact: true }).fill(firstPassword);
    await dialog.getByRole('button', { name: 'Login', exact: true }).click();
    await expect(dialog.getByText('Invalid credentials')).toBeVisible();
    await dialog.getByLabel('Password', { exact: true }).fill(secondPassword);
    await dialog.getByRole('button', { name: 'Login', exact: true }).click();
    await expect(page).toHaveURL(/\/account/);
    await directApi.dispose();
  });

  test('changes password through account UI and revokes its previous refresh session', async ({ page }, testInfo) => {
    const email = projectEmail(testInfo.project.name);
    const dialog = await openLogin(page);
    await dialog.getByLabel('Email Address').fill(email);
    await dialog.getByLabel('Password', { exact: true }).fill(secondPassword);
    await dialog.getByRole('button', { name: 'Login', exact: true }).click();
    await expect(page).toHaveURL(/\/account/);
    const oldCookies = await page.context().cookies(`${testInfo.project.use.baseURL || 'http://localhost:3202'}/api/auth/refresh`);
    const oldCookie = oldCookies.find((cookie) => cookie.name === 'electrohub_refresh');
    expect(oldCookie).toBeDefined();
    await page.getByRole('button', { name: 'Edit profile' }).click();
    await expect(page).toHaveURL(/\/account\/profile/);
    await page.getByLabel('First Name').fill('Persisted Profile');
    await page.getByRole('button', { name: 'Save Profile' }).click();
    await expect(page.getByText('Profile updated successfully.')).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('First Name')).toHaveValue('Persisted Profile');

    const changedEmail = email.replace('e2e-auth-', 'e2e-profile-email-');
    await page.getByLabel('Email Address').fill(changedEmail);
    await page.getByRole('button', { name: 'Save Profile' }).click();
    await expect(page.getByText(/A verification code was requested for the new address/)).toBeVisible();
    await expect.poll(() => capturedCode('Verify your ElectroHub account', changedEmail)).toMatch(/^\d{6}$/);
    const emailChangeInputs = page.getByRole('group', { name: 'Verification code' }).getByRole('textbox');
    await emailChangeInputs.nth(0).focus();
    await page.keyboard.type(await capturedCode('Verify your ElectroHub account', changedEmail));
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page.getByText('Email changed successfully.')).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Email Address')).toHaveValue(changedEmail);

    await page.getByLabel('Current Password').fill('wrong-password');
    await page.getByRole('button', { name: 'Show password' }).nth(0).click();
    await expect(page.getByLabel('Current Password')).toHaveAttribute('type', 'text');
    await page.getByRole('button', { name: 'Hide password' }).nth(0).click();
    await page.getByRole('button', { name: 'Show password' }).nth(1).click();
    await expect(page.getByLabel('New Password', { exact: true })).toHaveAttribute('type', 'text');
    await page.getByRole('button', { name: 'Hide password' }).click();
    await page.getByRole('button', { name: 'Show password' }).nth(2).click();
    await expect(page.getByLabel('Confirm New Password')).toHaveAttribute('type', 'text');
    await page.getByRole('button', { name: 'Hide password' }).click();
    await page.getByLabel('New Password', { exact: true }).fill('FinalPassword#2026');
    await page.getByLabel('Confirm New Password').fill('FinalPassword#2026');
    await page.getByRole('button', { name: 'Change Password' }).click();
    await expect(page.getByText('Incorrect current password')).toBeVisible();
    await page.getByLabel('Current Password').fill(secondPassword);
    await page.getByRole('button', { name: 'Change Password' }).click();
    await expect(page.getByText('Password changed successfully.')).toBeVisible();
    const previousRefresh = await page.request.post('/api/auth/refresh', {
      headers: { Cookie: `electrohub_refresh=${oldCookie!.value}` },
    });
    expect(previousRefresh.status()).toBe(401);
    expect((await page.request.post('/api/auth/login', { data: { email: changedEmail, password: secondPassword } })).status()).toBe(401);
    expect((await page.request.post('/api/auth/login', { data: { email: changedEmail, password: 'FinalPassword#2026' } })).status()).toBe(200);
  });

  test('unverified login opens verification without creating a session', async ({ page }) => {
    const email = projectEmail(test.info().project.name);
    const unverifiedEmail = email.replace('e2e-auth-', 'e2e-unverified-');
    const registration = await page.request.post('/api/auth/register', {
      data: { email: unverifiedEmail, password: firstPassword, firstName: 'Unverified', lastName: 'Customer' },
    });
    expect(registration.status()).toBe(201);
    expect((await page.context().cookies()).some((cookie) => cookie.name === 'electrohub_refresh')).toBe(false);

    const knownResend = await page.request.post(`${supportBaseURL}/api/auth/resend-verification`, {
      headers: { 'X-Forwarded-For': '192.0.2.201' }, data: { email: unverifiedEmail },
    });
    const unknownResend = await page.request.post(`${supportBaseURL}/api/auth/resend-verification`, {
      headers: { 'X-Forwarded-For': '192.0.2.202' }, data: { email: email.replace('e2e-auth-', 'e2e-no-challenge-') },
    });
    expect(knownResend.status()).toBe(200);
    expect(unknownResend.status()).toBe(200);
    const knownResendBody = await knownResend.json();
    const unknownResendBody = await unknownResend.json();
    expect(knownResendBody.message).toBe(unknownResendBody.message);
    expect(Object.keys(knownResendBody).sort()).toEqual(Object.keys(unknownResendBody).sort());
    expect(new Date(knownResendBody.resendAvailableAt).getTime()).toBeGreaterThan(Date.now());
    expect(new Date(unknownResendBody.resendAvailableAt).getTime()).toBeGreaterThan(Date.now());

    const dialog = await openLogin(page);
    await dialog.getByLabel('Email Address').fill(unverifiedEmail);
    await dialog.getByRole('button', { name: 'Show password' }).click();
    await expect(dialog.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'text');
    await dialog.getByRole('button', { name: 'Hide password' }).click();
    await dialog.getByLabel('Password', { exact: true }).fill(firstPassword);
    await dialog.getByRole('button', { name: 'Login', exact: true }).click();
    await expect(dialog.getByText('Enter the 6-digit code sent to e***@electrohub.invalid')).toBeVisible();
    expect((await page.context().cookies()).some((cookie) => cookie.name === 'electrohub_refresh')).toBe(false);
    await expect.poll(() => capturedCode('Verify your ElectroHub account', unverifiedEmail)).toMatch(/^\d{6}$/);
    await dialog.getByRole('button', { name: 'Change email' }).click();
    const changedEmail = unverifiedEmail.replace('e2e-unverified-', 'e2e-corrected-');
    await dialog.getByLabel('New Email Address').fill(changedEmail);
    await dialog.getByRole('button', { name: 'Send Verification Code' }).click();
    await expect.poll(() => capturedCode('Verify your ElectroHub account', changedEmail)).toMatch(/^\d{6}$/);
    const inputs = dialog.getByRole('group', { name: 'Verification code' }).getByRole('textbox');
    for (const [index, digit] of [...await capturedCode('Verify your ElectroHub account', changedEmail)].entries()) {
      await inputs.nth(index).fill(digit);
    }
    await dialog.getByRole('button', { name: 'Verify' }).click();
    await expect(page).toHaveURL(/\/account/);
    await expect(page.getByText(changedEmail).first()).toBeVisible();
  });

  test('unknown-email recovery shows the same reset-code screen', async ({ page }) => {
    const email = projectEmail(test.info().project.name);
    const dialog = await openLogin(page);
    await dialog.getByRole('button', { name: 'Forgot Password?' }).click();
    const unknownEmail = email.replace('e2e-auth-', 'e2e-unknown-');
    await dialog.getByLabel('Email Address').fill(unknownEmail);
    await dialog.getByRole('button', { name: 'Send Reset Code' }).click();
    await expect(dialog.getByText('Verify your email')).toBeVisible();
    await expect(dialog.getByRole('group', { name: 'Verification code' })).toBeVisible();
    expect(await capturedCode('Reset your ElectroHub password', unknownEmail)).toBe('');
  });

  test('password-reset 429 remains neutral and renders the controlled UI message', async ({ page }) => {
    const email = projectEmail(test.info().project.name).replace('e2e-auth-', 'e2e-rate-limit-');
    for (let attempt = 0; attempt < 5; attempt += 1) {
      const accepted = await page.request.post('/api/auth/forgot-password', { data: { email } });
      expect(accepted.status()).toBe(200);
      expect((await accepted.json()).message).toBe('If an account exists, you may receive password reset instructions shortly.');
    }
    const limited = await page.request.post('/api/auth/forgot-password', { data: { email } });
    expect(limited.status()).toBe(429);
    expect(await limited.json()).toEqual({
      error: { code: 'RATE_LIMITED', message: 'Too many password reset attempts. Please try again in an hour.' },
    });

    const dialog = await openLogin(page);
    await dialog.getByLabel('Email Address').fill(email);
    await dialog.getByRole('button', { name: 'Forgot Password?' }).click();
    await dialog.getByRole('button', { name: 'Send Reset Code' }).click();
    await expect(dialog.getByRole('alert')).toHaveText('Too many password reset attempts. Please try again in an hour.');
  });

  test('browser shows generic messaging for a backend-injected unexpected failure', async ({ page }) => {
    await page.setExtraHTTPHeaders({
      'X-Forwarded-For': '192.0.2.250',
      'X-E2E-Inject-Failure': 'unexpected-auth-failure',
    });
    const dialog = await openLogin(page);
    await dialog.getByRole('button', { name: 'Register' }).click();
    await dialog.getByLabel('Full Name').fill('Failure Probe');
    await dialog.getByLabel('Email Address').fill(`e2e-failure-${runId}-${test.info().project.name}@electrohub.invalid`);
    await dialog.getByLabel('Password', { exact: true }).fill(firstPassword);
    await dialog.getByLabel('Confirm Password').fill(firstPassword);
    await dialog.getByRole('button', { name: 'Create Account' }).click();
    await expect(dialog.getByRole('alert')).toContainText('Something went wrong. Please try again later.');
    await expect(dialog).not.toContainText(/Prisma|SQL|DATABASE_URL|TLS|certificate|C:\\|stack trace/i);
  });
});
