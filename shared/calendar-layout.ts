import type { CalendarEvent } from './contracts';
import { dateKey, localDateRange } from './time';
/** Presentation only: whole-day timed records belong above the hours too. */
export function calendarDayGroups(events: CalendarEvent[], days: string[], zone: string) {
  const byDay = eventsByDay(events, days, zone);
  return new Map(
    days.map((day) => {
      const next = new Date(day + 'T12:00:00Z');
      next.setUTCDate(next.getUTCDate() + 1);
      const bounds = localDateRange(day, next.toISOString().slice(0, 10), zone);
      const start = Date.parse(bounds.from);
      const end = Date.parse(bounds.to);
      const allDay: CalendarEvent[] = [],
        timed: CalendarEvent[] = [];
      for (const event of byDay.get(day) ?? []) {
        const coversDay =
          Boolean(event.start.date) ||
          // Legacy programs represent an entire day as 00:00–23:59 because
          // their time contract does not accept 24:00. Keep source times intact.
          (Date.parse(event.start.dateTime!) <= start && Date.parse(event.end.dateTime!) >= end - 60000);
        (coversDay ? allDay : timed).push(event);
      }
      return [day, { allDay, timed }] as const;
    }),
  );
}
export function eventOnDay(event: CalendarEvent, day: string, zone: string) {
  const start = event.start.date ?? dateKey(new Date(event.start.dateTime!), zone);
  if (event.end.date) return day >= start && day < event.end.date;
  const end = dateKey(new Date(Date.parse(event.end.dateTime!) - 1), zone);
  return day >= start && day <= end;
}
/** Half-open visible date range, preserving all-day exclusivity and local midnight boundaries. */
export function eventInRange(event: CalendarEvent, from: string, until: string, zone: string) {
  const start = event.start.date ?? dateKey(new Date(event.start.dateTime!), zone);
  const last = event.end.date ?? dateKey(new Date(Date.parse(event.end.dateTime!) - 1), zone);
  return start < until && (event.end.date ? last > from : last >= from);
}
/** Convert each event's local boundaries once, rather than once per visible cell. */
export function eventsByDay(events: CalendarEvent[], days: string[], zone: string) {
  const result = new Map(days.map((day) => [day, [] as CalendarEvent[]]));
  for (const event of events) {
    const start = event.start.date ?? dateKey(new Date(event.start.dateTime!), zone);
    const last = event.end.date ?? dateKey(new Date(Date.parse(event.end.dateTime!) - 1), zone);
    for (const day of days) {
      if (day >= start && (event.end.date ? day < last : day <= last)) result.get(day)!.push(event);
    }
  }
  return result;
}
export type CalendarView = 'day' | 'week' | 'month' | 'agenda';
/** A civil-date range; navigation never relies on fixed millisecond month lengths. */
export function calendarWindow(day: string, view: CalendarView) {
  const anchor = new Date(day + 'T12:00:00Z');
  const first = new Date(anchor);
  let count = view === 'day' ? 1 : 7;
  if (view === 'month') {
    first.setUTCDate(1);
    const offset = (first.getUTCDay() + 6) % 7;
    const length = new Date(Date.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth() + 1, 0)).getUTCDate();
    count = Math.ceil((offset + length) / 7) * 7;
    first.setUTCDate(1 - offset);
  } else if (view !== 'day') first.setUTCDate(first.getUTCDate() - ((first.getUTCDay() + 6) % 7));
  const end = new Date(first);
  end.setUTCDate(end.getUTCDate() + count);
  return { anchor, count, from: first.toISOString().slice(0, 10), until: end.toISOString().slice(0, 10) };
}
export function nextCalendarDay(day: string, view: CalendarView, direction: number) {
  const next = new Date(day + 'T12:00:00Z');
  if (view === 'month') {
    next.setUTCDate(1);
    next.setUTCMonth(next.getUTCMonth() + direction);
  } else next.setUTCDate(next.getUTCDate() + direction * (view === 'day' ? 1 : 7));
  return next.toISOString().slice(0, 10);
}
export function eventLanes(events: CalendarEvent[]) {
  const sorted = [...events].sort(
    (a, b) => Date.parse(a.start.dateTime ?? a.start.date!) - Date.parse(b.start.dateTime ?? b.start.date!),
  );
  const result = new Map<string, { lane: number; columns: number }>();
  let group: { event: CalendarEvent; lane: number }[] = [],
    ends: number[] = [],
    groupEnd = 0;
  const finish = () => {
    for (const x of group) result.set(x.event.id, { lane: x.lane, columns: ends.length });
    group = [];
    ends = [];
  };
  for (const event of sorted) {
    const start = Date.parse(event.start.dateTime ?? event.start.date!),
      end = Date.parse(event.end.dateTime ?? event.end.date!);
    if (group.length && start >= groupEnd) finish();
    let lane = ends.findIndex((x) => x <= start);
    if (lane < 0) lane = ends.length;
    ends[lane] = end;
    group.push({ event, lane });
    groupEnd = Math.max(group.length === 1 ? 0 : groupEnd, end);
  }
  finish();
  return result;
}
