import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Page } from '@playwright/test';

interface CapturedEmail { to: string; subject: string; textContent: string }

/** Browser-level contact verification for the disposable browser stack only. Never runs against live credentials/providers. */
export async function submitContactAndAssertCaptured(page: Page, options: {
  recipient: string; name: string; email: string; subject: string; message: string; outboxDir: string;
}) {
  if (!options.recipient.endsWith('.invalid')) throw new Error('The disposable contact sink accepts only synthetic .invalid recipients.');
  if (!options.outboxDir) throw new Error('Start the disposable stack with TASK05_2_EMAIL_CAPTURE=1 and pass its outboxDir.');

  await page.getByLabel('Name').fill(options.name);
  await page.getByLabel('Email').fill(options.email);
  await page.getByLabel('Subject').fill(options.subject);
  await page.getByLabel('Message').fill(options.message);
  await page.getByRole('button', { name: 'Send Message' }).click();
  await page.getByRole('status').getByText('Your message has been sent.').waitFor();

  const subject = `Store contact: ${options.subject.slice(0, 120)}`;
  const filename = createHash('sha256').update(`${options.recipient}:${subject}`).digest('hex');
  const captured = JSON.parse(await readFile(join(options.outboxDir, `${filename}.json`), 'utf8')) as CapturedEmail;
  if (captured.to !== options.recipient || captured.subject !== subject || !captured.textContent.includes(options.message)) {
    throw new Error('Captured contact email did not match the submitted message and configured support recipient.');
  }
  return captured;
}
