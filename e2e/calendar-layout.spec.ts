import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  // Isolate layout checks from the owner's connected Google account.
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/progress') return route.abort();
    const events = [
      {
        id: 'early',
        calendarId: 'primary',
        summary: 'Early event',
        start: { dateTime: '2026-10-19T05:00:00+03:00' },
        end: { dateTime: '2026-10-19T06:00:00+03:00' },
      },
      {
        id: 'late',
        calendarId: 'primary',
        summary: 'Late event',
        start: { dateTime: '2026-10-19T23:00:00+03:00' },
        end: { dateTime: '2026-10-20T00:00:00+03:00' },
      },
      {
        id: 'all',
        calendarId: 'primary',
        summary: 'All day event',
        start: { date: '2026-10-19' },
        end: { date: '2026-10-20' },
      },
    ];
    const data =
      path === '/api/session'
        ? {
            csrf: 'test',
            demo: true,
            owner: 'test@example.test',
            googleConnected: false,
            agyEnabled: false,
            preferences: { timeZone: 'Europe/Istanbul', language: 'tr' },
          }
        : path === '/api/calendars'
          ? Array.from({ length: 30 }, (_, i) => ({
              id: i ? `calendar-${i}` : 'primary',
              summary: `Calendar ${i}`,
            }))
          : path === '/api/history'
            ? { operations: [], jobs: [] }
            : path === '/api/events'
              ? events
              : [];
    await route.fulfill({ json: data });
  });
});

test('supports the full day, separate all-day events, and midnight creation', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Go to date').fill('2026-10-19');
  await page.getByRole('button', { name: 'Day', exact: true }).click();
  await expect(page.locator('.hour-slot')).toHaveCount(24);
  await expect(page.locator('.all-day-event')).toHaveText('All day event');
  await expect(page.locator('.grid-event')).toHaveCount(2);
  expect(
    await page.getByRole('button', { name: /Early event/ }).evaluate((e) => (e as HTMLElement).offsetTop),
  ).toBe(280);
  await page
    .getByRole('button', { name: 'Add event 2026-10-19 23:00', exact: true })
    .click({ position: { x: 1, y: 28 } });
  await expect(page.getByLabel('Start', { exact: true })).toHaveValue('2026-10-19T23:00');
  await expect(page.getByLabel('End', { exact: true })).toHaveValue('2026-10-20T00:00');
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.getByRole('button', { name: 'Week', exact: true }).click();
  await expect(page.locator('.hour-slot')).toHaveCount(168);
  await page.getByRole('button', { name: 'Open 2026-10-19' }).click();
  await expect(page.locator('.hour-slot')).toHaveCount(24);
});

test('keeps navigation reachable on short screens and daily view within mobile width', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 550 });
  await page.goto('/');
  const sidebar = page.locator('.sidebar');
  await sidebar.evaluate((e) => {
    e.scrollTop = e.scrollHeight;
  });
  await expect(page.locator('.connection')).toBeInViewport();
  await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
  expect(await sidebar.evaluate((e) => Math.abs(Math.round(e.getBoundingClientRect().top)))).toBe(0);
  await page.setViewportSize({ width: 390, height: 700 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.getByRole('button', { name: 'Day', exact: true }).click();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(await page.locator('.week-scroll').evaluate((e) => e.scrollWidth <= e.clientWidth)).toBe(true);
});

test('moves by calendar months rather than four weeks', async ({ page }) => {
  await page.goto('/');
  await page.getByLabel('Go to date').fill('2026-01-31');
  await page.getByRole('button', { name: 'Month', exact: true }).click();
  await page.getByRole('button', { name: 'Next period' }).click();
  await expect(page.getByLabel('Go to date')).toHaveValue('2026-02-01');
  await page.getByRole('button', { name: 'Previous period' }).click();
  await expect(page.getByLabel('Go to date')).toHaveValue('2026-01-01');
});
