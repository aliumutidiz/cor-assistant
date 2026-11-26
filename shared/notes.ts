import { z } from 'zod';

/** Links are context, never permissions or instructions. Notes have their own versions. */
export const noteTarget = z.discriminatedUnion('type', [
  z.object({ type: z.literal('workspace') }).strict(),
  z.object({ type: z.literal('day'), day: z.iso.date() }).strict(),
  z
    .object({
      type: z.literal('program'),
      id: z.uuid(),
      entryId: z.uuid().optional(),
      day: z.iso.date().optional(),
    })
    .strict(),
  z.object({ type: z.literal('memory'), id: z.uuid(), entryId: z.uuid().optional() }).strict(),
  z
    .object({
      type: z.literal('event'),
      id: z.string().min(1).max(1024),
      calendarId: z.string().min(1).max(1024),
    })
    .strict(),
  z.object({ type: z.literal('routine'), id: z.uuid() }).strict(),
  z.object({ type: z.literal('reminder'), id: z.uuid() }).strict(),
]);
export type NoteTarget = z.infer<typeof noteTarget>;
export function noteTargetDay(target: NoteTarget | undefined) {
  return target && 'day' in target ? target.day : undefined;
}
export function noteTargetLabel(target: NoteTarget) {
  if (target.type === 'day') return 'Day · ' + target.day;
  if (target.type === 'program')
    return target.day ? 'Occurrence · ' + target.day : target.entryId ? 'Program activity' : 'Program';
  return {
    workspace: 'General note',
    memory: 'Personal record',
    event: 'Calendar event',
    routine: 'Routine',
    reminder: 'Reminder',
  }[target.type];
}
export function sameNoteTarget(a: unknown, b: NoteTarget) {
  const parsed = noteTarget.safeParse(a);
  return parsed.success && JSON.stringify(parsed.data) === JSON.stringify(noteTarget.parse(b));
}
