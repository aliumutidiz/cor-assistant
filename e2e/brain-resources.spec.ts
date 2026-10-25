import { test, expect } from '@playwright/test';

test('creates a shopping list, checks an item and preserves structured data on reload', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await page.getByRole('button', { name: 'Memory', exact: false }).click();
  await page.getByLabel('Filter record type').selectOption('shopping_list');
  await page.getByRole('button', { name: 'Add record', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Title', { exact: true }).fill('Market listesi');
  await dialog.getByLabel('Original content', { exact: true }).fill('Haftalık alışveriş');
  await dialog.getByRole('button', { name: 'Add item', exact: true }).click();
  await dialog.getByLabel('Item', { exact: true }).fill('Süt');
  await dialog.getByLabel('Quantity / unit', { exact: true }).fill('2 litre');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).not.toBeVisible();
  const card = page
    .locator('.memory-card')
    .filter({ has: page.getByRole('button', { name: 'Market listesi', exact: true }) });
  await expect(card).toContainText('0 / 1 bought');
  await card.getByRole('checkbox').check();
  await expect(card).toContainText('1 / 1 bought');
  await page.reload();
  await page.getByRole('button', { name: 'Memory', exact: false }).click();
  await expect(page.locator('.memory-card').filter({ hasText: 'Market listesi' })).toContainText(
    '1 / 1 bought',
  );
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Connections overview', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Setup status' })).toBeVisible();
  await page.getByRole('button', { name: 'Telegram', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Telegram connection' })).toBeVisible();
  await page.screenshot({ path: '.runtime/screenshots/settings-connections.png', fullPage: true });
});

test('resumes a persisted chat after reload without re-posting the request', async ({ page }) => {
  const id = '73abb48b-4602-4cf6-8db2-0715f7616cda';
  let posts = 0,
    reads = 0;
  await page.addInitScript(({ id }) => localStorage.setItem('cor.pending-chat:fixture@example.com', id), {
    id,
  });
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/progress') return route.abort();
    let value: unknown = [];
    if (path === '/api/session')
      value = {
        csrf: 'fixture',
        owner: 'fixture@example.com',
        demo: true,
        asyncChat: true,
        agyEnabled: true,
        preferences: { timeZone: 'Europe/Istanbul', language: 'tr' },
      };
    if (path === '/api/history') value = { operations: [], jobs: [] };
    if (path === '/api/chat/requests') posts++;
    if (path === '/api/chat/requests/' + id) {
      reads++;
      value = { status: 'succeeded', result: { message: 'Kaydettim.' } };
    }
    if (path === '/api/chat/history')
      value = reads
        ? [
            {
              id: '1',
              role: 'user',
              text: 'Tercihimi kaydet',
              createdAt: '2026-10-24T10:00:00Z',
              channel: 'web',
            },
            {
              id: '2',
              role: 'assistant',
              text: 'Kaydettim.',
              createdAt: '2026-10-24T10:00:01Z',
              channel: 'web',
            },
          ]
        : [];
    await route.fulfill({ json: value });
  });
  await page.goto('/');
  await page.locator('.command-trigger').click();
  await expect(page.getByRole('log')).toContainText('Kaydettim.');
  expect(posts).toBe(0);
  expect(reads).toBe(1);
  expect(await page.evaluate(() => localStorage.getItem('cor.pending-chat:fixture@example.com'))).toBeNull();
});
