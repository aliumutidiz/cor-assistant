import { z } from 'zod';

export const reminderInput = z
  .object({
    title: z.string().trim().min(1).max(300),
    message: z.string().trim().min(1).max(2000),
    remindAt: z.iso.datetime({ offset: true }).optional(),
    enabled: z.boolean().default(true),
    event: z
      .object({
        calendarId: z.string().min(1).max(1024),
        eventId: z.string().min(1).max(1024),
        minutesBefore: z.number().int().min(0).max(525600),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine(
    (v) => Boolean(v.event) !== Boolean(v.remindAt),
    'Choose an absolute reminder time or an event link.',
  );
export type ReminderInput = z.infer<typeof reminderInput>;
export type Reminder = Omit<ReminderInput, 'remindAt'> & {
  id: string;
  version: number;
  remindAt: string | null;
  state: 'scheduled' | 'delivered' | 'canceled';
  createdAt: string;
  updatedAt: string;
  deliveredAt?: string;
  lastError?: string;
  checkedAt?: string;
  repeating?: boolean;
};
export const reminderOperation = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('reminder.create'), reminder: reminderInput }).strict(),
  z
    .object({
      kind: z.literal('reminder.update'),
      reminderId: z.uuid(),
      version: z.number().int().positive(),
      reminder: reminderInput,
    })
    .strict(),
  z
    .object({
      kind: z.literal('reminder.cancel'),
      reminderId: z.uuid(),
      version: z.number().int().positive(),
    })
    .strict(),
]);
export type ReminderAction = z.infer<typeof reminderOperation>;
