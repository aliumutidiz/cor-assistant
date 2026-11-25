import { describe, it, expect } from 'vitest';
import {
  eventOnDay,
  eventLanes,
  eventsByDay,
  eventInRange,
  calendarWindow,
  nextCalendarDay,
  calendarDayGroups,
} from '../shared/calendar-layout';
const event = {
  id: 'a',
  calendarId: 'primary',
  summary: 'Gece',
  start: { dateTime: '2026-10-19T23:00:00+03:00' },
  end: { dateTime: '2026-10-20T01:00:00+03:00' },
};
describe('calendar layout', () => {
  it('pins legacy 00:00–23:59 full-day programs without moving ordinary timed entries', () => {
    const day = '2026-11-24';
    const sport = {
      ...event,
      id: 'sport',
      summary: 'Spor',
      start: { dateTime: day + 'T00:00:00+03:00' },
      end: { dateTime: day + 'T23:59:00+03:00' },
    };
    const groups = calendarDayGroups(
      [sport, { ...sport, id: 'shorter', start: { dateTime: day + 'T10:00:00+03:00' } }],
      [day],
      'Europe/Istanbul',
    );
    expect(groups.get(day)!.allDay.map((e) => e.id)).toEqual(['sport']);
    expect(groups.get(day)!.timed.map((e) => e.id)).toEqual(['shorter']);
    expect(sport.end.dateTime).toBe(day + 'T23:59:00+03:00');
  });
  it('keeps full-day timed spans above hours while preserving timed edges and exclusive endings', () => {
    const groups = calendarDayGroups(
      [
        {
          ...event,
          id: 'full',
          start: { dateTime: '2026-10-19T00:00:00+03:00' },
          end: { dateTime: '2026-10-20T00:00:00+03:00' },
        },
        {
          ...event,
          id: 'span',
          start: { dateTime: '2026-10-18T10:00:00+03:00' },
          end: { dateTime: '2026-10-20T10:00:00+03:00' },
        },
        event,
      ],
      ['2026-10-19', '2026-10-20'],
      'Europe/Istanbul',
    );
    expect(groups.get('2026-10-19')!.allDay.map((e) => e.id)).toEqual(['full', 'span']);
    expect(groups.get('2026-10-19')!.timed.map((e) => e.id)).toEqual(['a']);
    expect(groups.get('2026-10-20')!.allDay).toEqual([]);
    expect(groups.get('2026-10-20')!.timed.map((e) => e.id)).toEqual(['span', 'a']);
  });
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
  it('indexes timed and all-day records with the same local boundary semantics, including DST', () => {
    const records = [
      event,
      { ...event, id: 'all', start: { date: '2026-10-24' }, end: { date: '2026-10-26' } },
      {
        ...event,
        id: 'dst',
        start: { dateTime: '2026-10-24T23:30:00Z' },
        end: { dateTime: '2026-10-25T01:30:00Z' },
      },
    ];
    const days = ['2026-10-19', '2026-10-20', '2026-10-24', '2026-10-25', '2026-10-26'];
    for (const zone of ['Europe/Berlin', 'America/New_York', 'Europe/Istanbul']) {
      const indexed = eventsByDay(records, days, zone);
      for (const day of days) {
        expect(indexed.get(day)).toEqual(records.filter((record) => eventOnDay(record, day, zone)));
        const next = new Date(day + 'T12:00Z');
        next.setUTCDate(next.getUTCDate() + 1);
        expect(
          records.filter((record) => eventInRange(record, day, next.toISOString().slice(0, 10), zone)),
        ).toEqual(indexed.get(day));
      }
    }
  });
  it('prefetches the actual next month including edge weeks across year boundaries', () => {
    const day = nextCalendarDay('2026-11-25', 'month', 1);
    expect(day).toBe('2026-12-01');
    expect(calendarWindow(day, 'month')).toMatchObject({
      from: '2026-11-30',
      until: '2027-01-04',
      count: 35,
    });
    expect(calendarWindow(nextCalendarDay(day, 'month', 1), 'month')).toMatchObject({
      from: '2026-12-28',
      until: '2027-02-01',
    });
    expect(calendarWindow('2026-02-01', 'month')).toMatchObject({ from: '2026-01-26', count: 35 });
  });
});
