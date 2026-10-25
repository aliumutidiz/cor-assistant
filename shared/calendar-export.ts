import type { CalendarEvent } from './contracts';

const text = (value: string) =>
  value
    .replaceAll('\\', '\\\\')
    .replace(/\r\n|\r|\n/g, '\\n')
    .replaceAll(';', '\\;')
    .replaceAll(',', '\\,');
const utc = (value: string) =>
  new Date(value)
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
function fold(line: string) {
  const encoder = new TextEncoder();
  let current = '',
    size = 0;
  const lines: string[] = [];
  for (const character of line) {
    const bytes = encoder.encode(character).length;
    if (size + bytes > 75) {
      lines.push(current);
      current = ' ';
      size = 1;
    }
    current += character;
    size += bytes;
  }
  lines.push(current);
  return lines.join('\r\n');
}
/** Exports the fetched occurrences, not an unbounded recurrence series. */
export function exportCalendar(events: CalendarEvent[], now = new Date()) {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//COR//Personal Calendar//TR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
  ];
  for (const event of events.filter((e) => e.status !== 'cancelled')) {
    lines.push(
      'BEGIN:VEVENT',
      'UID:' + encodeURIComponent(event.calendarId + ':' + event.id) + '@cor.local',
      'DTSTAMP:' + utc(now.toISOString()),
    );
    lines.push(
      event.start.date
        ? 'DTSTART;VALUE=DATE:' + event.start.date.replaceAll('-', '')
        : 'DTSTART:' + utc(event.start.dateTime!),
    );
    lines.push(
      event.end.date
        ? 'DTEND;VALUE=DATE:' + event.end.date.replaceAll('-', '')
        : 'DTEND:' + utc(event.end.dateTime!),
    );
    lines.push('SUMMARY:' + text(event.summary));
    if (event.description) lines.push('DESCRIPTION:' + text(event.description));
    if (event.location) lines.push('LOCATION:' + text(event.location));
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
