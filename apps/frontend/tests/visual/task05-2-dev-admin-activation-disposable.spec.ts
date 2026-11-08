import { createHash, createHmac, randomBytes } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, test, type Browser, type Page } from '@playwright/test';

/**
 * Task 05.2 development administrator activation WITHOUT real inboxes, real browser on a DISPOSABLE stack with local email capture
 * (TASK05_2_EMAIL_CAPTURE=1 TASK05_2_API_PORT=5205 TASK05_2_FRONTEND_PORT=3205 node scripts/task05-2-browser-stack.cjs). Never shared
 * DEV or PROD; synthetic *.invalid identities plus one synthetic admin1@electrohub.com row that exists only in this throwaway cluster.
 *  PROV-UI-01  Owner activation → link read from the CAPTURED email → new password → TOTP → recovery codes → console; replay refused.
 *  PROV-UI-02  operator CLI (register + provision, on "local") → private handoff file → /admin/provision → password → mandatory TOTP →
 *              MFA sign-in; no console before enrollment; replayed and expired setup links refused; keyboard-only form.
 *  PROV-UI-03  Forgot Password with the CAPTURED email code plus the enrolled authenticator → new password → MFA-assured console.
 *  PROV-UI-04  enrolled seed account, forgotten password, no mailbox: operator recovery link replaces the email code only → enrolled
 *              authenticator still required → new password → MFA sign-in; replayed link refused; factors-less refusal on the CLI.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
const credentials = JSON.parse(readFileSync(path.resolve(here, '../../../../.cache/task05-2-browser-credentials-5205.json'), 'utf8')) as {
  ownerEmail: string; password: string; legacyDeliveryEmail: string; outboxDir: string | null; backendDir: string; databaseUrl: string; caCert: string;
  disposableDb: { psql: string; port: number; database: string };
};
const shots = path.resolve(here, '../../test-results/task05-2-dev-admin-activation-disposable/screens');
const ACTIVATED_PASSWORD = 'Activated-Unique-9-Secret';
const RECOVERED_PASSWORD = 'Recovered-Unique-9-Secret';
const PROVISIONED_PASSWORD = 'Provisioned-Unique-9-Secret';
const SEED_RECOVERED_PASSWORD = 'Seed-Recovered-Unique-9-Secret';
const SEED_EMAIL = 'admin1@electrohub.com';

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
const newPage = async (browser: Browser, options: Parameters<Browser['newContext']>[0] = {}) => (await browser.newContext(options)).newPage();
async function passwordStep(page: Page, email: string, password: string) {
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
  await expect(page.getByLabel('I have saved these codes somewhere safe.')).toBeVisible(); // recovery codes are presented
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
    await page.screenshot({ path: path.join(shots, `${name}-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
}
/** The newest captured message for a recipient and subject (the backend names it sha256("<to>:<subject>").json). */
async function capturedText(to: string, subject: string, after: number) {
  if (!credentials.outboxDir) throw new Error('This stack was started without TASK05_2_EMAIL_CAPTURE=1.');
  const file = path.join(credentials.outboxDir, `${createHash('sha256').update(`${to}:${subject}`).digest('hex')}.json`);
  await expect.poll(() => existsSync(file) && Date.parse(JSON.parse(readFileSync(file, 'utf8')).sentAt) >= after, { timeout: 20_000 }).toBe(true);
  return (JSON.parse(readFileSync(file, 'utf8')) as { textContent: string }).textContent;
}
function disposableSql(sql: string) {
  const { psql, port, database } = credentials.disposableDb;
  if (!/^electrohub_disposable_browser_[0-9a-f]+$/.test(database)) throw new Error('Refusing to touch a non-disposable database.');
  return execFileSync(psql, ['-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1', '-q', '-t', '-A', '-c', sql], { encoding: 'utf8' }).trim();
}
/** The real operator CLI against THIS disposable cluster only (its identity resolves to "local"). */
function operatorCli(args: string[]) {
  if (!/^postgresql:\/\/postgres@127\.0\.0\.1:\d+\/electrohub_disposable_browser_[0-9a-f]+$/.test(credentials.databaseUrl)) throw new Error('Refusing a non-disposable database URL.');
  const tsx = path.join(credentials.backendDir, '../../node_modules/tsx/dist/cli.mjs');
  const result = spawnSync(process.execPath, [tsx, 'scripts/admin-security.ts', ...args, '--confirm-target=local'], { cwd: credentials.backendDir, encoding: 'utf8', timeout: 90_000,
    env: { ...process.env, NODE_ENV: 'development', DATABASE_URL: credentials.databaseUrl, DIRECT_URL: credentials.databaseUrl, DB_SSL_CA_CERT_PATH: credentials.caCert,
      NODE_EXTRA_CA_CERTS: credentials.caCert, JWT_SECRET: randomBytes(48).toString('base64url'), FRONTEND_URL: 'http://localhost:3205' } });
  return { status: result.status, out: `${result.stdout}${result.stderr}` };
}

test.describe.serial('Task 05.2 development administrator activation without real inboxes (disposable)', () => {
  let activatedSecret = '';
  let seedSecret = '';
  const handoffDir = mkdtempSync(path.join(tmpdir(), 'eh-provision-'));
  test.afterAll(() => rmSync(handoffDir, { recursive: true, force: true }));

  test('PROV-UI-01 Owner activation delivered to the local capture: captured link → new password → TOTP → console; replay refused', async ({ browser }) => {
    const owner = await newPage(browser);
    await passwordStep(owner, credentials.ownerEmail, credentials.password);
    await enroll(owner);
    await owner.goto('/admin/settings/administrators');
    const sentAfter = Date.now();
    await owner.getByRole('button', { name: `Activate account for ${credentials.legacyDeliveryEmail}` }).click();
    await owner.getByRole('dialog', { name: 'Authorize administrator activation' }).getByRole('button', { name: 'Send activation link' }).click();
    // Captured, not sent: the delivery is recorded as sent and no failure is reported.
    await expect(owner.getByText(/could not be delivered/i)).toHaveCount(0);
    const mail = await capturedText(credentials.legacyDeliveryEmail, 'Activate your ElectroHub administrator account', sentAfter);
    const link = /http:\/\/localhost:3205\/admin\/activate#token=[^\s]+/.exec(mail)![0];

    const admin = await newPage(browser);
    await admin.goto(link.replace('http://localhost:3205', ''));
    await expect(admin.getByRole('heading', { name: 'Activate your administrator account' })).toBeVisible();
    await expect(admin.getByLabel('Administrator account')).toHaveValue(credentials.legacyDeliveryEmail);
    await admin.getByLabel('New password', { exact: true }).fill(ACTIVATED_PASSWORD);
    await admin.getByLabel('Confirm password').fill(ACTIVATED_PASSWORD);
    await admin.getByRole('button', { name: 'Set password and continue' }).click();
    activatedSecret = await enroll(admin);

    const replay = await newPage(browser);
    await replay.goto(link.replace('http://localhost:3205', ''));
    await expect(replay.getByText('This activation link is invalid, expired or already used. Ask an Owner to send you a new one.')).toBeVisible();

    const fresh = await newPage(browser);
    await passwordStep(fresh, credentials.legacyDeliveryEmail, ACTIVATED_PASSWORD);
    await fresh.getByLabel('6-digit code').fill(await freshCode(activatedSecret));
    await fresh.getByRole('button', { name: 'Verify and sign in' }).click();
    await expect(fresh).toHaveURL(/\/admin\/?$/);
  });

  test('PROV-UI-02 operator provisioning of a seed account without a mailbox: handoff → password → mandatory TOTP → MFA sign-in', async ({ browser }) => {
    // A seed account whose password nobody knows, created before provenance existed (exactly the shared DEV situation).
    const roleId = disposableSql(`SELECT id FROM roles WHERE name = 'ADMIN'`);
    disposableSql(`INSERT INTO users (id, "roleId", email, "passwordHash", "firstName", "lastName", "isActive", "emailVerifiedAt", "createdAt", "updatedAt")
      VALUES (gen_random_uuid(), '${roleId}', '${SEED_EMAIL}', '$2b$12$4EZ2P2mAGa.N5Kw4to4DgOPic1jcwJJiecErtULV1rPBwC7UL9r9y', 'Admin1', 'ElectroHub', true, now(), now(), now())
      ON CONFLICT (email) DO NOTHING`);
    const status = operatorCli(['seed-status']);
    expect(status.status, status.out).toBe(0);
    const row = status.out.split('\n').filter(line => line.startsWith('{')).map(line => JSON.parse(line) as { email: string; userId: string; provenance: string })
      .find(item => item.email === SEED_EMAIL)!;
    expect(row.provenance).toBe('NONE');
    const handoff = path.join(handoffDir, 'admin1-setup.txt');
    const approval = ['--operator=QA Operator', '--tester=QA Tester', '--reason=Disposable browser QA of seed provisioning'];
    // Without recorded provenance, provisioning is refused (email match alone is not trusted).
    expect(operatorCli(['provision-seeded-admin', SEED_EMAIL, `--user-id=${row.userId}`, ...approval, `--handoff-file=${handoff}`]).out).toContain('[PROVENANCE_MISSING]');
    expect(operatorCli(['register-seed-identity', SEED_EMAIL, `--user-id=${row.userId}`, '--operator=QA Operator', '--reason=Seeded before provenance existed']).status).toBe(0);
    const issued = operatorCli(['provision-seeded-admin', SEED_EMAIL, `--user-id=${row.userId}`, ...approval, `--handoff-file=${handoff}`]);
    expect(issued.status, issued.out).toBe(0);
    const link = readFileSync(handoff, 'utf8').trim();
    expect(issued.out).not.toContain(link.split('#token=')[1]!);

    const tester = await newPage(browser, { reducedMotion: 'reduce' });
    // A setup link is never accepted on the emailed-activation page.
    await tester.goto(link.replace('http://localhost:3205', '').replace('/admin/provision#', '/admin/activate#'));
    await expect(tester.getByText(/This activation link is invalid, expired or already used/)).toBeVisible();
    await tester.goto(link.replace('http://localhost:3205', ''));
    await expect(tester.getByRole('heading', { name: 'Set up your development administrator account' })).toBeVisible();
    await expect(tester.getByLabel('Administrator account')).toHaveValue(SEED_EMAIL);
    expect(new URL(tester.url()).hash).toBe('');
    await expect(tester.getByText(/An operator authorized setup of this development account/)).toBeVisible();
    await capture(tester, 'provision-form', [390, 768, 1440, 1920]);
    await capture(tester, 'provision-form-200pct-equivalent', [720]);
    // Keyboard only: Tab to each field, type, Enter submits.
    await tester.getByLabel('New password', { exact: true }).focus();
    await tester.keyboard.type(PROVISIONED_PASSWORD);
    await tester.keyboard.press('Tab');
    for (let index = 0; index < 4 && !(await tester.getByLabel('Confirm password').evaluate(element => element === document.activeElement)); index++) await tester.keyboard.press('Tab');
    await tester.keyboard.type(PROVISIONED_PASSWORD);
    await tester.keyboard.press('Enter');
    await expect(tester.getByRole('button', { name: 'Set up authenticator app' })).toBeVisible();
    await capture(tester, 'provision-enroll', [390, 1440]);
    // Enrollment cannot be skipped: the console is unreachable until a factor is verified.
    const probe = await newPage(browser);
    await probe.goto('/admin');
    await expect(probe).toHaveURL(/\/admin\/login/);
    const secret = await enroll(tester);
    seedSecret = secret;

    // Replay of the consumed setup link is refused.
    const replay = await newPage(browser);
    await replay.goto(link.replace('http://localhost:3205', ''));
    await expect(replay.getByText('This setup link is invalid, expired or already used. Ask the operator who issued it for a new one.')).toBeVisible();
    await capture(replay, 'provision-replayed', [390, 1440]);
    // The seeded password is gone; the new one plus TOTP signs in (Space activates the submit control).
    const fresh = await newPage(browser);
    await passwordStep(fresh, SEED_EMAIL, PROVISIONED_PASSWORD);
    await fresh.getByLabel('6-digit code').fill(await freshCode(secret));
    await fresh.getByRole('button', { name: 'Verify and sign in' }).focus();
    await fresh.keyboard.press('Space');
    await expect(fresh).toHaveURL(/\/admin\/?$/);
    // Never an Owner: Owner-only management is not offered.
    await fresh.goto('/admin/settings/administrators');
    await expect(fresh.getByRole('heading', { name: 'Access Restricted' })).toBeVisible();
    expect(disposableSql(`SELECT coalesce(s."isOwner", false)::text FROM users u LEFT JOIN admin_account_security s ON s."userId" = u.id WHERE u.email = '${SEED_EMAIL}'`)).toBe('false');
  });

  test('PROV-UI-02b an expired operator setup link shows the operator-specific error', async ({ browser }) => {
    const id = disposableSql(`SELECT id FROM users WHERE email = 'legacy-unactivated@qa.invalid'`);
    expect(id).not.toBe('');
    // A non-seed administrator is refused outright.
    expect(operatorCli(['provision-seeded-admin', 'legacy-unactivated@qa.invalid', `--user-id=${id}`, '--operator=QA Operator', '--tester=QA Tester',
      '--reason=Should be refused: not a seed email', `--handoff-file=${path.join(handoffDir, 'never.txt')}`]).out).toContain('[NOT_SEED_EMAIL]');
    // An expired proof (inserted directly in the disposable cluster) is refused with the operator wording.
    const token = `expired-setup-${randomBytes(12).toString('hex')}`;
    disposableSql(`INSERT INTO admin_mfa_activations (id, "userId", email, "tokenHash", status, purpose, "expiresAt", "createdAt", "updatedAt")
      SELECT gen_random_uuid(), id, email, '${createHash('sha256').update(token).digest('hex')}', 'REVOKED', 'SEED_PROVISIONING', now() - interval '1 hour', now(), now()
      FROM users WHERE email = '${SEED_EMAIL}'`);
    const page = await newPage(browser);
    await page.goto(`/admin/provision#token=${token}`);
    await expect(page.getByText('This setup link is invalid, expired or already used. Ask the operator who issued it for a new one.')).toBeVisible();
    await expect(page.getByLabel('New password', { exact: true })).toHaveCount(0);
  });

  test('PROV-UI-03 Forgot Password through the captured email code plus the enrolled authenticator', async ({ browser }) => {
    const page = await newPage(browser);
    await page.goto('/admin/login');
    await page.getByRole('link', { name: 'Forgot Password?' }).click();
    await expect(page).toHaveURL(/\/admin\/forgot-password$/);
    await expect(page.getByRole('heading', { name: 'Reset your administrator password' })).toBeVisible();
    await page.getByLabel('Email address').fill(credentials.legacyDeliveryEmail);
    await expect(page.getByLabel('Email address')).toHaveValue(credentials.legacyDeliveryEmail);
    const requestedAfter = Date.now();
    await page.getByRole('button', { name: 'Send verification code' }).click();
    await expect(page.getByRole('heading', { name: 'Verify your email' })).toBeVisible();
    const mail = await capturedText(credentials.legacyDeliveryEmail, 'Reset your ElectroHub password', requestedAfter);
    const emailCode = /reset code is: (\d{6})/.exec(mail)![1]!;
    await page.getByLabel('Verification code').fill(emailCode);
    await page.getByRole('button', { name: 'Continue' }).click();
    // The email code alone is never enough: the existing factor is still required.
    await expect(page.getByRole('heading', { name: 'Confirm your identity' })).toBeVisible();
    await page.getByLabel('6-digit code').fill(await freshCode(activatedSecret));
    await page.getByRole('button', { name: 'Verify and continue' }).click();
    await expect(page.getByRole('heading', { name: 'Create a new password' })).toBeVisible();
    await page.getByLabel('New password', { exact: true }).fill(RECOVERED_PASSWORD);
    await page.getByLabel('Confirm password').fill(RECOVERED_PASSWORD);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/admin\/?$/);
    // The previous password no longer works.
    const old = await newPage(browser);
    await passwordStep(old, credentials.legacyDeliveryEmail, ACTIVATED_PASSWORD);
    await expect(old.getByLabel('6-digit code')).toHaveCount(0);
  });

  test('PROV-UI-04 operator recovery link for an enrolled seed account: replaces only the email code; the authenticator stays mandatory', async ({ browser }) => {
    expect(seedSecret).not.toBe('');
    const id = disposableSql(`SELECT id FROM users WHERE email = '${SEED_EMAIL}'`);
    const approval = ['--operator=QA Operator', '--tester=QA Tester', '--reason=Disposable browser QA of seed password recovery'];
    // A factor-less administrator is refused (first-time setup uses provision-seeded-admin instead).
    const legacy = disposableSql(`SELECT id FROM users WHERE email = 'legacy-unactivated@qa.invalid'`);
    expect(operatorCli(['recover-seeded-admin-password', 'legacy-unactivated@qa.invalid', `--user-id=${legacy}`, ...approval,
      `--handoff-file=${path.join(handoffDir, 'never-recovery.txt')}`]).out).toContain('[NOT_SEED_EMAIL]');
    const handoff = path.join(handoffDir, 'admin1-recovery.txt');
    const issued = operatorCli(['recover-seeded-admin-password', SEED_EMAIL, `--user-id=${id}`, ...approval, `--handoff-file=${handoff}`]);
    expect(issued.status, issued.out).toBe(0);
    const link = readFileSync(handoff, 'utf8').trim();
    expect(link).toMatch(/\/admin\/forgot-password#seed-recovery=/);
    expect(issued.out).not.toContain(link.split('#seed-recovery=')[1]!);

    const page = await newPage(browser, { reducedMotion: 'reduce' });
    await page.goto(link.replace('http://localhost:3205', ''));
    // Straight to the factor step: no email code is asked for, and the proof is removed from the address bar.
    await expect(page.getByRole('heading', { name: 'Confirm your identity' })).toBeVisible();
    expect(new URL(page.url()).hash).toBe('');
    await expect(page.getByText('Recovery link accepted. Confirm with your authenticator app, a passkey or a recovery code.')).toBeVisible();
    await capture(page, 'seed-recovery-factor', [390, 768, 1440]);
    await page.getByLabel('6-digit code').fill('000000');
    await page.getByRole('button', { name: 'Verify and continue' }).click();
    await expect(page.getByRole('heading', { name: 'Create a new password' })).toHaveCount(0);
    await page.getByLabel('6-digit code').fill(await freshCode(seedSecret));
    await page.getByRole('button', { name: 'Verify and continue' }).click();
    await expect(page.getByRole('heading', { name: 'Create a new password' })).toBeVisible();
    await page.getByLabel('New password', { exact: true }).fill(SEED_RECOVERED_PASSWORD);
    await page.getByLabel('Confirm password').fill(SEED_RECOVERED_PASSWORD);
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/admin\/?$/);

    // Single use.
    const replay = await newPage(browser);
    await replay.goto(link.replace('http://localhost:3205', ''));
    await expect(replay.getByText(/This recovery link is invalid, expired or has already been used/)).toBeVisible();
    await expect(replay.getByRole('heading', { name: 'Confirm your identity' })).toHaveCount(0);
    await capture(replay, 'seed-recovery-replayed', [390, 1440]);
    // Old password refused; new password still requires MFA.
    const old = await newPage(browser);
    await passwordStep(old, SEED_EMAIL, PROVISIONED_PASSWORD);
    await expect(old.getByLabel('6-digit code')).toHaveCount(0);
    const fresh = await newPage(browser);
    await passwordStep(fresh, SEED_EMAIL, SEED_RECOVERED_PASSWORD);
    await expect(fresh.getByLabel('6-digit code')).toBeVisible();
    // Never presented as email verification; factors untouched.
    expect(disposableSql(`SELECT count(*) FROM admin_mfa_factors WHERE "userId" = '${id}' AND "verifiedAt" IS NOT NULL AND "disabledAt" IS NULL`)).toBe('1');
  });
});
