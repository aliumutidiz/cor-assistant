import type { Store } from './repositories.js';
import { memorySearch } from '../shared/memory.js';
import { programOccurrences } from '../shared/personal-resources.js';
import { dateKey } from '../shared/time.js';
import { AppError } from './errors.js';
/** Resolve local schedule times conservatively across DST folds; never shift a missing time. */
function instants(local: string, zone: string) {
  const target = Date.parse(local + 'Z');
  let guess = target;
  const show = (value: number) =>
    new Intl.DateTimeFormat('sv-SE', {
      timeZone: zone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .format(new Date(value))
      .replace(' ', 'T');
  for (let i = 0; i < 4; i++) guess += target - Date.parse(show(guess) + 'Z');
  const candidates = new Set<number>();
  for (const minutes of [-120, -90, -60, -30, 0, 30, 60, 90, 120]) {
    const value = guess + minutes * 60000;
    if (show(value) === local) candidates.add(value);
  }
  return [...candidates].sort((a, b) => a - b);
}
export async function programAvailability(store: Store, from: string, to: string) {
  const start = Date.parse(from),
    end = Date.parse(to);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || end - start > 93 * 86400000)
    throw new AppError(400, 'Availability requires a valid interval of up to 93 days.');
  const occurrences: {
    programId: string;
    entryId: string;
    program: string;
    title: string;
    start: string;
    end: string;
    location: string;
    timeZone: string;
    blocksTime: boolean;
    ambiguous: boolean;
  }[] = [];
  let before: string | undefined,
    partial = false,
    scanned = 0,
    unresolved = 0;
  outer: do {
    const page = await store.memories(memorySearch.parse({ kind: 'program', limit: 50, before }));
    for (const record of page.items) {
      if (++scanned > 100) {
        partial = true;
        break outer;
      }
      const program = record.program;
      if (!program?.enabled) continue;
      const first = dateKey(new Date(start), program.timeZone),
        last = dateKey(new Date(end - 1), program.timeZone);
      const until = new Date(Date.parse(last + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10);
      for (let cursor = first; cursor < until;) {
        const chunk = new Date(
          Math.min(Date.parse(cursor + 'T12:00:00Z') + 93 * 86400000, Date.parse(until + 'T12:00:00Z')),
        )
          .toISOString()
          .slice(0, 10);
        for (const item of programOccurrences(program, cursor, chunk)) {
          const starts = instants(item.day + 'T' + item.start, item.timeZone),
            ends = instants(item.day + 'T' + item.end, item.timeZone);
          if (!starts.length || !ends.length) {
            unresolved++;
            partial = true;
            continue;
          }
          const a = starts[0],
            b = ends[ends.length - 1];
          if (a >= end || b <= start) continue;
          if (occurrences.length >= 500) {
            partial = true;
            break outer;
          }
          occurrences.push({
            programId: record.id,
            entryId: item.entryId,
            program: record.title,
            title: item.title,
            start: new Date(a).toISOString(),
            end: new Date(b).toISOString(),
            location: item.location,
            timeZone: item.timeZone,
            blocksTime: program.blocksTime !== false,
            ambiguous: starts.length > 1 || ends.length > 1,
          });
        }
        cursor = chunk;
      }
    }
    before = page.next;
  } while (before);
  occurrences.sort((a, b) => a.start.localeCompare(b.start));
  return {
    from,
    to,
    occurrences,
    partial,
    unresolved,
    source: 'personal-programs',
    policy:
      'Combine with calendar events for availability. Only blocksTime=true occupies time. Partial/unresolved results cannot prove that the owner is free. These are virtual occurrences, not Google events.',
  };
}
export function programDayMessage(
  result: Awaited<ReturnType<typeof programAvailability>>,
  language: string,
  zone: string,
) {
  const tr = language.toLowerCase().startsWith('tr');
  if (!result.occurrences.length && !result.partial) return '';
  const date = new Intl.DateTimeFormat(tr ? 'tr-TR' : 'en-GB', {
    timeZone: zone,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  const escape = (text: string) => text.replace(/([\\`*_[\]<>])/g, '\\$1');
  return (
    '\n\n**' +
    (tr ? 'Programlar' : 'Personal programs') +
    '**\n' +
    result.occurrences
      .slice(0, 20)
      .map(
        (item) =>
          '- ' +
          date.format(new Date(item.start)) +
          ' – ' +
          new Intl.DateTimeFormat(tr ? 'tr-TR' : 'en-GB', {
            timeZone: zone,
            hour: '2-digit',
            minute: '2-digit',
          }).format(new Date(item.end)) +
          ' · ' +
          escape(item.title) +
          (item.blocksTime ? '' : tr ? ' (müsaitliği etkilemez)' : ' (does not block time)'),
      )
      .join('\n') +
    (result.partial || result.occurrences.length > 20
      ? '\n' +
        (tr
          ? 'Program listesi kısmi; müsaitlik kesin olarak doğrulanamadı.'
          : 'Program results are partial; availability is not fully verified.')
      : '')
  );
}
