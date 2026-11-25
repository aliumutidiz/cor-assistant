import { test, expect } from '@playwright/test';

test('workspace pages and editors stay usable across desktop and phone layouts', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.route('**/api/memories?**', async (route) => {
    const kindFilter = new URL(route.request().url()).searchParams.get('kind');
    const programs = kindFilter === 'program';
    const input = [
      [
        'idea',
        'A quieter morning routine',
        'Keep the first thirty minutes free for planning and a short walk.',
      ],
      ['task', 'Renew the library membership', 'Check the renewal date and bring the membership card.'],
      [
        'purchase',
        'Desk lamp for the reading corner',
        'Look for adjustable brightness and a warm light setting.',
      ],
    ];
    await route.fulfill({
      json: {
        items: programs
          ? []
          : input
              .filter(([kind]) => !kindFilter || kind === kindFilter)
              .map(([kind, title, body], i) => ({
                id: `record-${i}`,
                kind,
                title,
                body,
                summary: body,
                tags: ['personal'],
                version: 1,
                createdAt: '2026-11-20T09:00:00Z',
                updatedAt: '2026-11-24T08:00:00Z',
                archived: false,
                occurredAt: null,
                occurredOn: null,
                amount: null,
                currency: null,
                source: { channel: 'web', text: body },
                taskState: 'open',
              })),
      },
    });
  });
  await page.goto('/');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    for (const name of [
      'Today',
      'Memory',
      'Programs',
      'Reminders',
      'Routines',
      'Activity',
      'Settings',
      'Assistant',
    ]) {
      if (width < 761) await page.getByRole('button', { name: 'Workspace menu', exact: true }).click();
      await page
        .getByRole('navigation', { name: 'Workspace', exact: true })
        .getByRole('button', { name, exact: true })
        .click();
      await page.evaluate(() => scrollTo(0, 0));
      if (width < 761 && name !== 'Assistant')
        expect((await page.locator('.main').boundingBox())!.y).toBeLessThanOrEqual(61);
      expect(
        await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
        `${name} at ${width}`,
      ).toBe(true);
      if (name === 'Memory')
        await expect(
          page.getByRole('button', { name: 'A quieter morning routine', exact: true }),
        ).toBeVisible();
      await page.screenshot({ path: `.runtime/screenshots/workspace-${name.toLowerCase()}-${width}.png` });
      if (name === 'Programs') {
        await page.getByRole('button', { name: 'Add program', exact: true }).click();
        await expect(page.getByRole('dialog')).toBeVisible();
        await expect(page.getByRole('dialog')).toBeFocused();
        const box = await page.getByRole('dialog').boundingBox();
        expect(box!.width).toBeLessThanOrEqual(width);
        expect(box!.x).toBeGreaterThanOrEqual(0);
        expect(box!.y).toBeGreaterThanOrEqual(0);
        await expect(page.getByRole('heading', { name: 'Create program', exact: true })).toBeInViewport();
        expect(
          await page.getByRole('dialog').evaluate((el) => {
            const box = el.getBoundingClientRect();
            return el.contains(document.elementFromPoint(box.x + box.width / 2, box.y + box.height / 2));
          }),
        ).toBe(true);
        await page.screenshot({ path: `.runtime/screenshots/program-editor-${width}.png` });
        await page.getByRole('dialog').evaluate((el) => {
          el.scrollTop = el.scrollHeight;
        });
        await expect(page.getByRole('button', { name: 'Close record editor', exact: true })).toBeInViewport();
        await page.getByRole('button', { name: 'Close record editor', exact: true }).click();
      }
    }
  }
  expect(pageErrors).toEqual([]);
});

test('workspace navigation supports Back, Forward and reload without losing the selected section', async ({
  page,
}) => {
  await page.goto('/');
  const nav = page.getByRole('navigation', { name: 'Workspace', exact: true });
  await nav.getByRole('button', { name: 'Memory', exact: true }).click();
  await expect(page).toHaveURL(/#memories$/);
  await nav.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.goBack();
  await expect(page.getByRole('heading', { name: 'Memory', exact: true })).toBeVisible();
  await page.goForward();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Settings', exact: true })).toBeVisible();
});
