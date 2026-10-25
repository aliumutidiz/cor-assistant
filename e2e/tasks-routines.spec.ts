import { test, expect } from '@playwright/test';

test('completes a task into history and creates an explicit AI report with its focus preserved', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  const records: any[] = [],
    routines: any[] = [],
    writes: any[] = [];
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname;
    if (path === '/api/progress') return route.abort();
    let value: unknown = [];
    if (path === '/api/session')
      value = {
        csrf: 'task-test',
        demo: true,
        agyEnabled: true,
        preferences: { timeZone: 'Europe/Istanbul', language: 'tr' },
      };
    if (path === '/api/history') value = { operations: [], jobs: [] };
    if (path === '/api/routines') value = routines;
    if (path === '/api/routines/preview') value = { nextRun: '2026-10-25T15:00:00Z' };
    if (path === '/api/memories')
      value = { items: records.filter((r) => r.archived === (url.searchParams.get('archived') === 'true')) };
    if (path === '/api/operations') {
      const action = route.request().postDataJSON();
      writes.push(action);
      const id = '11111111-1111-4111-8111-' + String(writes.length).padStart(12, '0');
      if (action.kind === 'memory.create')
        records.push({
          ...action.record,
          id,
          seq: '1',
          archived: false,
          version: 1,
          createdAt: '2026-10-23T12:00:00Z',
          updatedAt: '2026-10-23T12:00:00Z',
          source: { channel: 'web', text: action.record.body },
        });
      if (action.kind === 'memory.complete')
        Object.assign(
          records.find((r) => r.id === action.memoryId),
          { archived: true, taskState: 'done', version: 2 },
        );
      if (action.kind === 'routine.create')
        routines.push({
          ...action.routine,
          id,
          version: 1,
          nextRun: '2026-10-25T15:00:00Z',
          updatedAt: '2026-10-23T12:00:00Z',
        });
      value = { id, status: 'succeeded', action };
    }
    await route.fulfill({ json: value });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Memory', exact: true }).click();
  await page.getByRole('button', { name: 'Add record', exact: true }).click();
  let dialog = page.getByRole('dialog');
  await dialog.getByRole('combobox', { name: 'Type', exact: true }).selectOption('task');
  await dialog.getByLabel('Title', { exact: true }).fill('Faturayı öde');
  await dialog.getByLabel('Original content', { exact: true }).fill('Faturayı ödemeyi unutma.');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Mark complete', exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Mark complete', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Faturayı öde', exact: true })).toHaveCount(0);
  await page.getByLabel('Archived / completed', { exact: true }).check();
  await expect(page.getByText('Completed', { exact: true })).toBeVisible();
  expect(writes[1]).toMatchObject({ kind: 'memory.complete', version: 1 });
  await page.getByRole('button', { name: 'Routines', exact: true }).click();
  await page.getByRole('button', { name: 'Create routine', exact: true }).click();
  dialog = page.getByRole('dialog');
  await dialog.getByLabel('Routine name', { exact: true }).fill('Gelecek hafta raporu');
  await dialog.getByRole('combobox', { name: 'Action', exact: true }).selectOption('ai_weekly_summary');
  await expect(dialog.getByText('Uses the assistant', { exact: true })).toBeVisible();
  await dialog.getByLabel('Briefing focus (optional)', { exact: true }).fill('Yoğun günleri vurgula.');
  await dialog.getByLabel('Schedule', { exact: true }).selectOption('0 18 * * 0');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  expect(writes.at(-1)).toMatchObject({
    kind: 'routine.create',
    routine: {
      kind: 'ai_weekly_summary',
      cron: '0 18 * * 0',
      message: 'Yoğun günleri vurgula.',
      enabled: false,
    },
  });
  await expect(page.getByText(/AI briefing · When enabled/)).toBeVisible();
});
