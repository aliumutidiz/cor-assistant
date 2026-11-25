import type { CalendarEvent } from '../shared/contracts';

// Memory-only, account scoped by the App instance. No personal event data is
// persisted in localStorage or a service worker.
export class CalendarCache<T = CalendarEvent[]> {
  private rows = new Map<string, { value: T; at: number }>();
  private pending = new Map<string, Promise<T>>();
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
  /** Reuse a loaded month when opening one of its days; never cross calendar/query boundaries. */
  covering(key: string) {
    const exact = this.peek(key);
    if (exact?.fresh) return exact;
    const wanted = new URLSearchParams(key);
    const from = Date.parse(wanted.get('from') ?? ''),
      to = Date.parse(wanted.get('to') ?? '');
    if (!Number.isFinite(from) || !Number.isFinite(to)) return exact;
    wanted.delete('from');
    wanted.delete('to');
    wanted.sort();
    let best = exact;
    for (const [candidate, row] of this.rows) {
      const query = new URLSearchParams(candidate);
      const start = Date.parse(query.get('from') ?? ''),
        end = Date.parse(query.get('to') ?? '');
      query.delete('from');
      query.delete('to');
      query.sort();
      if (
        query.toString() !== wanted.toString() ||
        start > from ||
        end < to ||
        !Number.isFinite(start) ||
        !Number.isFinite(end)
      )
        continue;
      const fresh = Date.now() - row.at < this.ttl;
      if (!best || (fresh && !best.fresh) || (fresh === best.fresh && row.at > best.at))
        best = { ...row, fresh };
    }
    return best;
  }
  clear() {
    this.generation++;
    this.rows.clear();
    this.pending.clear();
  }
  load(key: string, fetcher: () => Promise<T>, force = false) {
    const cached = this.covering(key);
    if (!force && cached?.fresh) return Promise.resolve(cached.value);
    const pending = this.pending.get(key);
    if (pending) return pending;
    const generation = this.generation;
    const promise = fetcher()
      .then((value) => {
        if (generation === this.generation) {
          this.rows.delete(key);
          this.rows.set(key, { value, at: Date.now() });
          while (this.rows.size > this.limit) this.rows.delete(this.rows.keys().next().value!);
        }
        return value;
      })
      .finally(() => {
        if (this.pending.get(key) === promise) this.pending.delete(key);
      });
    this.pending.set(key, promise);
    return promise;
  }
}
