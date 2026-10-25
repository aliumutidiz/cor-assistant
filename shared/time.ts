export function dateKey(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}
export function localDayRange(timeZone: string, days = 1, now = new Date()) {
  const local = dateKey(now, timeZone);
  const end = new Date(local + 'T12:00:00Z');
  end.setUTCDate(end.getUTCDate() + days);
  return { from: midnight(local, timeZone), to: midnight(end.toISOString().slice(0, 10), timeZone) };
}
export function localDateRange(fromDay: string, toDay: string, timeZone: string) {
  return { from: midnight(fromDay, timeZone), to: midnight(toDay, timeZone) };
}
export function upcomingWeekRange(timeZone: string, now = new Date()) {
  const monday = new Date(dateKey(now, timeZone) + 'T12:00:00Z');
  monday.setUTCDate(monday.getUTCDate() + ((8 - monday.getUTCDay()) % 7 || 7));
  const end = new Date(monday);
  end.setUTCDate(end.getUTCDate() + 7);
  return localDateRange(monday.toISOString().slice(0, 10), end.toISOString().slice(0, 10), timeZone);
}
function midnight(day: string, timeZone: string) {
  const expected = Date.parse(day + 'T00:00:00Z');
  let value = expected;
  for (let i = 0; i < 3; i++) {
    const formatted = new Intl.DateTimeFormat('sv-SE', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23',
    }).format(new Date(value));
    value += expected - Date.parse(formatted.replace(' ', 'T') + 'Z');
  }
  return new Date(value).toISOString();
}
