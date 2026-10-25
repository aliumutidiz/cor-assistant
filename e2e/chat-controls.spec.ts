import { test, expect } from '@playwright/test';
test('starts a new conversation, retains searchable archive and recovers drafts', async ({ page }) => {
  let state = { version: 1, contextId: 'initial', contextAfter: '0', visibleAfter: '0' };
  const archive = [
    { id: '1', role: 'user', text: 'Earlier skating plan', createdAt: '2026-10-25T10:00:00Z' },
    { id: '2', role: 'assistant', text: 'Saved answer', createdAt: '2026-10-25T10:01:00Z' },
  ];
  await page.route('**/api/**', async (route) => {
    const u = new URL(route.request().url());
    let value: unknown = [];
    if (u.pathname === '/api/progress') return route.abort();
    if (u.pathname === '/api/session')
      value = {
        csrf: 'fixture',
        owner: 'demo-owner',
        demo: true,
        agyEnabled: true,
        googleConnected: false,
        preferences: { timeZone: 'Europe/Istanbul', language: 'en' },
      };
    if (u.pathname === '/api/history') value = { operations: [], jobs: [] };
    if (u.pathname === '/api/agy/status') value = { available: true, connection: { state: 'ready' } };
    if (u.pathname === '/api/chat/history')
      value = u.searchParams.has('archive') || state.version === 1 ? archive : [];
    if (u.pathname === '/api/chat/context') {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON();
        expect(body.expectedVersion).toBe(state.version);
        state = { version: state.version + 1, contextId: 'fresh', contextAfter: '2', visibleAfter: '2' };
      }
      value = state;
    }
    await route.fulfill({ json: value });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Assistant', exact: true }).click();
  await expect(page.getByText('Saved answer', { exact: true })).toBeVisible();
  const composer = page.locator('textarea');
  await composer.fill('Recover this draft');
  await page.reload();
  await page.getByRole('button', { name: 'Assistant', exact: true }).click();
  await expect(composer).toHaveValue('Recover this draft');
  await page.getByRole('button', { name: 'Conversation', exact: true }).click();
  await page.getByRole('button', { name: 'New chat', exact: true }).click();
  await page.getByRole('button', { name: 'Confirm', exact: true }).click();
  await expect(page.getByText('New conversation started.', { exact: true })).toBeVisible();
  await expect(page.locator('.messages .message')).toHaveCount(0);
  await expect(composer).toHaveValue('');
  await page.getByRole('button', { name: 'Saved history', exact: true }).click();
  await expect(page.locator('.chat-tools-history')).toContainText('Earlier skating plan');
});
