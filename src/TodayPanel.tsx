import { useEffect, useState } from 'react';
import { api, formatDate } from './api';
import { localDayRange } from '../shared/time';
import type { CalendarEvent, OperationInput, Operation } from '../shared/contracts';
import type { MemoryPage } from '../shared/memory';
import type { PlannerItem } from './PlannerDetail';
export function TodayPanel({
  zone,
  revision,
  open,
  perform,
}: {
  zone: string;
  revision: string;
  open: (item: CalendarEvent) => void;
  perform: (input: OperationInput) => Promise<Operation | undefined>;
}) {
  const [items, setItems] = useState<CalendarEvent[]>([]),
    [tasks, setTasks] = useState<MemoryPage>({ items: [] });
  const [error, setError] = useState(''),
    [loading, setLoading] = useState(true);
  useEffect(() => {
    const abort = new AbortController();
    const load = async () => {
      const range = localDayRange(zone);
      const results = await Promise.allSettled([
        api<CalendarEvent[]>(
          '/events?' + new URLSearchParams({ calendarId: 'primary', ...range }),
          undefined,
          'GET',
          undefined,
          abort.signal,
        ),
        api<{ items: PlannerItem[]; partial: boolean }>(
          '/planner?' + new URLSearchParams(range),
          undefined,
          'GET',
          undefined,
          abort.signal,
        ),
        api<MemoryPage>('/memories?kind=task&taskState=open', undefined, 'GET', undefined, abort.signal),
      ]);
      if (abort.signal.aborted) return;
      const [calendar, local, taskPage] = results;
      setItems(
        [
          ...(calendar.status === 'fulfilled' ? calendar.value : []),
          ...(local.status === 'fulfilled' ? local.value.items : []),
        ].sort((a, b) =>
          (a.start.dateTime ?? a.start.date ?? '').localeCompare(b.start.dateTime ?? b.start.date ?? ''),
        ),
      );
      if (taskPage.status === 'fulfilled') setTasks(taskPage.value);
      setError(
        results.some((result) => result.status === 'rejected') ||
          (local.status === 'fulfilled' && local.value.partial)
          ? 'Some information could not be loaded completely. This is not a complete view of your day.'
          : '',
      );
      setLoading(false);
    };
    void load();
    const timer = setInterval(() => void load(), 60000);
    return () => {
      abort.abort();
      clearInterval(timer);
    };
  }, [zone, revision]);
  return (
    <section className="today-panel">
      {loading && <p role="status">Loading your day…</p>}
      {error && <p role="alert">{error}</p>}
      <div className="today-agenda">
        {items.map((item) => (
          <button
            key={item.id}
            className="agenda-event today-agenda-item"
            data-source={'source' in item ? String(item.source) : 'calendar'}
            onClick={() => open(item)}
          >
            <time>{item.start.dateTime ? formatDate(item.start.dateTime, zone) : 'All day'}</time>
            <strong>{item.summary}</strong>
            <span>
              {'source' in item
                ? String(item.source) + (item.status === 'done' ? ' · Done' : '')
                : 'Google Calendar'}
            </span>
          </button>
        ))}
        {!loading && !items.length && !error && <p>No scheduled items today.</p>}
      </div>
      <h3>Open tasks</h3>
      <p className="muted">Your open tasks, without automatically scheduling them.</p>
      {tasks.items.map((task) => (
        <div className="today-task" key={task.id}>
          <span>{task.title}</span>
          <button
            className="text-button"
            onClick={() =>
              void perform({ kind: 'memory.complete', memoryId: task.id, version: task.version }).catch((e) =>
                setError((e as Error).message),
              )
            }
          >
            Done
          </button>
        </div>
      ))}
      {!loading && !tasks.items.length && !error && <p className="muted">No open tasks.</p>}
      {tasks.next && <p>More tasks are available in Memory.</p>}
    </section>
  );
}
