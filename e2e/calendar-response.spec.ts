import { test, expect } from '@playwright/test';

test('month selection paints promptly and opening a loaded day keeps its records during slow refresh', async ({
  page,
}) => {
  test.setTimeout(60000);
  const events = Array.from({ length: 600 }, (_, i) => {
    const day = `2026-11-${String((i % 30) + 1).padStart(2, '0')}`;
    return {
      id: `speed-${i}`,
      calendarId: 'primary',
      summary: `Planning session ${i}`,
      start: { dateTime: day + 'T10:00:00+03:00' },
      end: { dateTime: day + 'T11:00:00+03:00' },
    };
  });
  let slow = false;
  let fail = false;
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/progress') return route.abort();
    let value: unknown = [];
    if (path === '/api/session')
      value = {
        csrf: 'fixture',
        demo: true,
        owner: 'speed@example.org',
        preferences: { timeZone: 'Europe/Istanbul', language: 'en' },
      };
    if (path === '/api/calendars') value = [{ id: 'primary', summary: 'Personal' }];
    if (path === '/api/history') value = { operations: [], jobs: [] };
    if (path === '/api/planner') value = { items: [], partial: false };
    if (path === '/api/events') {
      if (fail) return route.fulfill({ status: 503, json: { error: 'Temporary fixture outage' } });
      if (slow) await new Promise((resolve) => setTimeout(resolve, 4000));
      value = events;
    }
    await route.fulfill({ json: value });
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await page.getByLabel('Go to date').fill('2026-11-10');
  await page.getByRole('button', { name: 'Month', exact: true }).click();
  await expect(page.locator('.month-event')).not.toHaveCount(0);
  const paintMs = await page
    .getByRole('button', { name: 'Show 2026-11-11, 20 items', exact: true })
    .evaluate(async (el) => {
      const start = performance.now();
      (el as HTMLButtonElement).click();
      await new Promise(requestAnimationFrame);
      return performance.now() - start;
    });
  console.log('Month selection to next frame (ms):', Math.round(paintMs));
  expect(paintMs).toBeLessThan(250);
  await expect(page.locator('.month-day-agenda h3')).toHaveText('Wednesday 11 November');
  slow = true;
  await page.getByRole('button', { name: 'Open day', exact: true }).click();
  await expect(page.getByRole('button', { name: /Planning session 10\b/ }).first()).toBeVisible({
    timeout: 1000,
  });
  fail = true;
  await page.getByRole('button', { name: 'Refresh calendar', exact: true }).click();
  await expect(page.getByRole('alert')).toContainText('Temporary fixture outage');
  await expect(page.getByRole('button', { name: /Planning session 10\b/ }).first()).toBeVisible();
});

test('calendar date selection stays on the chosen civil day in far-ahead time zones', async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/progress') return route.abort();
    let value: unknown = [];
    if (path === '/api/session')
      value = {
        csrf: 'fixture',
        demo: true,
        owner: 'zone@example.org',
        preferences: { timeZone: 'Pacific/Kiritimati', language: 'en' },
      };
    if (path === '/api/calendars') value = [{ id: 'primary', summary: 'Personal' }];
    if (path === '/api/history') value = { operations: [], jobs: [] };
    if (path === '/api/planner') value = { items: [], partial: false };
    await route.fulfill({ json: value });
  });
  await page.goto('/');
  await page.getByLabel('Go to date').fill('2026-11-10');
  await expect(page.getByLabel('Go to date')).toHaveValue('2026-11-10');
  await page.getByRole('button', { name: 'Month', exact: true }).click();
  await page.getByRole('button', { name: 'Show 2026-11-12, 0 items', exact: true }).click();
  await expect(page.getByLabel('Go to date')).toHaveValue('2026-11-12');
});
