import { describe, it, expect, vi } from 'vitest';
import { CalendarCache } from '../src/calendar-cache.js';
describe('calendar range cache', () => {
  it('deduplicates fetches, reuses ranges and isolates invalidated generations', async () => {
    const cache = new CalendarCache(2),
      fetch = vi.fn(async () => []);
    await Promise.all([cache.load('week', fetch), cache.load('week', fetch)]);
    await cache.load('week', fetch);
    expect(fetch).toHaveBeenCalledTimes(1);
    let finish!: (events: []) => void;
    const old = cache.load(
      'next',
      () =>
        new Promise<[]>((resolve) => {
          finish = resolve;
        }),
    );
    cache.clear();
    finish([]);
    await old;
    expect(cache.peek('next')).toBeUndefined();
    await cache.load('week', fetch);
    expect(fetch).toHaveBeenCalledTimes(2);
    await cache.load('two', fetch);
    await cache.load('three', fetch);
    expect(cache.peek('week')).toBeUndefined();
  });
  it('reuses covering ranges without crossing calendars and retains stale snapshots on refresh failure', async () => {
    const cache = new CalendarCache(8, 100);
    const key = (id: string, from: string, to: string) =>
      new URLSearchParams({ calendarId: id, from, to }).toString();
    const month = key('one', '2026-11-01T00:00Z', '2026-12-01T00:00Z');
    const day = key('one', '2026-11-10T00:00Z', '2026-11-11T00:00Z');
    await cache.load(month, async () => []);
    const fetch = vi.fn(async () => []);
    await cache.load(day, fetch);
    expect(fetch).not.toHaveBeenCalled();
    expect(cache.covering(key('two', '2026-11-10T00:00Z', '2026-11-11T00:00Z'))).toBeUndefined();
    expect(cache.covering(key('one', '2026-10-31T00:00Z', '2026-11-11T00:00Z'))).toBeUndefined();
    const clock = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 1000);
    try {
      expect(cache.covering(day)?.fresh).toBe(false);
      await expect(
        cache.load(day, async () => {
          throw Error('offline');
        }),
      ).rejects.toThrow('offline');
      expect(cache.covering(day)?.value).toEqual([]);
      cache.clear();
      expect(cache.covering(day)).toBeUndefined();
    } finally {
      clock.mockRestore();
    }
  });
});
