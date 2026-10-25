import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../server/app.js';
import { loadConfig } from '../server/config.js';
import { MemoryStore } from '../server/repositories.js';
import { AgyManagement, notifyAgySession, monitorAgyConnection } from '../server/agy-management.js';
let app: FastifyInstance;
afterEach(async () => {
  await app?.close();
});
async function setup() {
  const call = vi.fn(async () => ({ available: true, active: false }));
  const manager = {
    call,
    status: vi.fn(async () => ({ available: true, connection: { state: 'ready' } })),
  } as unknown as AgyManagement;
  const store = new MemoryStore();
  app = (await createApp(loadConfig({ NODE_ENV: 'test' }), store, { agyManagement: manager })).app;
  const session = await app.inject({ url: '/api/session', headers: { host: 'localhost' } });
  const headers = {
    host: 'localhost',
    origin: 'http://localhost:5173',
    cookie: session.cookies.map((c) => c.name + '=' + c.value).join('; '),
    'x-cor-csrf': session.json().csrf,
  };
  return { call, store, headers };
}
describe('owner-only console management', () => {
  it('requires a session and CSRF before starting a console', async () => {
    const { call, headers } = await setup();
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/agy/console/start',
          payload: {},
          headers: { host: 'localhost' },
        })
      ).statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/agy/console/start',
          payload: {},
          headers: { ...headers, 'x-cor-csrf': '' },
        })
      ).statusCode,
    ).toBe(403);
    expect(call).not.toHaveBeenCalled();
  });
  it('never accepts an executable, shell arguments or unknown control', async () => {
    const { call, headers } = await setup();
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/agy/console/input',
          headers,
          payload: { session: 'a'.repeat(43), input: 'x', command: '/bin/bash' },
        })
      ).statusCode,
    ).toBe(400);
    expect(call).not.toHaveBeenCalled();
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/agy/console/input',
          headers,
          payload: { session: 'a'.repeat(43), input: '\r' },
        })
      ).statusCode,
    ).toBe(200);
    expect(call).toHaveBeenCalledWith({ control: 'write', session: 'a'.repeat(43), input: '\r' });
  });
  it('keeps archived conversation behind the normal session boundary', async () => {
    const { store, headers } = await setup();
    await store.appendConversation('one', 'Persisted question', 'Persisted answer');
    expect((await app.inject({ url: '/api/chat/history', headers: { host: 'localhost' } })).statusCode).toBe(
      401,
    );
    const response = await app.inject({ url: '/api/chat/history', headers });
    expect(response.json()).toHaveLength(2);
    expect(response.headers['cache-control']).toBe('no-store');
  });
  it('queues one auth-loss notification until a successful reconnection', async () => {
    const store = new MemoryStore();
    let state = 'auth_required';
    const manager = {
      status: async () => ({ connection: { state, updatedAt: state === 'ready' ? 'ready' : 'auth' } }),
    } as AgyManagement;
    const config = { ...loadConfig({ NODE_ENV: 'test' }), TELEGRAM_ENABLED: true };
    await notifyAgySession(manager, store, config);
    await notifyAgySession(manager, store, config);
    expect(await store.jobs()).toHaveLength(1);
    state = 'ready';
    await notifyAgySession(manager, store, config);
    expect(await store.get('agy.auth-notified')).toBe('');
  });
  it('checks stale authentication without sending a model prompt and skips an open console', async () => {
    const call = vi.fn(async () => ({}));
    let active = false;
    const manager = {
      call,
      status: async () => ({ available: true, active, connection: { state: 'unknown' } }),
    } as unknown as AgyManagement;
    const store = new MemoryStore();
    const config = { ...loadConfig({ NODE_ENV: 'test' }), AGY_ENABLED: true };
    await monitorAgyConnection(manager, store, config);
    expect(call).toHaveBeenCalledWith({ control: 'check' });
    call.mockClear();
    active = true;
    await monitorAgyConnection(manager, store, config);
    expect(call).not.toHaveBeenCalled();
  });
});
