import { test, expect } from '@playwright/test';
test('refreshes a stale browser timeline on focus without duplicating pending messages', async ({ page }) => {
  let fresh = false;
  const old = [
    { id: '90', role: 'assistant', text: 'Earlier saved reply', createdAt: '2026-10-23T10:00:00Z' },
  ];
  const latest = [
    ...old,
    {
      id: '2',
      exchangeId: 'chat:telegram:7',
      role: 'user',
      text: 'Newest Telegram request',
      createdAt: '2026-10-26T10:00:00Z',
    },
    {
      id: '3',
      exchangeId: 'chat:telegram:7',
      role: 'assistant',
      text: 'Newest Telegram response',
      createdAt: '2026-10-26T10:01:00Z',
    },
  ];
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/progress') return route.abort();
    let value: unknown = [];
    if (path === '/api/session')
      value = {
        csrf: 'fixture',
        owner: 'demo-owner',
        demo: true,
        chatSync: true,
        agyEnabled: true,
        preferences: { timeZone: 'Europe/Istanbul', language: 'en' },
      };
    if (path === '/api/history') value = { operations: [], jobs: [] };
    if (path === '/api/agy/status') value = { connection: { state: 'ready' } };
    if (path === '/api/chat/history') value = old;
    if (path === '/api/chat/context')
      value = { version: 1, contextId: 'initial', contextAfter: '0', visibleAfter: '0' };
    if (path === '/api/chat/snapshot')
      value = {
        context: { version: 1, contextId: 'initial', contextAfter: '0', visibleAfter: '0' },
        messages: fresh ? latest : old,
      };
    await route.fulfill({ json: value });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Assistant', exact: true }).click();
  await expect(page.locator('.message').last()).toContainText('Earlier saved reply');
  fresh = true;
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.message').last()).toContainText('Newest Telegram response');
  await page.evaluate(() => window.dispatchEvent(new Event('focus')));
  await expect(page.locator('.message')).toHaveCount(3);
});
test('centers the current hour and creates a weekly class from its dedicated workspace', async ({ page }) => {
  await page.clock.setFixedTime(new Date('2026-10-26T09:30:00Z'));
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await page.locator('.week-scroll').waitFor();
  const offset = await page
    .locator('.calendar-now')
    .first()
    .evaluate((element) => {
      const viewport = element.closest('.week-scroll')!;
      const line = element.getBoundingClientRect(),
        view = viewport.getBoundingClientRect();
      return Math.abs(line.top - (view.top + view.height / 2));
    });
  expect(offset).toBeLessThan(90);
  await page.getByRole('button', { name: 'Programs', exact: true }).click();
  await page.getByRole('button', { name: 'Add program', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Title', { exact: true }).fill('Demo weekly classes');
  await dialog.getByLabel('Activity / class', { exact: true }).fill('Mathematics');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.locator('.memory-card').filter({ hasText: 'Demo weekly classes' })).toContainText(
    'Included in availability',
  );
  await page.screenshot({ path: '.runtime/screenshots/programs-workspace.png', fullPage: true });
  await page.getByRole('button', { name: 'Memory', exact: true }).click();
  await expect(page.getByRole('button', { name: 'List', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );
  await expect(page.locator('.memory-card').filter({ hasText: 'Demo weekly classes' })).toBeVisible();
  await page.screenshot({ path: '.runtime/screenshots/memory-workspace.png', fullPage: true });
});
