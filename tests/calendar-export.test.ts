import { describe, it, expect } from 'vitest';
import { exportCalendar } from '../shared/calendar-export';
describe('calendar export', () => {
  it('preserves exclusive all-day ends and escapes content without injecting properties', () => {
    const value = exportCalendar([
      {
        id: 'one',
        calendarId: 'primary',
        summary: 'Plan, deneme\r\nBEGIN:VEVENT',
        start: { date: '2027-03-14' },
        end: { date: '2027-03-16' },
        description: 'Not; ikinci\\satır',
      },
    ]);
    expect(value).toContain('DTEND;VALUE=DATE:20270316\r\n');
    expect(value).toContain('SUMMARY:Plan\\, deneme\\nBEGIN:VEVENT');
    expect(value.match(/\r\nBEGIN:VEVENT/g)).toHaveLength(1);
  });
  it('writes UTC timestamps and folds Turkish text without breaking multibyte characters', () => {
    const value = exportCalendar([
      {
        id: 'two',
        calendarId: 'primary',
        summary: 'İstanbul görüşmesi '.repeat(20),
        start: { dateTime: '2027-03-14T10:00:00+03:00' },
        end: { dateTime: '2027-03-14T11:00:00+03:00' },
      },
    ]);
    expect(value).toContain('DTSTART:20270314T070000Z');
    for (const line of value.split('\r\n'))
      expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75);
    expect(value).not.toContain('\uFFFD');
  });
});
