import { test, expect } from '@playwright/test';

test('profile onboarding waits for confirmed storage and survives reload', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByLabel('What should I call you?').fill('Alex');
  await page.getByLabel('Assistant reply language').selectOption('en');
  await page.getByRole('button', { name: 'Save profile', exact: true }).click();
  await expect(
    page.getByText('Profile saved. Your assistant will use these preferences in future replies.'),
  ).toBeVisible();
  await page.reload();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByLabel('What should I call you?')).toHaveValue('Alex');
});

// Documentation uses a completely synthetic fixture, never a live owner account.
test('English workspace, shared full-page chat, persistent theme and profile settings', async ({ page }) => {
  await page.setViewportSize({ width: 1512, height: 982 });
  await page.addInitScript(() => localStorage.setItem('cor.theme', 'light'));
  const messages = [
    { id: 'sample-user', role: 'user', text: 'What should I know about today?' },
    {
      id: 'sample-assistant',
      role: 'assistant',
      text: 'You have **two plans today**.\n\n- **09:00** · Design review\n- **16:00** · A walk by the river\n\nYour shopping list still has coffee and fruit. No independent reminders are due today.',
    },
  ];
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname;
    if (path === '/api/progress') return route.abort();
    let value: unknown = [];
    if (path === '/api/session')
      value = {
        csrf: 'public-fixture',
        demo: true,
        owner: 'demo@example.test',
        googleConnected: false,
        agyEnabled: true,
        preferences: { timeZone: 'Europe/London', language: 'en', displayName: 'Alex', onboarded: true },
      };
    if (path === '/api/calendars')
      value = [
        { id: 'primary', summary: 'Personal', primary: true, timeZone: 'Europe/London', accessRole: 'owner' },
      ];
    if (path === '/api/events') {
      const now = new Date(),
        monday = new Date(now);
      monday.setDate(now.getDate() - ((now.getDay() + 6) % 7));
      const event = (index: number, title: string, day: number, hour: number) => {
        const start = new Date(monday);
        start.setDate(monday.getDate() + day);
        start.setHours(hour, 0, 0, 0);
        return {
          id: String(index),
          calendarId: 'primary',
          summary: title,
          start: { dateTime: start.toISOString() },
          end: { dateTime: new Date(+start + 3600000).toISOString() },
          etag: 'fixture-' + index,
        };
      };
      value = [
        event(1, 'Design review', 0, 9),
        event(2, 'Project focus', 1, 11),
        event(3, 'Lunch with a friend', 2, 12),
        event(4, 'Reading hour', 3, 17),
        event(5, 'Weekly review', 4, 10),
        event(6, 'A walk by the river', 5, 16),
      ];
    }
    if (path === '/api/history') value = { operations: [], jobs: [] };
    if (path === '/api/chat/history') value = messages;
    if (path === '/api/agy/status') value = { available: true, connection: { state: 'ready' } };
    if (path === '/api/settings/voice')
      value = { enabled: false, voice: 'Charon', dailyLimit: 10, freeTierConfirmed: false, hasKey: false };
    if (path === '/api/voice/status') value = { enabled: false };
    if (path === '/api/settings/telegram')
      value = {
        enabled: false,
        ownerId: null,
        chatIds: [],
        notificationChatId: null,
        hasToken: false,
        status: { state: 'disabled' },
      };
    if (path === '/api/settings/research') value = { enabled: false, endpoint: '' };
    await route.fulfill({ json: value });
  });
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Calendar', exact: true })).toBeVisible();
  await expect(page.locator('.brand img')).toBeVisible();
  await page.locator('.week-scroll').evaluate((element) => {
    element.scrollTop = 7 * 56;
  });
  await page.screenshot({ path: 'docs/images/calendar-light.png', fullPage: false, animations: 'disabled' });
  await page.getByRole('button', { name: 'Assistant', exact: true }).click();
  await expect(page.locator('.agent-view')).toBeVisible();
  await expect(page.getByRole('log')).toContainText('Design review');
  await expect(
    page.getByRole('log').getByText('What should I know about today?', { exact: true }),
  ).toHaveCount(1);
  await page.getByRole('button', { name: /Theme: light/ }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.screenshot({ path: 'docs/images/assistant-dark.png', fullPage: false, animations: 'disabled' });
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await expect(page.getByLabel('What should I call you?')).toHaveValue('Alex');
  await expect(page.getByLabel('Assistant reply language')).toHaveValue('en');
  await page.getByRole('button', { name: 'Telegram', exact: true }).click();
  await expect(page.getByLabel('Bot token', { exact: true })).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Assistant', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});
