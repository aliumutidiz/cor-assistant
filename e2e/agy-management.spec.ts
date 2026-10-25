import { test, expect } from '@playwright/test';

test('restores archived chat and provides an owner-controlled AGY-only terminal', async ({ page }) => {
  let opened = false,
    stopped = false;
  const inputs: unknown[] = [];
  const session = 'a'.repeat(43);
  const text = Buffer.from('\r\nAGY console ready\r\n');
  await page.route('**/api/**', async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname;
    if (path === '/api/progress') return route.abort();
    let value: unknown = [];
    if (path === '/api/session')
      value = {
        csrf: 'test',
        demo: true,
        owner: 'test@example.test',
        googleConnected: false,
        agyEnabled: true,
        preferences: { timeZone: 'Europe/Istanbul', language: 'tr' },
      };
    if (path === '/api/history') value = { operations: [], jobs: [] };
    if (path === '/api/chat/history')
      value = [
        { id: '1', role: 'user', text: 'Önceki konuşma saklandı' },
        { id: '2', role: 'assistant', text: 'Kalıcı yanıt' },
      ];
    if (path === '/api/agy/status') value = { available: true, connection: { state: 'auth_required' } };
    if (path === '/api/agy/check') value = { available: true, connection: { state: 'ready' } };
    if (path === '/api/agy/console/start') {
      opened = true;
      value = { available: true, active: true, session, offset: 0 };
    }
    if (path === '/api/agy/console/read')
      value = {
        active: true,
        data: url.searchParams.get('offset') === '0' ? text.toString('base64') : '',
        offset: text.length,
        reset: false,
      };
    if (path === '/api/agy/console/input') {
      inputs.push(route.request().postDataJSON());
      value = { active: true };
    }
    if (path === '/api/agy/console/stop') {
      stopped = true;
      value = { active: false };
    }
    await route.fulfill({ json: value });
  });
  await page.goto('/');
  await expect(page.getByText('Önceki konuşma saklandı', { exact: true })).toBeVisible();
  await page.reload();
  await expect(page.getByText('Önceki konuşma saklandı', { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Settings', exact: true }).click();
  await page.getByRole('button', { name: 'Assistant session', exact: true }).click();
  await page.getByRole('button', { name: 'Open AGY console' }).click();
  await expect(page.getByRole('dialog')).toBeVisible();
  await expect.poll(() => opened).toBe(true);
  await expect(page.locator('.agy-terminal .xterm')).toBeVisible();
  await page.locator('.xterm-helper-textarea').press('Enter');
  await expect.poll(() => inputs.length).toBeGreaterThan(0);
  expect(inputs[0]).toEqual({ session, input: '\r' });
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog')).toBeVisible();
  await page.setViewportSize({ width: 390, height: 844 });
  const bounds = await page.getByRole('dialog').boundingBox();
  expect(bounds!.x).toBeGreaterThanOrEqual(0);
  expect(bounds!.x + bounds!.width).toBeLessThanOrEqual(391);
  await page.getByRole('button', { name: 'Close and return to chat' }).click();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect.poll(() => stopped).toBe(true);
});
