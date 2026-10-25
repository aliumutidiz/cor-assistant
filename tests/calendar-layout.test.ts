import { describe, it, expect } from 'vitest';
import { eventOnDay, eventLanes } from '../shared/calendar-layout';
const event = {
  id: 'a',
  calendarId: 'primary',
  summary: 'Gece',
  start: { dateTime: '2026-10-19T23:00:00+03:00' },
  end: { dateTime: '2026-10-20T01:00:00+03:00' },
};
describe('calendar layout', () => {
  it('shows multi-day events on each overlapping local date', () => {
    expect(eventOnDay(event, '2026-10-19', 'Europe/Istanbul')).toBe(true);
    expect(eventOnDay(event, '2026-10-20', 'Europe/Istanbul')).toBe(true);
    expect(eventOnDay(event, '2026-10-21', 'Europe/Istanbul')).toBe(false);
  });
  it('excludes the final date of all-day spans', () => {
    const e = { ...event, start: { date: '2026-10-19' }, end: { date: '2026-10-21' } };
    expect(eventOnDay(e, '2026-10-20', 'Europe/Istanbul')).toBe(true);
    expect(eventOnDay(e, '2026-10-21', 'Europe/Istanbul')).toBe(false);
  });
  it('places overlapping events in distinct lanes', () => {
    const lanes = eventLanes([
      event,
      { ...event, id: 'b' },
      {
        ...event,
        id: 'c',
        start: { dateTime: '2026-10-21T09:00:00Z' },
        end: { dateTime: '2026-10-21T10:00:00Z' },
      },
    ]);
    expect(lanes.get('a')).toEqual({ lane: 0, columns: 2 });
    expect(lanes.get('b')).toEqual({ lane: 1, columns: 2 });
    expect(lanes.get('c')).toEqual({ lane: 0, columns: 1 });
  });
});
