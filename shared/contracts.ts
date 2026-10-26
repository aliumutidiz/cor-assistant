import { replyLanguage } from './languages.js';
import { z } from 'zod';
import { memoryOperation, memoryKind } from './memory.js';
import { reminderOperation } from './reminders.js';

export const timezone = z
  .string()
  .max(100)
  .refine((v) => {
    try {
      new Intl.DateTimeFormat('en', { timeZone: v });
      return true;
    } catch {
      return false;
    }
  }, 'Invalid IANA timezone');
const id = z.string().min(1).max(1024);
const stamp = z
  .object({
    dateTime: z.iso.datetime({ offset: true }).optional(),
    date: z.iso.date().optional(),
    timeZone: timezone.optional(),
  })
  .strict()
  .refine((v) => Boolean(v.dateTime) !== Boolean(v.date), 'Choose date or dateTime');
export const eventSchema = z
  .object({
    summary: z.string().trim().min(1).max(500),
    description: z.string().max(10000).optional(),
    location: z.string().max(1000).optional(),
    start: stamp,
    end: stamp,
    attendees: z
      .array(
        z
          .object({
            email: z.email(),
            responseStatus: z.enum(['needsAction', 'declined', 'tentative', 'accepted']).optional(),
          })
          .strict(),
      )
      .max(100)
      .optional(),
    recurrence: z
      .array(
        z
          .string()
          .max(1000)
          .regex(/^(RRULE|RDATE|EXDATE):/),
      )
      .max(20)
      .optional(),
    reminders: z
      .object({
        useDefault: z.boolean(),
        overrides: z
          .array(
            z
              .object({ method: z.enum(['email', 'popup']), minutes: z.number().int().min(0).max(40320) })
              .strict(),
          )
          .max(5)
          .optional(),
      })
      .strict()
      .optional(),
    colorId: z
      .string()
      .regex(/^\d{1,2}$/)
      .optional(),
    visibility: z.enum(['default', 'public', 'private', 'confidential']).optional(),
    transparency: z.enum(['opaque', 'transparent']).optional(),
    guestsCanModify: z.boolean().optional(),
    guestsCanInviteOthers: z.boolean().optional(),
    guestsCanSeeOtherGuests: z.boolean().optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (
      Boolean(v.start.date) !== Boolean(v.end.date) ||
      Date.parse(v.end.dateTime ?? v.end.date!) <= Date.parse(v.start.dateTime ?? v.start.date!)
    )
      ctx.addIssue({ code: 'custom', message: 'End must follow start and use the same date type' });
    if (v.recurrence?.length && !v.start.timeZone)
      ctx.addIssue({ code: 'custom', message: 'Recurring events require an explicit timezone' });
  });
export type CalendarEvent = z.infer<typeof eventSchema> & {
  id: string;
  etag?: string;
  calendarId: string;
  recurringEventId?: string;
  originalStartTime?: { dateTime?: string; date?: string };
  status?: string;
  htmlLink?: string;
};
export const routineInput = z
  .object({
    name: z.string().trim().min(1).max(160),
    cron: z.string().min(9).max(100),
    timeZone: timezone.default('Europe/Istanbul'),
    kind: z.enum([
      'daily_summary',
      'weekly_summary',
      'conflict_check',
      'upcoming_check',
      'reminder',
      'ai_daily_summary',
      'ai_weekly_summary',
    ]),
    message: z.string().trim().min(1).max(1000).optional(),
    enabled: z.boolean().default(false),
  })
  .strict();
export type RoutineInput = z.infer<typeof routineInput>;
export type Routine = RoutineInput & { id: string; version: number; nextRun: string; updatedAt: string };
const eventOperation = z
  .object({
    kind: z.enum(['event.create', 'event.update', 'event.delete', 'event.respond', 'event.move']),
    calendarId: id,
    eventId: id.optional(),
    etag: z.string().max(200).optional(),
    event: eventSchema.optional(),
    scope: z.enum(['single', 'series', 'following']).default('single'),
    instanceStart: z.iso.datetime({ offset: true }).optional(),
    destination: id.optional(),
    response: z.enum(['accepted', 'declined', 'tentative']).optional(),
    notify: z.boolean().default(false),
    conference: z.boolean().default(false),
    telegramReminderMinutes: z.number().int().min(0).max(525600).nullable().optional(),
  })
  .strict();
const calendarOperation = z
  .object({
    kind: z.enum([
      'calendar.create',
      'calendar.update',
      'calendar.delete',
      'calendar.clear',
      'calendar.subscribe',
      'calendar.unsubscribe',
    ]),
    calendarId: id.optional(),
    etag: z.string().max(200).optional(),
    summary: z.string().min(1).max(300).optional(),
    description: z.string().max(2000).optional(),
    timeZone: timezone.optional(),
  })
  .strict();
const sharingOperation = z
  .object({
    kind: z.enum(['sharing.set', 'sharing.delete']),
    calendarId: id,
    ruleId: id.optional(),
    etag: z.string().max(200).optional(),
    email: z.email().optional(),
    scopeType: z.enum(['user', 'group', 'domain', 'default']).default('user'),
    domain: z
      .string()
      .regex(/^[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/)
      .optional(),
    role: z.enum(['reader', 'writer', 'freeBusyReader', 'owner']).optional(),
  })
  .strict();
const routineOperation = z
  .object({
    kind: z.enum(['routine.create', 'routine.update', 'routine.delete', 'routine.run']),
    routineId: z.uuid().optional(),
    version: z.number().int().positive().optional(),
    routine: routineInput.optional(),
  })
  .strict();
const preferenceOperation = z
  .object({
    kind: z.literal('preferences.update'),
    timeZone: timezone,
    language: replyLanguage.optional(),
    displayName: z.string().trim().max(80).optional(),
    communicationStyle: z.enum(['concise', 'balanced', 'detailed']).optional(),
    onboarded: z.boolean().optional(),
  })
  .strict();
export const operationSchema = z.union([
  eventOperation,
  calendarOperation,
  sharingOperation,
  routineOperation,
  preferenceOperation,
  memoryOperation,
  reminderOperation,
]);
export type OperationInput = z.input<typeof operationSchema>;
export type Action = z.infer<typeof operationSchema>;
export type Operation = {
  id: string;
  key: string;
  hash: string;
  action: Action;
  status: 'awaiting_approval' | 'queued' | 'running' | 'succeeded' | 'failed' | 'unknown' | 'canceled';
  risk: 'normal' | 'high';
  createdAt: string;
  updatedAt: string;
  expiresAt: string;
  result?: unknown;
  error?: string;
  preview?: { title: string; body: string; kind: string };
};
export type TelegramEntity = {
  type: 'bold' | 'italic' | 'strikethrough' | 'code' | 'pre' | 'text_link';
  offset: number;
  length: number;
  url?: string;
};
export type Job = {
  id: string;
  key: string;
  kind: 'routine' | 'ai_report' | 'operation' | 'telegram_incoming' | 'telegram_outgoing' | 'assistant';
  payload: {
    chatRequest?: { id: string; message: string };
    operationId?: string;
    routine?: Routine;
    taskReminder?: { memoryId: string; remindAt: string };
    reminder?: { id: string; version: number; remindAt: string };
    telegram?: {
      chatId?: number;
      update?: unknown;
      text?: string;
      entities?: TelegramEntity[];
      keyboard?: unknown;
      attempts?: number;
    };
  };
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'unknown';
  scheduledAt: string;
  startedAt?: string;
  finishedAt?: string;
  result?: unknown;
  error?: string;
};
export type Calendar = {
  id: string;
  summary: string;
  primary?: boolean;
  accessRole?: string;
  timeZone?: string;
};
export const groupSchema = z.enum([
  'calendar-read',
  'event-management',
  'recurring-events',
  'attendees',
  'calendar-management',
  'sharing',
  'routine-management',
  'daily-summary',
  'preferences',
  'personal-memory',
  'program-management',
  'conversation',
  'reminder-management',
  'web-research',
]);
export type SkillGroup = z.infer<typeof groupSchema>;
export const assistantResponse = z
  .object({
    message: z.string().max(12000),
    action: operationSchema.nullable(),
    read: z
      .object({
        kind: z.enum([
          'events',
          'calendars',
          'sharing',
          'freebusy',
          'event',
          'calendar',
          'instances',
          'settings',
          'colors',
          'memories',
          'reminders',
          'routines',
          'web-search',
          'web-page',
          'program-occurrences',
        ]),
        calendarId: id.optional(),
        eventId: id.optional(),
        from: z.iso.datetime({ offset: true }).optional(),
        to: z.iso.datetime({ offset: true }).optional(),
        query: z.string().trim().max(200).optional(),
        memoryKind: memoryKind.optional(),
        taskState: z.enum(['open', 'done']).optional(),
        memoryId: z.uuid().optional(),
        reminderId: z.uuid().optional(),
        routineId: z.uuid().optional(),
        url: z.url().max(2048).optional(),
        archived: z.boolean().optional(),
      })
      .strict()
      .nullable(),
  })
  .strict();
