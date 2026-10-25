import { dateKey, localDateRange } from '../shared/time.js';
import type { CalendarEvent } from '../shared/contracts.js';

// Fully anchored, read-only vocabulary. Extra instructions or ambiguous dates
// always fall through to normal skill orchestration; prose never authorizes writes.
export function calendarQuestion(message: string, timeZone: string, now = new Date()) {
  const normalized = message.trim().toLocaleLowerCase('tr').replace(/\s+/g, ' ');
  const match =
    /^(bugün|yarın|bu hafta)(?: takvimimde)? (?:neler var|ne var|hangi etkinlikler var)[?!.]*$/u.exec(
      normalized,
    );
  if (!match) return;
  const start = new Date(dateKey(now, timeZone) + 'T12:00:00Z');
  if (match[1] === 'yarın') start.setUTCDate(start.getUTCDate() + 1);
  if (match[1] === 'bu hafta') start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + (match[1] === 'bu hafta' ? 7 : 1));
  return {
    ...localDateRange(start.toISOString().slice(0, 10), end.toISOString().slice(0, 10), timeZone),
    label: match[1] === 'bugün' ? 'Bugün' : match[1] === 'yarın' ? 'Yarın' : 'Bu hafta',
  };
}

export function calendarAnswer(events: CalendarEvent[], label: string, timeZone: string) {
  const visible = events
    .filter((e) => e.status !== 'cancelled')
    .sort(
      (a, b) => Date.parse(a.start.dateTime ?? a.start.date!) - Date.parse(b.start.dateTime ?? b.start.date!),
    );
  const header = `**Ana takvim · ${label}**`;
  if (!visible.length) return header + '\n\nBu tarih aralığında kayıtlı etkinlik bulunmuyor.';
  const date = new Intl.DateTimeFormat('tr-TR', {
    timeZone,
    day: 'numeric',
    month: 'long',
    weekday: 'short',
  });
  const time = new Intl.DateTimeFormat('tr-TR', { timeZone, hour: '2-digit', minute: '2-digit' });
  const lines = visible.slice(0, 20).map((e) => {
    const title = (e.summary || 'Başlıksız etkinlik').slice(0, 200).replace(/([\\`*_[\]<>])/g, '\\$1');
    const when = e.start.dateTime
      ? date.format(new Date(e.start.dateTime)) +
        ' · ' +
        time.format(new Date(e.start.dateTime)) +
        (e.end.dateTime
          ? ' – ' +
            (dateKey(new Date(e.end.dateTime), timeZone) !== dateKey(new Date(e.start.dateTime), timeZone)
              ? date.format(new Date(e.end.dateTime)) + ' · '
              : '') +
            time.format(new Date(e.end.dateTime))
          : '')
      : e.start.date + ' · tüm gün';
    return `- **${when}** — ${title}`;
  });
  return (
    header +
    '\n\n' +
    lines.join('\n') +
    (visible.length > 20
      ? `\n\n${visible.length - 20} etkinlik daha var. Tümünü takvim ekranında görebilirsin.`
      : '')
  );
}
