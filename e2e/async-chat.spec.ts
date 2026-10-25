import { test, expect } from '@playwright/test';
test('keeps a routine request alive through short status polls', async ({ page }) => {
  let polls = 0,
    posts = 0;
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    let data: unknown = [];
    if (path === '/api/progress') return route.abort();
    if (path === '/api/session')
      data = {
        csrf: 'test',
        demo: true,
        asyncChat: true,
        agyEnabled: true,
        preferences: { timeZone: 'Europe/Istanbul', language: 'tr' },
      };
    if (path === '/api/history') data = { operations: [], jobs: [] };
    if (path === '/api/chat/requests') {
      posts++;
      data = { id: route.request().headers()['idempotency-key'], status: 'queued' };
    }
    if (path.startsWith('/api/chat/requests/'))
      data =
        ++polls < 3
          ? { status: 'running' }
          : { status: 'succeeded', result: { message: 'AI rapor rutinini oluşturdum.' } };
    await route.fulfill({ json: data });
  });
  await page.goto('/');
  await page.locator('.command-trigger').click();
  await page.getByLabel('Message C.O.R.').fill('AI rapor rutini oluştur');
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByRole('log')).toContainText('AI rapor rutinini oluşturdum.');
  expect(posts).toBe(1);
  expect(polls).toBe(3);
});
