import { test, expect } from '@playwright/test';

test('manages a trusted invitation and explains Google connection lifetime', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Shared access', exact: true }).click();
  await page.getByLabel('Google account email').fill('guest@example.org');
  await page.getByRole('combobox', { name: 'Permission', exact: true }).selectOption('editor');
  await page.getByRole('button', { name: 'Allow this account', exact: true }).click();
  const invite = page.locator('.today-task').filter({ hasText: 'guest@example.org' });
  await expect(invite).toContainText('View and edit');
  await page.setViewportSize({ width: 390, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.runtime/screenshots/shared-access-mobile.png', fullPage: true });
  await invite.getByRole('button', { name: 'Revoke access' }).click();
  await expect(invite).not.toBeVisible();
  await page.getByRole('button', { name: 'Calendar & security', exact: true }).click();
  await page.getByText('Disconnecting every week?', { exact: true }).click();
  await expect(page.getByText('Google may still revoke authorization.', { exact: false })).toBeVisible();
});

test('shows view-only shared access without owner connection settings or chat writes', async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/progress') return route.abort();
    let value: unknown = [];
    if (path === '/api/session')
      value = {
        csrf: 'fixture',
        owner: 'guest@example.org',
        workspaceOwner: 'owner@example.org',
        actor: { email: 'guest@example.org', role: 'viewer', memberId: 'fixture' },
        demo: true,
        preferences: { timeZone: 'Europe/Istanbul', language: 'en' },
      };
    if (path === '/api/planner') value = { items: [], partial: false };
    if (path === '/api/history') value = { operations: [], jobs: [] };
    if (path === '/api/chat/context')
      value = { version: 1, contextId: 'initial', contextAfter: '0', visibleAfter: '0' };
    await route.fulfill({ json: value });
  });
  await page.goto('/');
  await expect(page.getByText('Shared workspace · owner@example.org', { exact: false })).toContainText(
    'View only',
  );
  await expect(page.getByRole('button', { name: 'Add event', exact: true })).toBeDisabled();
  await page.getByRole('navigation').getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Your access' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Shared access', exact: true })).not.toBeVisible();
  await page.getByRole('navigation').getByRole('button', { name: 'Assistant', exact: true }).click();
  await expect(page.locator('#chat-input')).toBeDisabled();
});
