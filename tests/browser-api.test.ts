import { afterEach, describe, it, expect, vi } from 'vitest';
import { api } from '../src/api.js';
afterEach(() => vi.unstubAllGlobals());
describe('browser API error boundaries', () => {
  it('does not expose HTML proxy responses as JSON syntax errors', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('<html>Bad Gateway</html>', { status: 502 })),
    );
    await expect(api('/chat', { message: 'hello' })).rejects.toMatchObject({
      status: 502,
      message: expect.stringContaining('temporarily'),
    });
  });
  it('handles an empty successful response without a raw syntax error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('')));
    await expect(api('/chat/history')).rejects.toMatchObject({ message: expect.stringContaining('valid response') });
  });
  it('keeps valid API error messages', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(Response.json({ error: 'Oturum yenilenmeli.' }, { status: 503 })),
    );
    await expect(api('/chat', { message: 'hello' })).rejects.toMatchObject({
      message: 'Oturum yenilenmeli.',
    });
  });
  it('retries a transient history read once but never repeats a write', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response('proxy unavailable', { status: 502 }))
      .mockResolvedValueOnce(Response.json([{ id: '1', text: 'stored' }]));
    vi.stubGlobal('fetch', fetch);
    expect(await api('/chat/history')).toEqual([{ id: '1', text: 'stored' }]);
    expect(fetch).toHaveBeenCalledTimes(2);
    fetch.mockReset().mockRejectedValue(new TypeError('network'));
    await expect(api('/chat', { message: 'create' })).rejects.toMatchObject({ status: 503 });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});
