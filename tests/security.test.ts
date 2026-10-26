import { describe, it, expect, afterEach } from 'vitest';
import { createApp } from '../server/app.js';
import { loadConfig } from '../server/config.js';
import { MemoryStore } from '../server/repositories.js';
import { seal, unseal, digest } from '../server/crypto.js';
import type { FastifyInstance } from 'fastify';
let app: FastifyInstance;
afterEach(async () => {
  await app?.close();
});
async function setup() {
  const runtime = await createApp(loadConfig({ NODE_ENV: 'test' }), new MemoryStore());
  app = runtime.app;
  await runtime.routines.seed();
  const response = await app.inject({ url: '/api/session', headers: { host: 'localhost' } });
  const cookie = response.cookies[0].name + '=' + response.cookies[0].value;
  return { ...runtime, cookie, csrf: response.json().csrf };
}
describe('HTTP security boundaries', () => {
  it('protects memory, exports and voice settings with the existing owner session', async () => {
    const { cookie, csrf } = await setup();
    for (const url of [
      '/api/chat/context',
      '/api/chat/snapshot',
      '/api/chat/export',
      '/api/memories',
      '/api/brain/export',
      '/api/settings/telegram',
      '/api/settings/research',
      '/api/reminders',
      '/api/voice/status',
      '/api/memories/00000000-0000-4000-8000-000000000001/export',
    ])
      expect((await app.inject({ url, headers: { host: 'localhost' } })).statusCode).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/voice/settings',
          headers: { host: 'localhost', cookie, origin: 'https://evil.example', 'x-cor-csrf': csrf },
          payload: {},
        })
      ).statusCode,
    ).toBe(403);
    const secret = 'voice-settings-secret-test-fixture';
    const response = await app.inject({
      method: 'POST',
      url: '/api/voice/settings',
      headers: { host: 'localhost', cookie, origin: 'http://localhost:5173', 'x-cor-csrf': csrf },
      payload: {
        settings: { enabled: false, freeTierConfirmed: true, voice: 'Sulafat', dailyLimit: 20 },
        apiKey: secret,
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.body).not.toContain(secret);
    expect(response.json().configured).toBe(true);
    const exported = await app.inject({ url: '/api/brain/export', headers: { host: 'localhost', cookie } });
    expect(exported.statusCode).toBe(200);
    expect(exported.json()).toMatchObject({ format: 'cor.personal-memory', schemaVersion: 1, records: [] });
    expect(exported.body).not.toContain(secret);
  });
  it('protects streaming speech and reports disabled generation with an explicit error frame', async () => {
    const { cookie, csrf } = await setup();
    const url = '/api/speak/stream',
      payload = { text: 'deneme' };
    expect(
      (await app.inject({ method: 'POST', url, payload, headers: { host: 'localhost' } })).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url,
          payload,
          headers: { host: 'localhost', cookie, origin: 'https://evil.example', 'x-cor-csrf': csrf },
        })
      ).statusCode,
    ).toBe(403);
    const response = await app.inject({
      method: 'POST',
      url,
      payload,
      headers: { host: 'localhost', cookie, origin: 'http://localhost:5173', 'x-cor-csrf': csrf },
    });
    expect(response.headers['cache-control']).toContain('no-store');
    expect(response.headers['x-accel-buffering']).toBe('no');
    const frames = response.body
      .trim()
      .split('\n')
      .map((line) => JSON.parse(line));
    expect(frames).toEqual([
      { type: 'start', sampleRate: 24000 },
      { type: 'error', message: expect.any(String), status: 503 },
    ]);
  });
  it('rejects mutations without a session', async () => {
    await setup();
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/operations',
          headers: { host: 'localhost' },
          payload: {},
        })
      ).statusCode,
    ).toBe(401);
  });
  it('rejects forged origins and missing CSRF', async () => {
    const { cookie, csrf } = await setup();
    for (const headers of [
      { host: 'localhost', cookie, origin: 'https://evil.example', 'x-cor-csrf': csrf },
      { host: 'localhost', cookie, origin: 'http://localhost:5173' },
    ])
      expect(
        (await app.inject({ method: 'POST', url: '/api/operations', headers, payload: {} })).statusCode,
      ).toBe(403);
  });
  it('rejects DNS rebinding hosts in development', async () => {
    await setup();
    expect(
      (await app.inject({ url: '/api/session', headers: { host: 'attacker.example' } })).statusCode,
    ).toBe(403);
  });
  it('does not disclose tokens, secrets or session ids', async () => {
    await setup();
    const response = await app.inject({ url: '/api/session', headers: { host: 'localhost' } });
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.json()).not.toHaveProperty('id');
    expect(response.json()).not.toHaveProperty('SESSION_SECRET');
  });
  it('rejects invalid and unknown action fields', async () => {
    const { cookie, csrf } = await setup();
    const response = await app.inject({
      method: 'POST',
      url: '/api/operations',
      headers: {
        host: 'localhost',
        cookie,
        origin: 'http://localhost:5173',
        'x-cor-csrf': csrf,
        'idempotency-key': 'test-key-123',
      },
      payload: {
        kind: 'preferences.update',
        timeZone: 'Europe/Istanbul',
        language: 'tr',
        disableApprovals: true,
      },
    });
    expect(response.statusCode).toBe(400);
  });
  it('keeps demo Google OAuth disconnected', async () => {
    const { cookie, csrf } = await setup();
    const response = await app.inject({
      method: 'POST',
      url: '/api/oauth/connect',
      headers: { host: 'localhost', cookie, origin: 'http://localhost:5173', 'x-cor-csrf': csrf },
      payload: {},
    });
    expect(response.statusCode).toBe(409);
  });
  it('returns a real disabled-provider error without fake responses', async () => {
    const { cookie, csrf } = await setup();
    const response = await app.inject({
      method: 'POST',
      url: '/api/chat',
      headers: {
        host: 'localhost',
        cookie,
        origin: 'http://localhost:5173',
        'x-cor-csrf': csrf,
        'idempotency-key': 'chat-test-123',
      },
      payload: { message: 'Yarınki toplantımı sil' },
    });
    expect(response.statusCode).toBe(503);
    expect(response.json().error).toContain('doğrulama');
  });
  it('requires production identity, secrets, and an HTTPS origin', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow();
  });
  it('fails closed when AGY evidence is missing', () => {
    expect(() => loadConfig({ AGY_ENABLED: 'true' })).toThrow(/AGY/);
  });
});
describe('credential encryption and proposal integrity', () => {
  const key = Buffer.alloc(32, 7).toString('base64');
  it('authenticates ciphertext and rejects tampering', () => {
    const encrypted = seal({ refresh_token: 'secret' }, key);
    expect(encrypted).not.toContain('secret');
    expect(unseal(encrypted, key)).toEqual({ refresh_token: 'secret' });
    const parts = encrypted.split('.');
    parts[2] = Buffer.from('tampered').toString('base64url');
    expect(() => unseal(parts.join('.'), key)).toThrow();
  });
  it('hashes equivalent field orders identically', () => {
    expect(digest({ b: 2, a: 1 })).toBe(digest({ a: 1, b: 2 }));
    expect(digest({ a: 1 })).not.toBe(digest({ a: 2 }));
  });
});
