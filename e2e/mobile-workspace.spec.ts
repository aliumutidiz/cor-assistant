import { test, expect } from '@playwright/test';

test('mobile workspace keeps navigation reachable and pages within the screen', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  const quick = page.getByRole('navigation', { name: 'Quick navigation' });
  await expect(quick).toBeVisible();
  await expect(page.locator('.single-day')).toBeVisible();
  for (const name of ['Today', 'Calendar', 'Assistant', 'Routines']) {
    await quick.getByRole('button', { name, exact: true }).click();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await expect(quick).toBeInViewport();
  }
  await quick.getByRole('button', { name: 'More pages' }).click();
  const menu = page.getByRole('navigation', { name: 'Workspace', exact: true });
  await expect(menu).toBeVisible();
  await menu.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(menu).not.toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.runtime/screenshots/mobile-settings.png', fullPage: true });
  await quick.getByRole('button', { name: 'Assistant', exact: true }).click();
  await expect(page.locator('#chat-input')).toBeInViewport();
  await page.screenshot({ path: '.runtime/screenshots/mobile-assistant.png', fullPage: true });
  await page.setViewportSize({ width: 360, height: 740 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await expect(page.locator('#chat-input')).toBeInViewport();
});
