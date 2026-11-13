import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { installDarkModeApi } from './darkMode.fixtures';

// Only the task-owned disposable browser harness can provide these credentials.
// No shared target or real recipient can enter this journey.
test('real contact capture: reproduce missing support mailbox, configure isolated recipient, retry and verify payload', async ({ page }, info) => {
  const file = process.env.CRITICAL_CAPTURE_CREDENTIALS;
  test.skip(!file, 'Set CRITICAL_CAPTURE_CREDENTIALS to the disposable browser harness credentials.');
  const credentials = JSON.parse(readFileSync(file!, 'utf8'));
  const target = new URL(credentials.databaseUrl);
  if (target.hostname !== '127.0.0.1' || !target.pathname.startsWith('/electrohub_disposable_browser_') || !credentials.outboxDir) throw new Error('Disposable capture database required.');
  const sql = (query: string) => execFileSync(credentials.disposableDb.psql, ['-h', '127.0.0.1', '-p', String(credentials.disposableDb.port), '-U', 'postgres',
    '-d', credentials.disposableDb.database, '-v', 'ON_ERROR_STOP=1', '-At', '-c', query], { encoding: 'utf8', windowsHide: true });
  const original = sql(`SELECT COALESCE("supportEmail", '') FROM store_settings WHERE id='default'`).trim();
  const recipient = 'support@critical.invalid';
  await installDarkModeApi(page);
  await page.route('**/api/store/**', route => route.continue());
  const message = { name: 'QA Customer', email: 'customer@critical.invalid', subject: `Critical contact ${info.project.name}`, message: 'Please help with <b>this order</b>.\nThank you.' };
  try {
    sql(`UPDATE store_settings SET "supportEmail"=NULL WHERE id='default'`);
    await page.goto('/contact');
    for (const [label, value] of Object.entries(message)) await page.getByLabel(label === 'name' ? 'Name' : label === 'email' ? 'Email' : label === 'subject' ? 'Subject' : 'Message', { exact: true }).fill(value);
    const submit = () => page.getByRole('button', { name: 'Send Message' }).click();
    const response = page.waitForResponse(r => r.url().endsWith('/api/store/contact'));
    await submit();
    const failed = await response;
    expect(failed.status()).toBe(503);
    expect((await failed.json()).error.code).toBe('CONTACT_NOT_CONFIGURED');
    info.annotations.push({ type: 'request-id-503', description: failed.headers()['x-request-id'] ?? 'absent' });
    await expect(page.getByRole('alert')).toBeVisible();
    await expect(page.getByLabel('Message', { exact: true })).toHaveValue(message.message);
    await page.screenshot({ path: info.outputPath('contact-real-503.png'), fullPage: true });
    sql(`UPDATE store_settings SET "supportEmail"='${recipient}' WHERE id='default'`);
    const acceptedResponse = page.waitForResponse(r => r.url().endsWith('/api/store/contact'));
    await submit();
    const accepted = await acceptedResponse;
    expect(accepted.status()).toBe(202);
    info.annotations.push({ type: 'request-id-202', description: accepted.headers()['x-request-id'] ?? 'absent' });
    await expect(page.getByRole('status').filter({ hasText: 'Your message has been sent.' })).toBeVisible();
    const hash = createHash('sha256').update(`${recipient}:Store contact: ${message.subject}`).digest('hex');
    const captured = JSON.parse(readFileSync(path.join(credentials.outboxDir, `${hash}.json`), 'utf8'));
    expect(captured.to).toBe(recipient);
    expect(captured.replyTo).toEqual({ email: message.email, name: message.name });
    expect(captured.htmlContent).toContain('&lt;b&gt;this order&lt;/b&gt;');
    expect(captured.textContent).toContain(message.message);
    await page.screenshot({ path: info.outputPath('contact-real-202.png'), fullPage: true });
  } finally {
    // Original is configuration read from this throwaway database; SQL-escape it before restoring it.
    sql(`UPDATE store_settings SET "supportEmail"=${original ? "'" + original.replaceAll("'", "''") + "'" : 'NULL'} WHERE id='default'`);
  }
});
