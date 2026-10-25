import type { CalendarEvent } from '../shared/contracts';

// Memory-only, account scoped by the App instance. No personal event data is
// persisted in localStorage or a service worker.
export class CalendarCache {
  private rows = new Map<string, { events: CalendarEvent[]; at: number }>();
  private pending = new Map<string, Promise<CalendarEvent[]>>();
  private generation = 0;
  constructor(
    private limit = 16,
    private ttl = 60000,
  ) {}
  peek(key: string) {
    const row = this.rows.get(key);
    if (!row) return undefined;
    this.rows.delete(key);
    this.rows.set(key, row);
    return { ...row, fresh: Date.now() - row.at < this.ttl };
  }
  clear() {
    this.generation++;
    this.rows.clear();
    this.pending.clear();
  }
  load(key: string, fetcher: () => Promise<CalendarEvent[]>, force = false) {
    const cached = this.peek(key);
    if (!force && cached?.fresh) return Promise.resolve(cached.events);
    const pending = this.pending.get(key);
    if (pending) return pending;
    const generation = this.generation;
    const promise = fetcher()
      .then((events) => {
        if (generation === this.generation) {
          this.rows.delete(key);
          this.rows.set(key, { events, at: Date.now() });
          while (this.rows.size > this.limit) this.rows.delete(this.rows.keys().next().value!);
        }
        return events;
      })
      .finally(() => {
        if (this.pending.get(key) === promise) this.pending.delete(key);
      });
    this.pending.set(key, promise);
    return promise;
  }
}
