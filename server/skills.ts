import { readFile } from 'node:fs/promises';
import { groupSchema, type SkillGroup } from '../shared/contracts.js';
export const skillMetadata: Record<SkillGroup, string> = {
  'web-research':
    'Research current information on the public internet, search the web and read public source pages; return cited findings. Read-only, no calendar mutations.',
  'calendar-read': 'Find events, availability and calendar lists without changes.',
  'event-management':
    'Create, update, move or delete explicitly requested calendar events. Ordinary weekday classes and class-timetable corrections belong to program-management, not this capability.',
  'recurring-events': 'Create recurrence rules or change an instance, a series, or following instances.',
  attendees: 'Invite people or respond to invitations; notification consequences.',
  'calendar-management': 'Create, edit, subscribe to or remove calendars.',
  sharing: 'Inspect or change calendar access permissions.',
  'routine-management': 'Create, revise, pause, resume, delete or run scheduled routines.',
  'daily-summary': 'Summarize upcoming appointments and conflicts.',
  preferences: 'Change the user timezone and interaction language.',
  'program-management':
    'Manage weekly/monthly personal schedules and class timetables. A class on a weekday normally belongs here, unless the owner explicitly requests a one-off Google Calendar event. Handle not-calendar-but-my-timetable corrections using earlier owner details. Programs are independent of calendar events and routine execution.',
  'personal-memory':
    'Manage durable owner profile (preferences, priorities, identity, personal boundaries), ideas, purchases, explicit tasks, weekly/monthly reusable programs and shopping lists. Search/read full records before revising. Programs do not create calendar events. Independent reminders belong to reminder-management.',
  conversation:
    'Greetings, ordinary conversation, advice and follow-up discussion without calendar mutations or unsupported tool claims.',
  'reminder-management':
    'Create, list, change, pause, resume or cancel independent one-time reminders and event-linked Telegram reminders. Use this for remind me in five hours; do not turn a reminder into task tracking.',
};
export async function loadSkill(group: SkillGroup, request = '') {
  const name = groupSchema.parse(group);
  let content = await readFile(new URL(`../skills/${name}/SKILL.md`, import.meta.url), 'utf8');
  if (name === 'personal-memory') {
    const reference =
      /aldım|satın|harcadım|ödedim|fiyat|tutar|ücret|\b(?:bought|purchased|paid|spent|price|cost)\b/iu.test(
        request,
      )
        ? 'purchases'
        : /fikir|proje|aklıma|idea/iu.test(request)
          ? 'ideas'
          : 'facts-and-retrieval';
    content +=
      '\n' +
      (await readFile(
        new URL(`../skills/personal-memory/references/${reference}.md`, import.meta.url),
        'utf8',
      ));
  }
  return content;
}
export async function bootstrap() {
  return await readFile(new URL('../skills/BOOTSTRAP.md', import.meta.url), 'utf8');
}
