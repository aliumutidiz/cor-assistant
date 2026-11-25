import { test, expect } from '@playwright/test';

test('a queued task is acknowledged without waiting for a slow history refresh or allowing duplicate clicks', async ({
  page,
}) => {
  let posted = 0;
  let submitted = false;
  let lateHistoryReturned = false;
  const task = {
    id: '22222222-2222-4222-8222-222222222222',
    version: 1,
    title: 'Renew library membership',
    kind: 'task',
    body: 'Bring the membership card.',
    summary: '',
    tags: [],
    archived: false,
    taskState: 'open',
    amount: null,
    currency: null,
    createdAt: '2026-11-20T08:00:00Z',
    updatedAt: '2026-11-20T08:00:00Z',
    source: { channel: 'web', text: 'Bring the membership card.' },
  };
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/progress') return route.abort();
    let value: unknown = [];
    if (path === '/api/session')
      value = {
        csrf: 'fixture',
        demo: true,
        owner: 'ui@example.org',
        preferences: { timeZone: 'Europe/Istanbul', language: 'en' },
      };
    if (path === '/api/planner') value = { items: [], partial: false };
    if (path === '/api/memories') value = { items: [task] };
    if (path === '/api/history') {
      if (submitted) {
        await new Promise((resolve) => setTimeout(resolve, 3500));
        lateHistoryReturned = true;
      }
      value = { operations: [], jobs: [] };
    }
    if (path === '/api/operations') {
      posted++;
      submitted = true;
      value = {
        id: '33333333-3333-4333-8333-333333333333',
        status: 'queued',
        createdAt: '2026-11-25T08:00:00Z',
        action: route.request().postDataJSON(),
      };
    }
    await route.fulfill({ json: value });
  });
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Workspace', exact: true })
    .getByRole('button', { name: 'Today', exact: true })
    .click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.locator('.operation-feedback')).toContainText('Change queued', { timeout: 1000 });
  await expect(page.locator('.operation-feedback')).not.toContainText('Changes saved');
  await expect(page.getByRole('button', { name: 'Pending…', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Pending…', exact: true })).toBeDisabled();
  await expect.poll(() => lateHistoryReturned).toBe(true);
  await expect(page.getByRole('button', { name: 'Pending…', exact: true })).toBeDisabled();
  expect(posted).toBe(1);
  await page.setViewportSize({ width: 390, height: 800 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await page.screenshot({ path: '.runtime/screenshots/queued-task-mobile.png' });
});

test('an immediately confirmed calendar change appears without waiting for a progress stream', async ({
  page,
}) => {
  const rows: Record<string, unknown>[] = [];
  const operations: Record<string, unknown>[] = [];
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/progress') return route.abort();
    let value: unknown = [];
    if (path === '/api/session')
      value = {
        csrf: 'fixture',
        demo: true,
        owner: 'ui@example.org',
        preferences: { timeZone: 'Europe/Istanbul', language: 'en' },
      };
    if (path === '/api/calendars') value = [{ id: 'primary', summary: 'Personal', accessRole: 'owner' }];
    if (path === '/api/history') value = { operations, jobs: [] };
    if (path === '/api/planner') value = { items: [], partial: false };
    if (path === '/api/events') value = rows;
    if (path === '/api/operations') {
      const action = route.request().postDataJSON();
      rows.push({ ...action.event, id: 'added', calendarId: 'primary' });
      const op = {
        id: crypto.randomUUID(),
        status: 'succeeded',
        action,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      operations.push(op);
      value = op;
    }
    await route.fulfill({ json: value });
  });
  await page.goto('/');
  await page.getByLabel('Go to date').fill('2026-11-10');
  await page.getByRole('button', { name: 'Day', exact: true }).click();
  await page.getByRole('button', { name: 'Add event', exact: true }).click();
  await page.getByLabel('Event title', { exact: true }).fill('Reading session');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('dialog')).not.toBeVisible();
  await expect(page.locator('.grid-event').filter({ hasText: 'Reading session' })).toBeVisible({
    timeout: 1500,
  });
});
