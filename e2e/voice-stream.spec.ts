import { test, expect, type Page } from '@playwright/test';

async function mockVoicePage(page: Page) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/progress') return route.abort();
    let value: unknown = [];
    if (path === '/api/session')
      value = {
        csrf: 'voice-test',
        demo: true,
        agyEnabled: true,
        preferences: { timeZone: 'Europe/Istanbul', language: 'tr' },
      };
    if (path === '/api/history') value = { operations: [], jobs: [] };
    if (path === '/api/chat/history') value = [{ id: '1', role: 'assistant', text: 'Takvimine ekledim.' }];
    if (path === '/api/voice/status')
      value = {
        enabled: true,
        configured: true,
        freeTierConfirmed: true,
        voice: 'Charon',
        dailyLimit: 20,
        used: 0,
        day: '2026-10-23',
        speechInput: false,
      };
    await route.fulfill({ json: value });
  });
}

test('replays a completed clip locally without sending another HTTP request', async ({ page }) => {
  await page.addInitScript(() => {
    const original = window.fetch;
    (window as any).voiceCalls = 0;
    window.fetch = async (url, options) => {
      if (url !== '/api/speak/stream') return original(url, options);
      (window as any).voiceCalls++;
      const frames = [{ type: 'audio', format: 'pcm', data: btoa('\x00'.repeat(9600)) }, { type: 'done' }];
      return new Response(frames.map((f) => JSON.stringify(f)).join('\n') + '\n', {
        headers: { 'content-type': 'application/x-ndjson' },
      });
    };
  });
  await mockVoicePage(page);
  await page.goto('/');
  const listen = page.getByRole('button', { name: 'Listen', exact: true });
  await listen.click();
  await expect.poll(() => page.evaluate(() => (window as any).voiceCalls)).toBe(1);
  await expect(listen).toBeVisible();
  await listen.click();
  await expect(listen).toBeVisible();
  expect(await page.evaluate(() => (window as any).voiceCalls)).toBe(1);
  await page.evaluate(() => window.dispatchEvent(new Event('cor:voice-settings-changed')));
  await listen.click();
  await expect(listen).toBeVisible();
  expect(await page.evaluate(() => (window as any).voiceCalls)).toBe(2);
});

test('does not locally cache a failed or truncated stream', async ({ page }) => {
  await page.addInitScript(() => {
    const original = window.fetch;
    (window as any).voiceCalls = 0;
    window.fetch = async (url, options) => {
      if (url !== '/api/speak/stream') return original(url, options);
      (window as any).voiceCalls++;
      return new Response(
        JSON.stringify({ type: 'audio', format: 'pcm', data: btoa('\x00'.repeat(4800)) }) + '\n',
        { headers: { 'content-type': 'application/x-ndjson' } },
      );
    };
  });
  await mockVoicePage(page);
  await page.goto('/');
  const listen = page.getByRole('button', { name: 'Listen', exact: true });
  await listen.click();
  await expect(page.getByRole('alert')).toContainText('ended prematurely');
  await listen.click();
  await expect.poll(() => page.evaluate(() => (window as any).voiceCalls)).toBe(2);
});

test('plays incoming audio before completion and cancels playback without another generation', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.addInitScript(() => {
    const original = window.fetch;
    (window as any).voiceProbe = { calls: 0, canceled: false, csrf: '' };
    window.fetch = async (url, options) => {
      if (url !== '/api/speak/stream') return original(url, options);
      const probe = (window as any).voiceProbe;
      probe.calls++;
      probe.csrf = new Headers(options?.headers).get('X-Cor-Csrf');
      return new Response(
        new ReadableStream({
          start(controller) {
            const send = (frame: unknown) =>
              controller.enqueue(new TextEncoder().encode(JSON.stringify(frame) + '\n'));
            send({ type: 'start', sampleRate: 24000 });
            send({ type: 'audio', format: 'pcm', data: btoa('\x00'.repeat(4800)) });
            const timer = setTimeout(() => {
              send({ type: 'done' });
              controller.close();
            }, 5000);
            options?.signal?.addEventListener(
              'abort',
              () => {
                probe.canceled = true;
                clearTimeout(timer);
                controller.error(new DOMException('aborted', 'AbortError'));
              },
              { once: true },
            );
          },
        }),
        { headers: { 'content-type': 'application/x-ndjson' } },
      );
    };
  });
  await page.route('**/api/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path === '/api/progress') return route.abort();
    let value: unknown = [];
    if (path === '/api/session')
      value = {
        csrf: 'voice-test',
        demo: true,
        agyEnabled: true,
        preferences: { timeZone: 'Europe/Istanbul', language: 'tr' },
      };
    if (path === '/api/history') value = { operations: [], jobs: [] };
    if (path === '/api/chat/history') value = [{ id: '1', role: 'assistant', text: 'Takvimine ekledim.' }];
    if (path === '/api/voice/status')
      value = {
        enabled: true,
        configured: true,
        freeTierConfirmed: true,
        voice: 'Charon',
        dailyLimit: 20,
        used: 0,
        day: '2026-10-21',
        speechInput: false,
      };
    await route.fulfill({ json: value });
  });
  await page.goto('/');
  await page.getByRole('button', { name: 'Listen', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Stop audio', exact: true })).toHaveText('Durdur', {
    timeout: 2000,
  });
  await page.getByRole('button', { name: 'Stop audio', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Listen', exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as any).voiceProbe)).toEqual({
    calls: 1,
    canceled: true,
    csrf: 'voice-test',
  });
});
