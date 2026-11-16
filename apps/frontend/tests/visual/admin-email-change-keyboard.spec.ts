import { expect, test } from '@playwright/test';

test('email change dialog submits both steps with Enter and returns focus on Escape', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/iframe.html?id=admin-security-email-change--flow');
  const trigger = page.getByRole('button', { name: 'Change Email' });
  await expect(trigger).toBeVisible();
  await trigger.focus();
  await page.keyboard.press('Enter');

  const dialog = page.getByRole('dialog', { name: 'Change your email address' });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByLabel('New email')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
  await expect(trigger).toBeFocused();

  await trigger.focus();
  await page.keyboard.press('Space');
  await expect(dialog).toBeVisible();
  await dialog.getByLabel('New email').fill('new-admin@example.test');
  await dialog.getByLabel('Current password').fill('Synthetic-Password-9');
  await dialog.getByLabel('Current password').press('Enter');
  await expect(page.getByRole('dialog', { name: 'Verify your new email' })).toBeVisible();

  const verify = page.getByRole('dialog', { name: 'Verify your new email' });
  await verify.getByLabel('6-digit verification code').fill('123456');
  await verify.getByLabel('6-digit verification code').press('Enter');
  await expect(page.getByRole('dialog', { name: 'Email changed successfully' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});
