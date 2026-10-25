import { z } from 'zod';
import { dateKey } from './time.js';

export const scheduleEntry = z
  .object({
    id: z.uuid(),
    title: z.string().trim().min(1).max(200),
    frequency: z.enum(['weekly', 'monthly']),
    days: z.array(z.number().int().min(1).max(31)).min(1).max(31),
    start: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    end: z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/),
    location: z.string().trim().max(300).default(''),
  })
  .strict()
  .superRefine((entry, ctx) => {
    if (entry.end <= entry.start)
      ctx.addIssue({ code: 'custom', message: 'End must follow start on the same local day.' });
    if (
      new Set(entry.days).size !== entry.days.length ||
      (entry.frequency === 'weekly' && entry.days.some((day) => day > 7))
    )
      ctx.addIssue({ code: 'custom', message: 'Use distinct ISO weekdays (1–7) or month days (1–31).' });
  });
export const personalProgram = z
  .object({
    timeZone: z
      .string()
      .max(100)
      .refine((value) => {
        try {
          new Intl.DateTimeFormat('en', { timeZone: value });
          return true;
        } catch {
          return false;
        }
      }),
    enabled: z.boolean().default(true),
    from: z.iso.date().nullable().default(null),
    until: z.iso.date().nullable().default(null),
    excludedDates: z.array(z.iso.date()).max(366).default([]),
    entries: z.array(scheduleEntry).min(1).max(100),
  })
  .strict()
  .superRefine((program, ctx) => {
    if (program.from && program.until && program.until < program.from)
      ctx.addIssue({ code: 'custom', message: 'Program end precedes start.' });
    if (new Set(program.entries.map((entry) => entry.id)).size !== program.entries.length)
      ctx.addIssue({ code: 'custom', message: 'Duplicate entry IDs.' });
  });
export const shoppingItem = z
  .object({
    id: z.uuid(),
    name: z.string().trim().min(1).max(200),
    quantity: z.string().trim().max(60).default(''),
    category: z.string().trim().max(80).default(''),
    note: z.string().trim().max(500).default(''),
    checked: z.boolean().default(false),
  })
  .strict();
export const shoppingList = z
  .object({ items: z.array(shoppingItem).max(200) })
  .strict()
  .refine(
    (list) => new Set(list.items.map((item) => item.id)).size === list.items.length,
    'Duplicate item IDs.',
  );
export const userProfile = z
  .object({
    category: z.enum(['identity', 'preference', 'priority', 'boundary']),
    // Expired preferences remain in the archive but are excluded from automatic context.
    validUntil: z.iso.date().nullable().default(null),
  })
  .strict();
export type PersonalProgram = z.infer<typeof personalProgram>;
export type ShoppingItem = z.infer<typeof shoppingItem>;

// Virtual occurrences are computed locally; no Google event or LLM call is created.
// ISO weekdays use Monday=1. A monthly day missing in a month is skipped.
export function programOccurrences(program: PersonalProgram, from: string, until: string) {
  z.iso.date().parse(from);
  z.iso.date().parse(until);
  const start = Date.parse(from + 'T12:00:00Z'),
    end = Date.parse(until + 'T12:00:00Z');
  if (end < start || end - start > 93 * 86400000)
    throw new Error('Program window must be between 0 and 93 days.');
  const result: {
    entryId: string;
    title: string;
    day: string;
    start: string;
    end: string;
    location: string;
    timeZone: string;
  }[] = [];
  if (!program.enabled) return result;
  for (let time = start; time < end; time += 86400000) {
    const date = new Date(time),
      day = date.toISOString().slice(0, 10);
    if (
      (program.from && day < program.from) ||
      (program.until && day > program.until) ||
      program.excludedDates.includes(day)
    )
      continue;
    for (const entry of program.entries) {
      if (entry.days.includes(entry.frequency === 'weekly' ? date.getUTCDay() || 7 : date.getUTCDate()))
        result.push({
          entryId: entry.id,
          title: entry.title,
          day,
          start: entry.start,
          end: entry.end,
          location: entry.location,
          timeZone: program.timeZone,
        });
    }
  }
  return result.sort((a, b) => (a.day + a.start).localeCompare(b.day + b.start));
}
export function profileIsCurrent(profile: z.infer<typeof userProfile>, timeZone: string, now = new Date()) {
  return !profile.validUntil || profile.validUntil >= dateKey(now, timeZone);
}
