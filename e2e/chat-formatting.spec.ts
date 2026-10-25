import { test, expect } from '@playwright/test';

test('renders safe Markdown in a compact assistant and shows verified operation outcomes', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  const external: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('evil.example')) external.push(request.url());
  });
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/progress') return route.abort();
    let value: unknown = [];
    if (path === '/api/session')
      value = {
        csrf: 'test',
        demo: true,
        agyEnabled: true,
        googleConnected: false,
        preferences: { timeZone: 'Europe/Istanbul', language: 'tr' },
      };
    if (path === '/api/history') value = { operations: [], jobs: [] };
    if (path === '/api/agy/status') value = { available: true, connection: { state: 'ready' } };
    if (path === '/api/chat/history')
      value = [
        {
          id: '1',
          role: 'assistant',
          text: '**Haftalık plan**\n\n- Buz Pateni\n- *Toplantı*\n\n[Google](https://calendar.google.com/)\n\n`kod`\n\n<img src="https://evil.example/track">\n\n![Resim](https://evil.example/track)',
        },
      ];
    if (path === '/api/chat')
      value = {
        message: '“Buz Pateni”\n21 Ekim 2026 Çarşamba · 15:00 – 16:00\nTakvimine ekledim.',
        operation: { id: 'test', status: 'succeeded' },
      };
    await route.fulfill({ json: value });
  });
  await page.goto('/');
  const body = page.locator('.message.assistant .markdown-body');
  await expect(body.locator('strong')).toHaveText('Haftalık plan');
  await expect(body.locator('li')).toHaveCount(2);
  await expect(body.locator('code')).toHaveText('kod');
  await expect(body.locator('a')).toHaveAttribute('rel', 'noopener noreferrer');
  await expect(body.locator('img')).toHaveCount(0);
  expect(external).toEqual([]);
  expect((await page.locator('.expand-assistant').boundingBox())!.height).toBeLessThan(40);
  await expect(page.getByText('Aklındakini')).toHaveCount(0);
  await page.getByLabel('Message C.O.R.', { exact: true }).fill('Yarın 15-16 Buz Pateni ekle');
  await page.getByRole('button', { name: 'Send message', exact: true }).click();
  await expect(page.getByText(/Takvimine ekledim/)).toBeVisible();
  await expect(page.locator('.message.assistant').last()).not.toContainText('Queued');
  await page.setViewportSize({ width: 390, height: 844 });
  // The submitted conversation remains open when switching to the mobile layout.
  await expect(page.getByText(/Takvimine ekledim/)).toBeVisible();
});
