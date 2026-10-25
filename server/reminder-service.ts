import type { Reminder, ReminderAction } from '../shared/reminders.js';
import { reminderInput } from '../shared/reminders.js';
import type { CalendarEvent, Job } from '../shared/contracts.js';
import type { Store } from './repositories.js';
import { newJob } from './repositories.js';
import type { CalendarGateway } from './google.js';
import { AppError } from './errors.js';
import { localDateRange } from '../shared/time.js';
import { containsCredential } from './sensitive.js';

export class ReminderService {
  private calendarZones = new Map<string, { zone: string; until: number }>();
  constructor(
    private store: Store,
    private calendar: CalendarGateway,
  ) {}
  async execute(action: ReminderAction, operationId: string) {
    const old = action.kind === 'reminder.create' ? undefined : await this.store.reminder(action.reminderId);
    if (action.kind !== 'reminder.create' && (!old || old.version !== action.version))
      throw new AppError(409, 'Hatırlatma sürümü değişmiş. Güncel kaydı yeniden oku.');
    const now = new Date().toISOString();
    if (action.kind === 'reminder.cancel') {
      const record: Reminder = {
        ...old!,
        state: 'canceled',
        enabled: false,
        version: old!.version + 1,
        updatedAt: now,
      };
      await this.store.saveReminder(record, old!.version);
      return record;
    }
    const input = reminderInput.parse(action.reminder);
    if (containsCredential(JSON.stringify(input)))
      throw new AppError(400, 'Bağlantı sırları hatırlatmalara kaydedilemez.');
    const replay = action.kind === 'reminder.create' ? await this.store.reminder(operationId) : undefined;
    if (replay) return replay;
    const record: Reminder = {
      ...input,
      id: old?.id ?? operationId,
      version: (old?.version ?? 0) + 1,
      state: 'scheduled',
      remindAt: input.remindAt ? new Date(input.remindAt).toISOString() : null,
      createdAt: old?.createdAt ?? now,
      updatedAt: now,
    };
    if (record.event) await this.resolve(record);
    if (
      record.enabled &&
      !record.repeating &&
      (!record.remindAt || Date.parse(record.remindAt) <= Date.now())
    )
      throw new AppError(
        400,
        'Hatırlatma gelecekte bir zamana kurulmalı. Daha yakın bir hatırlatma zamanı seç.',
      );
    await this.store.saveReminder(record, old?.version);
    return record;
  }
  private async resolve(record: Reminder) {
    const link = record.event!;
    const event = (await this.calendar.inspect('event', link.calendarId, link.eventId)) as
      CalendarEvent | undefined;
    if (!event || event.status === 'cancelled') throw new AppError(410, 'Bağlı etkinlik silinmiş.');
    let zone = event.start.timeZone;
    if (event.start.date && !zone) {
      const cached = this.calendarZones.get(link.calendarId);
      if (cached && cached.until > Date.now()) zone = cached.zone;
      else {
        const calendars = await this.calendar.calendars();
        zone =
          calendars.find((c) => c.id === link.calendarId || (link.calendarId === 'primary' && c.primary))
            ?.timeZone ??
          (await this.store.get<{ timeZone: string }>('preferences'))?.timeZone ??
          'Europe/Istanbul';
        this.calendarZones.set(link.calendarId, { zone, until: Date.now() + 60000 });
      }
    }
    record.repeating = !!event.recurrence?.length;
    let occurrence = event;
    if (event.recurrence?.length) {
      const instances = await this.calendar.events(
        link.calendarId,
        new Date(Date.now() - 86400000).toISOString(),
        new Date(Date.now() + 93 * 86400000).toISOString(),
      );
      occurrence = instances
        .filter(
          (e) =>
            e.recurringEventId === link.eventId &&
            e.status !== 'cancelled' &&
            Date.parse(this.start(e, zone)) - link.minutesBefore * 60000 >
              Date.parse(record.deliveredAt ?? record.createdAt),
        )
        .sort((a, b) => Date.parse(this.start(a, zone)) - Date.parse(this.start(b, zone)))[0]!;
      if (!occurrence) {
        record.remindAt = null;
        record.checkedAt = new Date().toISOString();
        return;
      }
    }
    record.remindAt = new Date(
      Date.parse(this.start(occurrence, zone)) - link.minutesBefore * 60000,
    ).toISOString();
    record.checkedAt = new Date().toISOString();
    record.lastError = undefined;
  }
  private start(event: CalendarEvent, zone?: string) {
    if (event.start.dateTime) return event.start.dateTime;
    if (event.start.date)
      return localDateRange(
        event.start.date,
        new Date(Date.parse(event.start.date + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10),
        event.start.timeZone ?? zone ?? 'Europe/Istanbul',
      ).from;
    throw new AppError(502, 'Etkinlik başlangıcı doğrulanamadı.');
  }
  async schedule(refreshLinks = true) {
    for (const record of (await this.store.reminders(true)).filter((r) => r.enabled)) {
      try {
        if (
          refreshLinks &&
          record.event &&
          (!record.checkedAt || Date.now() - Date.parse(record.checkedAt) > 60000)
        ) {
          const before = record.remindAt;
          await this.resolve(record);
          const previous = record.version;
          if (before !== record.remindAt) record.version++;
          // A changed deadline invalidates previously enqueued deliveries.
          if (before !== record.remindAt) record.updatedAt = new Date().toISOString();
          await this.store.saveReminder(record, previous);
        }
        if (record.remindAt && Date.parse(record.remindAt) <= Date.now())
          await this.store.enqueue(
            newJob(
              'routine',
              `reminder:${record.id}:${record.version}:${record.remindAt}`,
              { reminder: { id: record.id, version: record.version, remindAt: record.remindAt } },
              record.remindAt,
            ),
          );
      } catch (e) {
        if (e instanceof AppError && e.status === 409) continue;
        const canceled = e instanceof AppError && (e.status === 404 || e.status === 410);
        await this.store
          .saveReminder(
            {
              ...record,
              version: record.version + 1,
              ...(canceled ? { state: 'canceled', enabled: false } : {}),
              lastError: canceled ? 'Bağlı etkinlik silindi.' : 'Etkinlik doğrulanamadı; yeniden denenecek.',
              checkedAt: new Date().toISOString(),
            },
            record.version,
          )
          .catch(() => {});
      }
    }
  }
  async current(payload: NonNullable<Job['payload']['reminder']>) {
    const record = await this.store.reminder(payload.id);
    if (
      !record ||
      !record.enabled ||
      record.state !== 'scheduled' ||
      record.version !== payload.version ||
      record.remindAt !== payload.remindAt
    )
      return undefined;
    if (record.event) {
      try {
        await this.resolve(record);
        if (record.remindAt !== payload.remindAt) {
          await this.store.saveReminder({ ...record, version: record.version + 1 }, record.version);
          return undefined;
        }
      } catch (e) {
        if (e instanceof AppError && (e.status === 404 || e.status === 410)) {
          await this.store.saveReminder(
            { ...record, state: 'canceled', enabled: false, version: record.version + 1 },
            record.version,
          );
          return undefined;
        }
        throw e;
      }
    }
    return record;
  }
  async delivered(payload: NonNullable<Job['payload']['reminder']>, repeating?: boolean) {
    const record = await this.store.reminder(payload.id);
    if (!record || record.version !== payload.version || record.state !== 'scheduled') return;
    // Series occurrences are advanced by the next scheduler pass; single reminders finish here.
    const recurring = repeating ?? record.repeating;
    await this.store.saveReminder(
      {
        ...record,
        version: record.version + 1,
        state: recurring ? 'scheduled' : 'delivered',
        ...(recurring ? { checkedAt: undefined, remindAt: null } : {}),
        deliveredAt: new Date().toISOString(),
      },
      record.version,
    );
  }
}
