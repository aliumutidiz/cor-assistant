import { z } from 'zod';
import type { FastifyInstance } from 'fastify';
import type { Store } from './repositories.js';
import { programAvailability } from './program-availability.js';
import { CronExpressionParser } from 'cron-parser';

/** A read-only projection; source records remain authoritative. */
export function plannerRoutes(app: FastifyInstance, store: Store) {
  app.get('/api/planner', async (req) => {
    const { from, to } = z
      .object({ from: z.iso.datetime({ offset: true }), to: z.iso.datetime({ offset: true }) })
      .strict()
      .parse(req.query);
    const programs = await programAvailability(store, from, to);
    const items = programs.occurrences.map((item) => ({
      id: `program:${item.programId}:${item.entryId}:${item.originalDay}`,
      source: 'program',
      sourceId: item.programId,
      entryId: item.entryId,
      originalDay: item.originalDay,
      status: item.status,
      summary: item.title,
      location: item.location,
      start: { dateTime: item.start },
      end: { dateTime: item.end },
      calendarId: 'cor-local',
    }));
    let partial = programs.partial;
    for (const reminder of await store.reminders()) {
      if (
        !reminder.enabled ||
        reminder.state === 'canceled' ||
        !reminder.remindAt ||
        Date.parse(reminder.remindAt) < Date.parse(from) ||
        Date.parse(reminder.remindAt) >= Date.parse(to)
      )
        continue;
      if (items.length >= 1500) {
        partial = true;
        break;
      }
      items.push({
        id: 'reminder:' + reminder.id,
        source: 'reminder',
        sourceId: reminder.id,
        summary: reminder.title,
        location: '',
        start: { dateTime: reminder.remindAt },
        end: { dateTime: new Date(Date.parse(reminder.remindAt) + 60000).toISOString() },
        calendarId: 'cor-local',
        entryId: '',
        originalDay: '',
        status: undefined,
      });
    }
    for (const routine of await store.routines()) {
      if (!routine.enabled) continue;
      if (items.length >= 1500) {
        partial = true;
        break;
      }
      const iterator = CronExpressionParser.parse(routine.cron, {
        tz: routine.timeZone,
        currentDate: new Date(Date.parse(from) - 1),
        endDate: new Date(to),
      });
      while (iterator.hasNext()) {
        const stamp = iterator.next().toISOString()!;
        if (Date.parse(stamp) >= Date.parse(to)) break;
        if (items.length >= 1500) {
          partial = true;
          break;
        }
        items.push({
          id: `routine:${routine.id}:${stamp}`,
          source: 'routine',
          sourceId: routine.id,
          summary: routine.name,
          location: '',
          start: { dateTime: stamp },
          end: { dateTime: new Date(Date.parse(stamp) + 60000).toISOString() },
          calendarId: 'cor-local',
          entryId: '',
          originalDay: '',
          status: undefined,
        });
      }
    }
    return {
      items: items.sort((a, b) => a.start.dateTime.localeCompare(b.start.dateTime)),
      partial,
      unresolved: programs.unresolved,
    };
  });
}
