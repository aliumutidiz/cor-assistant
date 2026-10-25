import { test, expect } from '@playwright/test';

test('signed-out users see only the login screen and no calendar requests', async ({ page }) => {
  const requests: string[] = [];
  await page.route('**/api/**', async (route) => {
    requests.push(new URL(route.request().url()).pathname);
    await route.fulfill({ status: 401, json: { error: 'Giriş gerekli.', loginRequired: true } });
  });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Welcome to C.O.R.' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in with Google' })).toHaveAttribute(
    'href',
    '/api/auth/login',
  );
  await expect(page.locator('.app-shell')).toHaveCount(0);
  expect(requests.every((path) => path === '/api/session')).toBe(true);
});

test('a connection failure offers retry instead of presenting a login as successful', async ({ page }) => {
  await page.route('**/api/session', (route) =>
    route.fulfill({ status: 503, json: { error: 'Could not connect.' } }),
  );
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Retry' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Sign in with Google' })).toHaveCount(0);
});
