import { test, expect } from '@playwright/test';

test('recovers a history outage, preserves pagination position and scrolls to the latest message', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  let historyReads = 0,
    olderReads = 0;
  const rows = (start: number) =>
    Array.from({ length: 50 }, (_, i) => ({
      id: String(start + i),
      role: i % 2 ? 'assistant' : 'user',
      text: `Arşiv mesajı ${start + i}\n` + 'Uzun konuşma satırı. '.repeat(15),
    }));
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname;
    if (path === '/api/progress') return route.abort();
    let value: unknown = [];
    if (path === '/api/session')
      value = {
        csrf: 'test',
        demo: true,
        agyEnabled: true,
        preferences: { timeZone: 'Europe/Istanbul', language: 'tr' },
      };
    if (path === '/api/history') value = { operations: [], jobs: [] };
    if (path === '/api/agy/status') value = { available: true, connection: { state: 'ready' } };
    if (path === '/api/chat/history') {
      if (url.searchParams.has('before')) {
        olderReads++;
        value = rows(51);
      } else {
        historyReads++;
        if (historyReads <= 2)
          return route.fulfill({ status: 502, contentType: 'text/html', body: '<html>Bad Gateway</html>' });
        value = rows(101);
      }
    }
    await route.fulfill({ json: value });
  });
  await page.goto('/');
  await expect(page.getByText('Could not load conversation history.')).toBeVisible();
  await page.getByRole('button', { name: 'Reload history' }).click();
  const viewport = page.locator('.messages');
  await expect(page.locator('.message').last()).toContainText('Arşiv mesajı 150');
  await expect
    .poll(() => viewport.evaluate((e) => e.scrollHeight - e.scrollTop - e.clientHeight))
    .toBeLessThan(10);
  await viewport.evaluate((e) => {
    e.scrollTop = 0;
  });
  await page.getByRole('button', { name: 'Show earlier messages' }).click();
  await expect(page.locator('.message')).toHaveCount(100);
  expect(olderReads).toBe(1);
  await expect.poll(() => viewport.evaluate((e) => e.scrollTop)).toBeGreaterThan(100);
  await expect(page.getByRole('button', { name: 'Jump to latest ↓' })).toBeVisible();
  await page.getByRole('button', { name: 'Jump to latest ↓' }).click();
  await expect
    .poll(() => viewport.evaluate((e) => e.scrollHeight - e.scrollTop - e.clientHeight))
    .toBeLessThan(10);
});
