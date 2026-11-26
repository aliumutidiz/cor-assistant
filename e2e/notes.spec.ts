import { test, expect, type Page } from '@playwright/test';
import type { MemoryRecord } from '../shared/memory';
const programId = '11111111-1111-4111-8111-111111111111',
  entryId = '22222222-2222-4222-8222-222222222222';
async function fixture(page: Page, viewer = false) {
  const notes: MemoryRecord[] = [];
  let posts = 0,
    conflict = false;
  const program = {
    id: programId,
    seq: '1',
    version: 1,
    kind: 'program',
    title: 'Classes',
    body: 'Weekly classes',
    summary: '',
    tags: [],
    archived: false,
    occurredAt: null,
    occurredOn: null,
    amount: null,
    currency: null,
    timeZone: 'Europe/Istanbul',
    createdAt: '2026-11-26T00:00:00Z',
    updatedAt: '2026-11-26T00:00:00Z',
    source: { channel: 'web', text: 'Weekly classes' },
    program: {
      timeZone: 'Europe/Istanbul',
      enabled: true,
      from: null,
      until: null,
      excludedDates: [],
      entries: [
        {
          id: entryId,
          title: 'Calculus',
          frequency: 'weekly',
          days: [4],
          start: '10:30',
          end: '12:20',
          location: '',
        },
      ],
    },
  };
  const operations: unknown[] = [];
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url()),
      path = url.pathname;
    let value: unknown = [];
    if (path === '/api/progress') return route.abort();
    if (path === '/api/session')
      value = {
        csrf: 'fixture',
        demo: true,
        owner: 'notes@example.test',
        actor: { role: viewer ? 'viewer' : 'owner' },
        preferences: { timeZone: 'Europe/Istanbul', language: 'en' },
      };
    if (path === '/api/calendars') value = [{ id: 'primary', summary: 'Personal' }];
    if (path === '/api/history') value = { operations, jobs: [] };
    if (path === '/api/planner')
      value = {
        items: [
          {
            id: 'program-occurrence',
            calendarId: 'cor-local',
            source: 'program',
            sourceId: programId,
            entryId,
            originalDay: '2026-11-26',
            summary: 'Calculus',
            start: { dateTime: '2026-11-26T10:30:00+03:00' },
            end: { dateTime: '2026-11-26T12:20:00+03:00' },
          },
        ],
        partial: false,
      };
    if (path === '/api/memories') {
      const target = url.searchParams.get('noteTarget'),
        kind = url.searchParams.get('kind');
      value = target
        ? { items: notes.filter((row) => !row.archived && JSON.stringify(row.noteTarget) === target) }
        : { items: kind === 'task' ? [] : kind === 'note' ? notes : [program] };
    }
    if (path === '/api/memories/' + programId) value = program;
    if (path.endsWith('/revisions')) value = [];
    if (path === '/api/operations') {
      posts++;
      const action = route.request().postDataJSON();
      if (conflict && action.kind === 'memory.update') {
        conflict = false;
        return route.fulfill({
          status: 409,
          json: { error: 'This note changed. Refresh notes before editing the latest version.' },
        });
      }
      const id = crypto.randomUUID();
      if (action.kind === 'memory.create')
        notes.unshift({
          ...action.record,
          id,
          seq: String(notes.length + 2),
          version: 1,
          archived: false,
          timeZone: 'Europe/Istanbul',
          createdAt: '2026-11-26T08:00:00Z',
          updatedAt: '2026-11-26T08:00:00Z',
          source: { channel: 'web', text: action.record.body },
        });
      if (action.kind === 'memory.update') {
        const note = notes.find((row) => row.id === action.memoryId)!;
        Object.assign(note, action.record, { version: note.version + 1 });
      }
      if (action.kind === 'memory.archive') notes.find((row) => row.id === action.memoryId)!.archived = true;
      value = {
        id,
        status: 'succeeded',
        action,
        createdAt: '2026-11-26T08:00:00Z',
        updatedAt: '2026-11-26T08:00:00Z',
      };
      operations.unshift(value);
    }
    await route.fulfill({ json: value });
  });
  return {
    notes,
    posts: () => posts,
    conflict: () => {
      conflict = true;
    },
  };
}
test('day notes persist, stay isolated, preserve a conflicting draft and fit mobile', async ({ page }) => {
  const data = await fixture(page);
  await page.goto('/');
  await page.getByLabel('Go to date').fill('2026-11-26');
  await page.getByRole('button', { name: 'Week', exact: true }).click();
  await page.getByRole('button', { name: 'Notes for 2026-11-26', exact: true }).click();
  let panel = page.getByRole('dialog', { name: 'Notes', exact: true });
  await panel.getByLabel('Add a note', { exact: true }).fill('Bring the printed worksheet.');
  await panel.getByRole('button', { name: 'Save note', exact: true }).click();
  await expect(panel.locator('.attached-note')).toContainText('Bring the printed worksheet.');
  expect(data.notes[0].noteTarget).toEqual({ type: 'day', day: '2026-11-26' });
  await panel.getByRole('button', { name: 'Edit note', exact: true }).click();
  await panel.getByLabel('Edit note', { exact: true }).fill('Keep my unsaved correction.');
  data.conflict();
  await panel.getByRole('button', { name: 'Save changes', exact: true }).click();
  await expect(panel.getByRole('alert')).toContainText('This note changed');
  await expect(panel.getByLabel('Edit note', { exact: true })).toHaveValue('Keep my unsaved correction.');
  await panel.getByRole('button', { name: 'Close notes', exact: true }).click();
  await page.getByRole('button', { name: 'Notes for 2026-11-27', exact: true }).click();
  await expect(panel.locator('.attached-note')).toHaveCount(0);
  await panel.getByRole('button', { name: 'Close notes', exact: true }).click();
  await page.reload();
  await page.getByLabel('Go to date').fill('2026-11-26');
  await page.getByRole('button', { name: 'Week', exact: true }).click();
  await page.getByRole('button', { name: 'Notes for 2026-11-26', exact: true }).click();
  await expect(panel.locator('.attached-note')).toHaveCount(1);
  await page.setViewportSize({ width: 390, height: 844 });
  const box = await panel.boundingBox();
  expect(box!.x).toBeGreaterThanOrEqual(0);
  expect(box!.x + box!.width).toBeLessThanOrEqual(391);
  await panel.getByRole('button', { name: 'Archive note', exact: true }).click();
  await expect(panel.locator('.attached-note')).toHaveCount(0);
  await page.screenshot({ path: '.runtime/screenshots/day-notes-mobile.png', fullPage: false });
  expect(data.posts()).toBe(3);
});
test('program, activity and occurrence notes use separate contexts', async ({ page }) => {
  const data = await fixture(page);
  await page.goto('/');
  await page
    .getByRole('navigation', { name: 'Workspace', exact: true })
    .getByRole('button', { name: 'Programs', exact: true })
    .click();
  await page.locator('.memory-card').getByRole('button', { name: 'Notes', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Notes', exact: true });
  await panel.getByLabel('Add a note', { exact: true }).fill('General timetable note');
  await panel.getByRole('button', { name: 'Save note', exact: true }).click();
  await expect(panel.locator('.attached-note')).toHaveCount(1);
  await panel.getByRole('button', { name: 'Close notes', exact: true }).click();
  await page.locator('.program-entry-notes summary').click();
  await page.getByRole('button', { name: 'Notes for Calculus', exact: true }).click();
  await expect(panel.locator('.attached-note')).toHaveCount(0);
  await panel.getByLabel('Add a note', { exact: true }).fill('Calculus workbook');
  await panel.getByRole('button', { name: 'Save note', exact: true }).click();
  await expect(panel.locator('.attached-note')).toHaveCount(1);
  await panel.getByRole('button', { name: 'Close notes', exact: true }).click();
  await page
    .getByRole('navigation', { name: 'Workspace', exact: true })
    .getByRole('button', { name: 'Calendar', exact: true })
    .click();
  await page.getByLabel('Go to date').fill('2026-11-26');
  await page.getByRole('button', { name: 'Week', exact: true }).click();
  await page.locator('.grid-event[data-source="program"]').click();
  await page.getByRole('button', { name: 'Notes for this occurrence', exact: true }).click();
  await expect(panel.locator('.attached-note')).toHaveCount(0);
  await panel.getByLabel('Add a note', { exact: true }).fill('Worksheet for this Thursday only');
  await panel.getByRole('button', { name: 'Save note', exact: true }).click();
  await expect(panel.locator('.attached-note')).toHaveCount(1);
  expect(data.notes.map((row) => row.noteTarget)).toEqual([
    { type: 'program', id: programId, entryId, day: '2026-11-26' },
    { type: 'program', id: programId, entryId },
    { type: 'program', id: programId },
  ]);
  await page.screenshot({ path: '.runtime/screenshots/program-occurrence-notes.png', fullPage: false });
});
test('a viewer can open day notes but cannot create or edit them', async ({ page }) => {
  const data = await fixture(page, true);
  await page.goto('/');
  await page.getByLabel('Go to date').fill('2026-11-26');
  await page.getByRole('button', { name: 'Week', exact: true }).click();
  await page.getByRole('button', { name: 'Notes for 2026-11-26', exact: true }).click();
  const panel = page.getByRole('dialog', { name: 'Notes', exact: true });
  await expect(panel.getByLabel('Add a note', { exact: true })).toHaveCount(0);
  await expect(panel.getByRole('button', { name: 'Save note', exact: true })).toHaveCount(0);
  expect(data.posts()).toBe(0);
});
