import { test, expect } from '@playwright/test';

test('creates a cycle and manages a local occurrence from the combined calendar and Today', async ({
  page,
}) => {
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Istanbul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  await page.goto('/');
  await page.getByRole('button', { name: 'Programs', exact: true }).click();
  await page.getByRole('button', { name: 'Add program', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByLabel('Title', { exact: true }).fill('Alternate exercise');
  await dialog.getByLabel('Activity / class').fill('Exercise cycle');
  await dialog.getByRole('combobox', { name: 'Repeat', exact: true }).selectOption('cycle');
  await dialog.getByLabel('First active day').fill(today);
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('button', { name: 'Calendar', exact: true }).click();
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();
  const occurrence = page.locator('.agenda-event').filter({ hasText: 'Exercise cycle' }).first();
  await expect(occurrence).toBeVisible();
  await page.getByLabel('Programs', { exact: true }).uncheck();
  await expect(occurrence).not.toBeVisible();
  await page.getByLabel('Programs', { exact: true }).check();
  await occurrence.click();
  dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Other dates stay unchanged');
  await dialog.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await page.getByRole('navigation').getByRole('button', { name: 'Today', exact: true }).click();
  await expect(
    page.locator('.today-panel .agenda-event').filter({ hasText: 'Exercise cycle' }),
  ).toBeVisible();
  await page.setViewportSize({ width: 390, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.runtime/screenshots/planner-today-mobile.png', fullPage: true });
});
