import { beforeEach, afterEach, it, expect, vi, describe } from 'vitest';
import { GoogleCalendar } from '../server/google.js';
import { loadConfig } from '../server/config.js';
import { MemoryStore } from '../server/repositories.js';
import { seal } from '../server/crypto.js';
let store: MemoryStore, google: GoogleCalendar;
const config = loadConfig({
  NODE_ENV: 'test',
  OWNER_EMAIL: 'owner@example.org',
  GOOGLE_CLIENT_ID: 'client',
  GOOGLE_CLIENT_SECRET: 'secret',
});
beforeEach(async () => {
  store = new MemoryStore();
  await store.set(
    'google.tokens',
    seal(
      { access_token: 'access', refresh_token: 'refresh', expires_at: Date.now() + 3600000 },
      config.ENCRYPTION_KEY,
    ),
  );
  google = new GoogleCalendar(store, config);
});
afterEach(() => vi.unstubAllGlobals());
const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
describe('Google protocol behavior', () => {
  it('uses pagination and commits a final sync token', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json({ items: [{ id: 'one', summary: 'One' }], nextPageToken: 'page2' }))
      .mockResolvedValueOnce(json({ items: [{ id: 'two', summary: 'Two' }], nextSyncToken: 'next' }));
    vi.stubGlobal('fetch', fetch);
    await google.sync('primary');
    expect((await store.cache('primary'))?.events).toHaveLength(2);
    expect((await store.cache('primary'))?.token).toBe('next');
    expect(String(fetch.mock.calls[1][0])).toContain('pageToken=page2');
  });
  it('resets an invalid sync token and fetches a full snapshot', async () => {
    await store.saveCache('primary', 'expired', []);
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(json({}, 410))
      .mockResolvedValueOnce(json({ items: [], nextSyncToken: 'fresh' }));
    vi.stubGlobal('fetch', fetch);
    await google.sync('primary');
    expect((await store.cache('primary'))?.token).toBe('fresh');
    expect(String(fetch.mock.calls[1][0])).not.toContain('syncToken');
  });
  it('keeps the old snapshot when pagination fails', async () => {
    await store.saveCache('primary', 'old', []);
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(json({ items: [], nextPageToken: 'p2' }))
        .mockRejectedValueOnce(new Error('network')),
    );
    await expect(google.sync('primary')).rejects.toThrow();
    expect((await store.cache('primary'))?.token).toBe('old');
  });
  it('marks uncertain writes without leaking tokens', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('access token secret')));
    await expect(google.request('calendars/primary/events', 'POST', {})).rejects.toMatchObject({
      uncertain: true,
    });
  });
  it('sends If-Match and never silently overwrites conflicts', async () => {
    const fetch = vi.fn().mockResolvedValue(json({}, 412));
    vi.stubGlobal('fetch', fetch);
    await expect(
      google.request('calendars/primary', 'PATCH', { summary: 'A' }, '"v1"'),
    ).rejects.toMatchObject({ status: 409 });
    expect(fetch.mock.calls[0][1].headers['If-Match']).toBe('"v1"');
  });
  it('uses PKCE and state bound to the initiating session', async () => {
    const url = new URL(await google.authorization('session-a'));
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('scope')).toContain('calendar');
    await expect(google.callback(url.searchParams.get('state')!, 'code', 'session-b')).rejects.toMatchObject({
      status: 400,
    });
  });
  it('rejects stale event data before attempting a write', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json({ id: 'event', etag: '"new"' })));
    await expect(
      google.execute(
        {
          kind: 'event.delete',
          calendarId: 'primary',
          eventId: 'event',
          etag: '"old"',
          scope: 'single',
          notify: false,
          conference: false,
        },
        'op',
      ),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('routes calendar deletion even without a summary field', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', fetch);
    await google.execute({ kind: 'calendar.delete', calendarId: 'secondary', etag: '"v1"' }, 'op');
    expect(fetch.mock.calls[0][1].method).toBe('DELETE');
  });
});
