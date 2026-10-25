import { test, expect } from '@playwright/test';

test('manages separate personal records and provides visible microphone failure feedback', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.addInitScript(() => {
    if (navigator.mediaDevices)
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
        value: async () => {
          throw new DOMException('Denied', 'NotAllowedError');
        },
      });
  });
  const records: Record<string, unknown>[] = [];
  const writes: Record<string, unknown>[] = [];
  const id = '11111111-1111-4111-8111-111111111111';
  const voice = {
    enabled: false,
    configured: false,
    freeTierConfirmed: false,
    voice: 'Sulafat',
    dailyLimit: 20,
    used: 0,
    day: '2026-10-21',
    speechInput: true,
  };
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname;
    if (path === '/api/progress') return route.abort();
    let value: unknown = [];
    if (path === '/api/session')
      value = {
        csrf: 'fixture',
        demo: true,
        agyEnabled: true,
        preferences: { timeZone: 'Europe/Istanbul', language: 'tr' },
      };
    if (path === '/api/history') value = { operations: [], jobs: [] };
    if (path === '/api/agy/status') value = { available: true, connection: { state: 'ready' } };
    if (path === '/api/voice/status') value = voice;
    if (path === '/api/memories')
      value = {
        items: records.filter((r) =>
          String(r.title)
            .toLocaleLowerCase('tr')
            .includes((url.searchParams.get('query') ?? '').toLocaleLowerCase('tr')),
        ),
      };
    if (path === '/api/memories/' + id + '/revisions') value = records;
    if (path === '/api/operations') {
      const action = route.request().postDataJSON();
      writes.push(action);
      records.push({
        ...action.record,
        id,
        seq: '1',
        version: 1,
        archived: false,
        createdAt: '2026-10-21T12:00:00Z',
        updatedAt: '2026-10-21T12:00:00Z',
        source: { channel: 'web', text: action.record.body },
      });
      value = { id, status: 'succeeded', action };
    }
    await route.fulfill({ json: value });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Memory', exact: true }).click();
  await page.getByRole('button', { name: 'Add record', exact: true }).click();
  const dialog = page.getByRole('dialog');
  await dialog.getByLabel('Title', { exact: true }).fill('Ortak ekipman fikri');
  await dialog
    .getByLabel('Original content', { exact: true })
    .fill('Komşular için ortak ekipman kiralama. Önce küçük bir pilot.');
  await dialog.getByLabel('Tags (comma-separated)').fill('proje, mahalle');
  await dialog.getByRole('button', { name: 'Save', exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Ortak ekipman fikri', exact: true })).toBeVisible();
  expect(writes[0]).toMatchObject({
    kind: 'memory.create',
    record: { kind: 'idea', occurredAt: null, amount: null, currency: null, tags: ['proje', 'mahalle'] },
  });
  await page.getByRole('button', { name: 'Ortak ekipman fikri', exact: true }).click();
  await expect(
    page.getByRole('dialog').getByText('Original record, source and the latest 50 versions.'),
  ).toBeVisible();
  await expect(page.getByRole('dialog').getByRole('link', { name: 'Download Markdown' })).toHaveAttribute(
    'href',
    '/api/memories/' + id + '/export',
  );
  await page.getByRole('button', { name: 'Close record', exact: true }).click();
  await page.getByLabel('Search records').fill('olmayan');
  await expect(page.getByText('No records match this search.')).toBeVisible();
  await page.getByRole('button', { name: 'Record voice message', exact: true }).click();
  await expect(page.getByText(/Microphone unavailable|This browser cannot record audio/)).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
});
