import { describe, it, expect } from 'vitest';
import { dateKey, zonedISO } from '../src/api.js';
import { localDayRange } from '../shared/time.js';
describe('Turkish date boundaries', () => {
  it('summarizes the entire local day and handles 25-hour DST days', () => {
    expect(localDayRange('Europe/Istanbul', 1, new Date('2026-10-19T21:30:00Z'))).toEqual({
      from: '2026-10-19T21:00:00.000Z',
      to: '2026-10-20T21:00:00.000Z',
    });
    const x = localDayRange('Europe/London', 1, new Date('2026-10-25T12:00:00Z'));
    expect(Date.parse(x.to) - Date.parse(x.from)).toBe(25 * 3600000);
  });
  it('uses the next Istanbul local date after UTC evening', () => {
    expect(dateKey(new Date('2026-10-19T21:30:00Z'), 'Europe/Istanbul')).toBe('2026-10-20');
  });
  it('converts local clock time without browser timezone dependence', () => {
    expect(zonedISO('2026-10-20T14:00', 'Europe/Istanbul')).toBe('2026-10-20T11:00:00.000Z');
  });
  it('refuses nonexistent and repeated DST clock times', () => {
    expect(() => zonedISO('2026-03-29T01:30', 'Europe/London')).toThrow();
    expect(() => zonedISO('2026-10-25T01:30', 'Europe/London')).toThrow();
  });
});
