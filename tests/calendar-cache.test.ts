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
});
