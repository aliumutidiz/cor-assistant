import { test, expect } from '@playwright/test';

test('manages independent reminders and keeps calendar alerts separate on mobile', async ({ page }) => {
  const writes: any[] = [];
  const reminders: any[] = [];
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/progress') return route.abort();
    let data: unknown = [];
    if (path === '/api/session')
      data = {
        csrf: 'reminders-test',
        demo: true,
        agyEnabled: false,
        telegram: { enabled: true, status: { state: 'connected' } },
        preferences: { timeZone: 'Europe/Istanbul', language: 'tr' },
      };
    if (path === '/api/calendars') data = [{ id: 'primary', summary: 'Kişisel', accessRole: 'owner' }];
    if (path === '/api/history') data = { operations: [], jobs: [] };
    if (path === '/api/reminders') data = reminders;
    if (path === '/api/operations') {
      const action = route.request().postDataJSON();
      writes.push(action);
      const id = '11111111-1111-4111-8111-' + String(writes.length).padStart(12, '0');
      if (action.kind === 'reminder.create')
        reminders.push({ ...action.reminder, id, version: 1, state: 'scheduled' });
      if (action.kind === 'reminder.update')
        Object.assign(
          reminders.find((r) => r.id === action.reminderId),
          action.reminder,
          { version: action.version + 1 },
        );
      if (action.kind === 'reminder.cancel')
        Object.assign(
          reminders.find((r) => r.id === action.reminderId),
          { state: 'canceled', version: action.version + 1 },
        );
      data = { id, status: 'succeeded', action };
    }
    await route.fulfill({ json: data });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Reminders', exact: true }).click();
  await expect(page.getByText('Keep the details close.')).toBeVisible();
  await page.getByRole('button', { name: 'Add reminder', exact: true }).click();
  await page.getByLabel('Reminder title').fill('Çamaşırları çıkar');
  await page.getByRole('button', { name: 'In 5 hours', exact: true }).click();
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.locator('.reminder-row')).toHaveCount(1);
  await page.screenshot({ path: '.runtime/screenshots/reminders-desktop.png', fullPage: true });
  expect(writes[0].kind).toBe('reminder.create');
  expect(writes[0].reminder.event).toBeUndefined();
  expect(Date.parse(writes[0].reminder.remindAt) - Date.now()).toBeGreaterThan(298 * 60000);
  await page.getByRole('button', { name: 'Pause reminder', exact: true }).click();
  await expect(page.locator('.reminder-row')).toContainText('Paused');
  await page.getByRole('button', { name: 'Cancel reminder Çamaşırları çıkar', exact: true }).click();
  await expect(page.locator('.reminder-row')).toHaveCount(0);
  await page.getByRole('button', { name: 'History', exact: true }).click();
  await expect(page.locator('.reminder-row')).toContainText('Canceled');
  await page.getByRole('button', { name: 'Calendar', exact: true }).click();
  await page.getByLabel('Go to date').fill('2027-03-14');
  await page.getByRole('button', { name: 'Add event', exact: true }).click();
  await expect(page.getByLabel('Start', { exact: true })).toHaveValue('2027-03-14T09:00');
  await page.getByLabel('Event title').fill('Pazar planı');
  await page.getByLabel('Notify me on Telegram').selectOption('300');
  await page.getByLabel('Google Calendar reminder').selectOption('15');
  await page.getByLabel('Event recurrence').selectOption('weekly');
  await page.setViewportSize({ width: 390, height: 750 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.runtime/screenshots/calendar-reminders-mobile.png', fullPage: true });
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const event = writes.at(-1);
  expect(event.kind).toBe('event.create');
  expect(event.telegramReminderMinutes).toBe(300);
  expect(event.event.reminders).toEqual({ useDefault: false, overrides: [{ method: 'popup', minutes: 15 }] });
  expect(event.event.recurrence).toEqual(['RRULE:FREQ=WEEKLY']);
});

test('loads the master before editing a recurring series and preserves native notifications', async ({
  page,
}) => {
  let saved: any;
  const master = {
    id: 'master',
    etag: '"master-v2"',
    calendarId: 'primary',
    summary: 'Haftalık plan',
    start: { dateTime: '2027-03-01T09:00:00+03:00', timeZone: 'Europe/Istanbul' },
    end: { dateTime: '2027-03-01T10:00:00+03:00', timeZone: 'Europe/Istanbul' },
    recurrence: ['RRULE:FREQ=WEEKLY'],
    reminders: { useDefault: false, overrides: [{ method: 'email', minutes: 30 }] },
  };
  const instance = {
    ...master,
    id: 'instance',
    etag: '"instance-v1"',
    recurringEventId: 'master',
    recurrence: undefined,
    start: { dateTime: '2027-03-15T09:00:00+03:00', timeZone: 'Europe/Istanbul' },
    end: { dateTime: '2027-03-15T10:00:00+03:00', timeZone: 'Europe/Istanbul' },
  };
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/progress') return route.abort();
    let data: unknown = [];
    if (path === '/api/session')
      data = {
        csrf: 'series-test',
        demo: true,
        agyEnabled: false,
        preferences: { timeZone: 'Europe/Istanbul', language: 'tr' },
      };
    if (path === '/api/history') data = { operations: [], jobs: [] };
    if (path === '/api/calendars') data = [{ id: 'primary', summary: 'Kişisel', accessRole: 'owner' }];
    if (path === '/api/events') data = [instance];
    if (path === '/api/resources') data = master;
    if (path === '/api/operations') {
      saved = route.request().postDataJSON();
      data = { id: 'one', status: 'succeeded', action: saved };
    }
    await route.fulfill({ json: data });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Agenda', exact: true }).click();
  await page.getByRole('button', { name: /Haftalık plan/ }).click();
  await page.getByLabel('Change scope').selectOption('series');
  await expect(page.getByLabel('Start', { exact: true })).toHaveValue('2027-03-01T09:00');
  await page.getByLabel('Event title').fill('Güncel haftalık plan');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  expect(saved.scope).toBe('series');
  expect(saved.eventId).toBe('master');
  expect(saved.etag).toBe('"master-v2"');
  expect(saved.event.reminders).toBeUndefined();
});
