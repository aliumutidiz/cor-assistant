import type { CalendarEvent } from './contracts';
import { dateKey } from './time';
export function eventOnDay(event: CalendarEvent, day: string, zone: string) {
  const start = event.start.date ?? dateKey(new Date(event.start.dateTime!), zone);
  if (event.end.date) return day >= start && day < event.end.date;
  const end = dateKey(new Date(Date.parse(event.end.dateTime!) - 1), zone);
  return day >= start && day <= end;
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
