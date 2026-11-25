import { test, expect } from '@playwright/test';

test.beforeEach(async ({ page }) => {
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/progress') return route.abort();
    const events = Array.from({ length: 12 }, (_, i) => ({
      id: `crowded-${i}`,
      calendarId: 'primary',
      summary: `${i < 8 ? 'All-day planning' : 'Project review'} ${i + 1} with a long descriptive title that must stay readable`,
      start:
        i === 7
          ? { dateTime: '2026-10-19T00:00:00+03:00' }
          : i < 8
            ? { date: '2026-10-19' }
            : { dateTime: `2026-10-19T${String(i + 1).padStart(2, '0')}:00:00+03:00` },
      end:
        i === 7
          ? { dateTime: '2026-10-20T00:00:00+03:00' }
          : i < 8
            ? { date: '2026-10-20' }
            : { dateTime: `2026-10-19T${String(i + 2).padStart(2, '0')}:00:00+03:00` },
    }));
    let data: unknown = [];
    if (path === '/api/session')
      data = {
        csrf: 'fixture',
        demo: true,
        owner: 'layout@example.org',
        preferences: { timeZone: 'Europe/Istanbul', language: 'en' },
      };
    if (path === '/api/calendars') data = [{ id: 'primary', summary: 'Personal' }];
    if (path === '/api/events') data = events;
    if (path === '/api/history') data = { operations: [], jobs: [] };
    if (path === '/api/planner') data = { items: [], partial: false };
    await route.fulfill({ json: data });
  });
});

test('busy month stays bounded with every item available in the selected-day list', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/');
  await page.getByLabel('Go to date').fill('2026-10-19');
  await page.getByRole('button', { name: 'Month', exact: true }).click();
  const cell = page
    .locator('.month-day')
    .filter({ has: page.getByRole('button', { name: 'Show 2026-10-19, 12 items', exact: true }) });
  await expect(cell.locator('.month-event')).toHaveCount(2);
  expect(
    await cell
      .locator('.month-more')
      .evaluate(
        (el) =>
          el.getBoundingClientRect().bottom <=
          el.parentElement!.parentElement!.getBoundingClientRect().bottom,
      ),
  ).toBe(true);
  await cell.locator('.month-more').click();
  await expect(page.locator('.month-agenda-event')).toHaveCount(12);
  expect(await cell.evaluate((el) => el.getBoundingClientRect().height)).toBeLessThanOrEqual(160);
  await expect(page.locator('.assistant-panel')).not.toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.runtime/screenshots/calendar-month-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(cell.locator('.month-previews')).not.toBeVisible();
  await cell.locator('.month-mobile-count').click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('heading', { name: 'Monday 19 October' })).toBeInViewport();
  await expect(page.locator('.month-agenda-event')).toHaveCount(12);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.runtime/screenshots/calendar-month-mobile.png', fullPage: false });
  await page.locator('.month-agenda-event').last().click();
  await expect(page.getByLabel('Event title', { exact: true })).toHaveValue(/Project review 12/);
});

test('all-day records stay compact, expand explicitly and leave room for the timeline', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.getByLabel('Go to date').fill('2026-10-19');
  await page.getByRole('button', { name: 'Week', exact: true }).click();
  const cell = page.locator('.all-day-cell').first();
  await expect(cell.locator(':scope > .all-day-event')).toHaveCount(2);
  await expect(page.locator('.grid-event')).toHaveCount(4);
  expect(await cell.evaluate((el) => el.getBoundingClientRect().height)).toBeLessThanOrEqual(120);
  await cell.locator('summary').click();
  await expect(cell.locator('details')).toHaveAttribute('open', '');
  await expect(cell.locator('details .all-day-event')).toHaveCount(6);
  expect(await cell.evaluate((el) => el.getBoundingClientRect().height)).toBeLessThanOrEqual(120);
  await cell.locator('summary').click();
  for (const scrollTop of [0, 900]) {
    await page.locator('.week-scroll').evaluate((el, top) => {
      el.scrollTop = top;
    }, scrollTop);
    await expect
      .poll(async () => {
        const header = await page.locator('.day-header').first().boundingBox();
        const band = await cell.boundingBox();
        return Math.abs(band!.y - (header!.y + header!.height));
      })
      .toBeLessThanOrEqual(1);
  }
  await page.screenshot({ path: '.runtime/screenshots/calendar-week-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Day', exact: true }).click();
  await expect(page.locator('.all-day-cell')).toHaveCount(1);
  await page.locator('.week-scroll').evaluate((el) => {
    el.scrollTop = 1000;
  });
  await expect
    .poll(async () => {
      const header = await page.locator('.day-header').boundingBox();
      const band = await page.locator('.all-day-cell').boundingBox();
      return Math.abs(band!.y - (header!.y + header!.height));
    })
    .toBeLessThanOrEqual(1);
  await page.screenshot({ path: '.runtime/screenshots/calendar-day-pinned-mobile.png', fullPage: false });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: 'Ask C.O.R.' }).click();
  await expect(page.locator('.assistant-panel')).toBeVisible();
});

test('first-of-month ranges and dark tablet layout remain usable', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.goto('/');
  await page.getByLabel('Go to date').fill('2026-11-01');
  await page.getByRole('button', { name: 'Month', exact: true }).click();
  await expect(page.locator('.month-date').first()).toHaveAttribute('aria-label', /2026-10-26/);
  await expect(page.locator('.month-date')).toHaveCount(42);
  await page.getByLabel('Go to date').fill('2026-02-01');
  await expect(page.locator('.month-date').first()).toHaveAttribute('aria-label', /2026-01-26/);
  await expect(page.locator('.month-date')).toHaveCount(35);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.runtime/screenshots/calendar-tablet-dark.png', fullPage: true });
});
