import { baseLanguage } from '../shared/languages.js';
import { dateKey, localDateRange } from '../shared/time.js';
import type { CalendarEvent } from '../shared/contracts.js';

// Fully anchored, read-only vocabulary. Extra instructions or ambiguous dates
// always fall through to normal skill orchestration; prose never authorizes writes.
export function calendarQuestion(message: string, timeZone: string, now = new Date()) {
  const normalized = message.trim().toLocaleLowerCase('tr').replace(/\s+/g, ' ');
  const english = /^(?:what(?:'s| is) on my calendar|what do i have) (today|tomorrow|this week)[?!.]*$/u.exec(
    message.trim().toLowerCase().replace(/\s+/g, ' '),
  );
  const match =
    /^(bugün|yarın|bu hafta)(?: takvimimde)? (?:neler var|ne var|hangi etkinlikler var)[?!.]*$/u.exec(
      normalized,
    );
  if (!match && !english) return;
  const period = match?.[1] ?? { today: 'bugün', tomorrow: 'yarın', 'this week': 'bu hafta' }[english![1]]!;
  const start = new Date(dateKey(now, timeZone) + 'T12:00:00Z');
  if (period === 'yarın') start.setUTCDate(start.getUTCDate() + 1);
  if (period === 'bu hafta') start.setUTCDate(start.getUTCDate() - ((start.getUTCDay() + 6) % 7));
  const end = new Date(start);
  end.setUTCDate(end.getUTCDate() + (period === 'bu hafta' ? 7 : 1));
  return {
    ...localDateRange(start.toISOString().slice(0, 10), end.toISOString().slice(0, 10), timeZone),
    label: period === 'bugün' ? 'Bugün' : period === 'yarın' ? 'Yarın' : 'Bu hafta',
  };
}

export function calendarAnswer(events: CalendarEvent[], label: string, timeZone: string, language = 'tr') {
  const tr = baseLanguage(language) === 'tr';
  const locale = tr ? 'tr-TR' : language;
  const period = tr
    ? label
    : ({ Bugün: 'Today', Yarın: 'Tomorrow', 'Bu hafta': 'This week' }[label] ?? label);
  const visible = events
    .filter((e) => e.status !== 'cancelled')
    .sort(
      (a, b) => Date.parse(a.start.dateTime ?? a.start.date!) - Date.parse(b.start.dateTime ?? b.start.date!),
    );
  const header = `**${tr ? 'Ana takvim' : 'Primary calendar'} · ${period}**`;
  if (!visible.length)
    return (
      header +
      (tr
        ? '\n\nBu tarih aralığında kayıtlı etkinlik bulunmuyor.'
        : '\n\nNo events are recorded in this period.')
    );
  const date = new Intl.DateTimeFormat(locale, {
    timeZone,
    day: 'numeric',
    month: 'long',
    weekday: 'short',
  });
  const time = new Intl.DateTimeFormat(locale, { timeZone, hour: '2-digit', minute: '2-digit' });
  const lines = visible.slice(0, 20).map((e) => {
    const title = (e.summary || (tr ? 'Başlıksız etkinlik' : 'Untitled event'))
      .slice(0, 200)
      .replace(/([\\`*_[\]<>])/g, '\\$1');
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
      : e.start.date + (tr ? ' · tüm gün' : ' · all day');
    return `- **${when}** — ${title}`;
  });
  return (
    header +
    '\n\n' +
    lines.join('\n') +
    (visible.length > 20
      ? tr
        ? `\n\n${visible.length - 20} etkinlik daha var. Tümünü takvim ekranında görebilirsin.`
        : `\n\n${visible.length - 20} more events. View all in Calendar.`
      : '')
  );
}
