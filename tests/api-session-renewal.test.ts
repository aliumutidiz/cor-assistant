import { afterEach, it, expect, vi } from 'vitest';
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});
it('renews a rejected API session once and keeps the same mutation idempotency key', async () => {
  vi.stubGlobal('window', new EventTarget());
  const fetch = vi
    .fn()
    .mockResolvedValueOnce(Response.json({ code: 'API_SESSION_EXPIRED' }, { status: 401 }))
    .mockResolvedValueOnce(Response.json({ csrf: 'x'.repeat(43) }))
    .mockResolvedValueOnce(Response.json({ ok: true }));
  vi.stubGlobal('fetch', fetch);
  const { api } = await import('../src/api');
  expect(await api('/operations', { value: 1 }, 'POST', 'stable-request-id')).toEqual({ ok: true });
  expect(fetch.mock.calls).toHaveLength(3);
  expect(fetch.mock.calls[0][1].headers['Idempotency-Key']).toBe('stable-request-id');
  expect(fetch.mock.calls[2][1].headers['Idempotency-Key']).toBe('stable-request-id');
  expect(fetch.mock.calls[2][1].headers['X-Cor-Csrf']).toBe('x'.repeat(43));
});
it('does not replay a Google 401 or a revoked application login', async () => {
  vi.stubGlobal('window', new EventTarget());
  const fetch = vi.fn().mockResolvedValue(Response.json({ error: 'Reconnect Google' }, { status: 401 }));
  vi.stubGlobal('fetch', fetch);
  const { api } = await import('../src/api');
  await expect(api('/operations', {}, 'POST', 'stable-request-id')).rejects.toMatchObject({ status: 401 });
  expect(fetch).toHaveBeenCalledTimes(1);
});
