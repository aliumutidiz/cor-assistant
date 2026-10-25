import { test, expect } from '@playwright/test';
test('creates and edits a routine, runs it, then directly deletes it', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByText('Demo', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Routines', exact: true }).click();
  await page.getByRole('button', { name: 'Create routine' }).click();
  await page.getByLabel('Routine name').fill('Tarayıcı test rutini');
  await expect(page.locator('.preview-note')).toBeVisible();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tarayıcı test rutini' })).toBeVisible({ timeout: 12000 });
  const row = page
    .locator('.routine-row')
    .filter({ has: page.getByRole('heading', { name: 'Tarayıcı test rutini' }) });
  await row.getByRole('button', { name: 'Edit' }).click();
  await page.getByLabel('Cron expression').fill('30 9 * * *');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(row.getByText('30 9 * * *')).toBeVisible({ timeout: 12000 });
  await row.getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('button', { name: 'Run now' }).click();
  await page.getByRole('button', { name: /Activity/ }).click();
  await expect(page.getByText('Tarayıcı test rutini', { exact: true }).first()).toBeVisible({
    timeout: 12000,
  });
  await page.getByRole('button', { name: 'Routines', exact: true }).click();
  await row.getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('button', { name: 'Delete routine', exact: true }).click();
  await page.getByRole('button', { name: 'Routines', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Tarayıcı test rutini' })).toHaveCount(0, {
    timeout: 12000,
  });
});
test('creates and directly deletes a verified personal calendar event', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Add event', exact: true }).click();
  await page.getByLabel('Event title').fill('C.O.R. tarayıcı kontrolü');
  const day = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  await page.getByLabel('Start', { exact: true }).fill(day + 'T10:00');
  await page.getByLabel('End', { exact: true }).fill(day + 'T11:00');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await page.getByRole('button', { name: 'Activity', exact: true }).click();
  await expect(
    page
      .locator('.operation-row')
      .filter({ hasText: 'event.create' })
      .first()
      .getByText('Completed', { exact: true }),
  ).toBeVisible({ timeout: 12000 });
  await page.getByRole('button', { name: 'Calendar', exact: true }).click();
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();
  await page
    .getByRole('button', { name: /C.O.R. tarayıcı kontrolü/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'Delete event', exact: true }).click();
  await page.getByRole('button', { name: 'Activity', exact: true }).click();
  await expect(
    page
      .locator('.operation-row')
      .filter({ hasText: 'event.delete' })
      .first()
      .getByText('Completed', { exact: true }),
  ).toBeVisible({ timeout: 12000 });
});
test('mobile navigation, dialogs and assistant fit the viewport', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Calendar' })).toBeVisible();
  await page.screenshot({ path: '.runtime/screenshots/mobile.png', fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.getByRole('button', { name: 'Ask C.O.R.', exact: true }).click();
  await page.getByLabel('Message C.O.R.').fill('Bugünümü özetle');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('log')).toContainText('doğrulama bekliyor', { timeout: 12000 });
  await page.getByRole('button', { name: 'Close assistant' }).click();
  await page.getByRole('button', { name: 'Add event', exact: true }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  expect(
    await page.getByRole('dialog').evaluate((e) => e.getBoundingClientRect().right <= window.innerWidth),
  ).toBe(true);
});
test('desktop screen has no client errors and captures the working layout', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.setViewportSize({ width: 1512, height: 982 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Calendar' })).toBeVisible();
  await page.screenshot({ path: '.runtime/screenshots/desktop.png', fullPage: true });
  expect(errors).toEqual([]);
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your profile' })).toBeVisible();
  await page.getByRole('button', { name: 'Telegram', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Telegram connection' })).toBeVisible();
  await expect(page.getByLabel('Bot token', { exact: true })).toBeVisible();
});
test('fixed reminders work with AGY disabled and show their message without a boxed logo', async ({
  page,
}) => {
  await page.goto('/');
  await expect(page.locator('.brand-mark')).toHaveCount(0);
  await page.getByRole('button', { name: 'Routines', exact: true }).click();
  await page.getByRole('button', { name: 'Create routine' }).click();
  await page.getByLabel('Routine name').fill('Tokensız sabah hatırlatması');
  await page.getByLabel('Action').selectOption('reminder');
  await page.getByLabel('Schedule', { exact: true }).selectOption('0 7 * * *');
  await page.getByLabel('Reminder message').fill('Hapını iç.');
  await expect(page.getByText('Runs without an LLM', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const row = page
    .locator('.routine-row')
    .filter({ has: page.getByRole('heading', { name: 'Tokensız sabah hatırlatması' }) });
  await expect(row).toBeVisible({ timeout: 12000 });
  await row.getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('button', { name: 'Run now' }).click();
  const reminder = page.locator('.reminder-banner').filter({ hasText: 'Tokensız sabah hatırlatması' });
  await expect(reminder).toContainText('Hapını iç.', { timeout: 12000 });
  await expect(reminder).toContainText('No LLM used');
  await reminder.getByRole('button', { name: 'Close reminder' }).click();
  await expect(reminder).toHaveCount(0);
  await row.getByRole('button', { name: 'Edit' }).click();
  await page.getByRole('button', { name: 'Delete routine', exact: true }).click();
  await expect(row).toHaveCount(0);
});
