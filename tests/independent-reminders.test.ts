import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryStore } from '../server/repositories';
import { DemoCalendar } from '../server/google';
import { OperationService, RoutineService, WorkerService, validateAction } from '../server/services';
import { TelegramService, type TelegramTransport } from '../server/telegram';
import { loadConfig } from '../server/config';
import { AssistantService } from '../server/provider';
import { AppError } from '../server/errors';
import type { CalendarEvent } from '../shared/contracts';

function setup() {
  const store = new MemoryStore(),
    calendar = new DemoCalendar(),
    routines = new RoutineService(store),
    operations = new OperationService(store, calendar, routines);
  const worker = new WorkerService(store, calendar, routines, operations);
  void store.set('telegram.startedAt', new Date().toISOString());
  const transport = { call: vi.fn<TelegramTransport['call']>().mockResolvedValue({}), download: vi.fn() };
  const config = { ...loadConfig({ NODE_ENV: 'test', TELEGRAM_OWNER_ID: '42' }), TELEGRAM_ENABLED: true };
  const telegram = new TelegramService(
    config,
    store,
    transport as TelegramTransport,
    { transcribe: vi.fn() } as never,
    { chat: vi.fn() },
    operations,
  );
  return { store, calendar, routines, operations, worker, transport, telegram };
}
const input = {
  title: 'Çamaşırlar',
  message: 'Çamaşırları çıkar.',
  remindAt: '2026-10-23T17:00:00+03:00',
  enabled: true,
};
async function create(h: ReturnType<typeof setup>) {
  const op = await h.operations.submit({ kind: 'reminder.create', reminder: input }, 'create');
  await h.worker.tick();
  return op;
}
beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-23T09:00:00Z'));
});
afterEach(() => vi.useRealTimers());
describe('independent Telegram reminders', () => {
  it('survives worker replacement, catches up after downtime and sends once without calendar or LLM', async () => {
    const h = setup();
    const read = vi.spyOn(h.calendar, 'inspect');
    const op = await create(h);
    expect((await h.store.reminder(op.id))?.remindAt).toBe('2026-10-23T14:00:00.000Z');
    vi.setSystemTime(new Date('2026-10-23T15:00:00Z'));
    const replacement = new WorkerService(h.store, h.calendar, h.routines, h.operations);
    await replacement.tick();
    await h.telegram.collectNotifications();
    await h.telegram.dispatch();
    expect(h.transport.call).toHaveBeenCalledTimes(1);
    expect((await h.store.reminder(op.id))?.state).toBe('delivered');
    await replacement.tick();
    await h.telegram.collectNotifications();
    await h.telegram.dispatch();
    expect(h.transport.call).toHaveBeenCalledTimes(1);
    expect(read).not.toHaveBeenCalled();
  });
  it('cancels an already prepared outbox message and rejects stale versions', async () => {
    const h = setup();
    const op = await create(h);
    vi.setSystemTime(new Date(input.remindAt));
    await h.worker.tick();
    await h.telegram.collectNotifications();
    const cancel = await h.operations.submit(
      { kind: 'reminder.cancel', reminderId: op.id, version: 1 },
      'cancel',
    );
    await h.operations.execute(cancel.id);
    await h.telegram.dispatch();
    expect(h.transport.call).not.toHaveBeenCalled();
    await expect(
      h.operations.submit({ kind: 'reminder.cancel', reminderId: op.id, version: 1 }, 'stale'),
    ).rejects.toMatchObject({ status: 409 });
  });
  it('rescheduling invalidates old delivery and pausing does not delete the reminder', async () => {
    const h = setup();
    const op = await create(h);
    vi.setSystemTime(new Date(input.remindAt));
    await h.worker.tick();
    await h.telegram.collectNotifications();
    const update = await h.operations.submit(
      {
        kind: 'reminder.update',
        reminderId: op.id,
        version: 1,
        reminder: { ...input, remindAt: '2026-10-23T20:00:00+03:00', enabled: false },
      },
      'pause',
    );
    await h.operations.execute(update.id);
    await h.telegram.dispatch();
    expect(h.transport.call).not.toHaveBeenCalled();
    expect(await h.store.reminder(op.id)).toMatchObject({ state: 'scheduled', enabled: false, version: 2 });
  });
  it('rejects past dates and mixed absolute/event deadlines', async () => {
    const h = setup();
    const op = await h.operations.submit(
      { kind: 'reminder.create', reminder: { ...input, remindAt: '2026-10-22T10:00:00Z' } },
      'past',
    );
    await expect(h.operations.execute(op.id)).rejects.toMatchObject({ status: 400 });
    expect(() =>
      validateAction({
        kind: 'reminder.create',
        reminder: { ...input, event: { calendarId: 'primary', eventId: 'event', minutesBefore: 60 } },
      }),
    ).toThrow();
  });
  it('creates a linked alert in the same event operation and follows external moves in time', async () => {
    const h = setup();
    const op = await h.operations.submit(
      {
        kind: 'event.create',
        calendarId: 'primary',
        event: {
          summary: 'Toplantı',
          start: { dateTime: '2026-10-24T15:00:00+03:00' },
          end: { dateTime: '2026-10-24T16:00:00+03:00' },
        },
        telegramReminderMinutes: 300,
      },
      'event',
    );
    await h.operations.execute(op.id);
    const r = (await h.store.reminders())[0];
    expect(r.remindAt).toBe('2026-10-24T07:00:00.000Z');
    const event = (await h.calendar.inspect('event', 'primary', op.id)) as CalendarEvent;
    await h.calendar.execute(
      {
        kind: 'event.update',
        calendarId: 'primary',
        eventId: event.id,
        etag: event.etag,
        event: {
          summary: 'Toplantı',
          start: { dateTime: '2026-10-24T17:00:00+03:00' },
          end: { dateTime: '2026-10-24T18:00:00+03:00' },
        },
        scope: 'single',
        notify: false,
        conference: false,
      },
      'external',
    );
    vi.setSystemTime(new Date('2026-10-24T07:00:00Z'));
    await h.operations.reminders.schedule();
    expect((await h.store.reminder(r.id))?.remindAt).toBe('2026-10-24T09:00:00.000Z');
    vi.setSystemTime(new Date('2026-10-24T09:00:00Z'));
    await h.worker.tick();
    await h.worker.tick();
    await h.telegram.collectNotifications();
    await h.telegram.dispatch();
    expect(h.transport.call).toHaveBeenCalledTimes(1);
  });
  it('cancels external deletions, but defers temporary source failures', async () => {
    const h = setup();
    const event = {
      id: 'one',
      calendarId: 'primary',
      summary: 'Plan',
      start: { dateTime: '2026-10-24T12:00:00Z' },
      end: { dateTime: '2026-10-24T13:00:00Z' },
    };
    const inspect = vi.spyOn(h.calendar, 'inspect').mockResolvedValue(event);
    const r = await h.operations.reminders.execute(
      {
        kind: 'reminder.create',
        reminder: {
          title: 'Plan',
          message: 'Plan',
          enabled: true,
          event: { calendarId: 'primary', eventId: 'one', minutesBefore: 60 },
        },
      },
      crypto.randomUUID(),
    );
    vi.setSystemTime(new Date('2026-10-24T11:00:00Z'));
    inspect.mockRejectedValue(new AppError(503, 'Offline'));
    await h.operations.reminders.schedule();
    expect((await h.store.reminder(r.id))?.state).toBe('scheduled');
    expect(h.transport.call).not.toHaveBeenCalled();
    inspect.mockRejectedValue(new AppError(404, 'Gone'));
    vi.setSystemTime(new Date('2026-10-24T11:02:00Z'));
    await h.operations.reminders.schedule();
    expect((await h.store.reminder(r.id))?.state).toBe('canceled');
  });
  it('uses the dedicated assistant contract without creating a task', async () => {
    const h = setup();
    const generate = vi
      .fn()
      .mockResolvedValueOnce({ output: { group: 'reminder-management' } })
      .mockResolvedValueOnce({
        output: { message: 'Hatırlatma', read: null, action: { kind: 'reminder.create', reminder: input } },
      });
    const assistant = new AssistantService({ generate }, h.store, h.calendar, h.operations, {
      telegram: true,
      voice: false,
    });
    const result = (await assistant.chat('5 saat sonra çamaşırları hatırlat', 'relative')) as {
      operation?: { status: string };
      message: string;
    };
    expect(result.operation?.status).toBe('succeeded');
    expect(result.message).toContain('Set your reminder');
    expect((await h.store.memories({ query: '', archived: false, limit: 20 })).items).toHaveLength(0);
  });
  it('advances a series once per occurrence and handles zero-minute lead time', async () => {
    const h = setup();
    const master = {
      id: 'series',
      calendarId: 'primary',
      summary: 'Günlük',
      start: { dateTime: '2026-10-24T09:00:00Z' },
      end: { dateTime: '2026-10-24T10:00:00Z' },
      recurrence: ['RRULE:FREQ=DAILY'],
    };
    const occurrences = [0, 1].map((day) => ({
      ...master,
      id: 'instance-' + day,
      recurringEventId: 'series',
      recurrence: undefined,
      start: { dateTime: `2026-10-${24 + day}T09:00:00Z` },
      end: { dateTime: `2026-10-${24 + day}T10:00:00Z` },
    }));
    vi.spyOn(h.calendar, 'inspect').mockResolvedValue(master);
    vi.spyOn(h.calendar, 'events').mockResolvedValue(occurrences);
    const record = await h.operations.reminders.execute(
      {
        kind: 'reminder.create',
        reminder: {
          title: 'Günlük',
          message: 'Başlıyor',
          enabled: true,
          event: { calendarId: 'primary', eventId: 'series', minutesBefore: 0 },
        },
      },
      crypto.randomUUID(),
    );
    vi.setSystemTime(new Date('2026-10-24T09:00:00Z'));
    await h.worker.tick();
    await h.telegram.collectNotifications();
    await h.telegram.dispatch();
    expect(h.transport.call).toHaveBeenCalledTimes(1);
    await h.operations.reminders.schedule();
    expect((await h.store.reminder(record.id))?.remindAt).toBe('2026-10-25T09:00:00.000Z');
    vi.setSystemTime(new Date('2026-10-25T09:00:00Z'));
    await h.worker.tick();
    await h.telegram.collectNotifications();
    await h.telegram.dispatch();
    expect(h.transport.call).toHaveBeenCalledTimes(2);
  });
  it('does not blindly repeat an uncertain Telegram send and shows the problem', async () => {
    const h = setup();
    const op = await create(h);
    vi.setSystemTime(new Date(input.remindAt));
    await h.worker.tick();
    await h.telegram.collectNotifications();
    h.transport.call.mockRejectedValue(new AppError(503, 'Gönderim belirsiz', true));
    await h.telegram.dispatch();
    await h.worker.tick();
    await h.telegram.collectNotifications();
    await h.telegram.dispatch();
    expect(h.transport.call).toHaveBeenCalledTimes(1);
    expect((await h.store.reminder(op.id))?.lastError).toContain('belirsiz');
  });
  it('does not mark a preparation failure as a delivered reminder', async () => {
    const h = setup();
    const op = await create(h);
    vi.setSystemTime(new Date(input.remindAt));
    await h.worker.tick();
    const prepared = (await h.store.jobs()).find((j) => j.payload.reminder)!;
    await h.store.finish({
      ...prepared,
      status: 'unknown',
      error: 'Worker lease expired; manual reconciliation required',
    });
    await h.telegram.collectNotifications();
    await h.telegram.dispatch();
    expect(h.transport.call).not.toHaveBeenCalled();
    expect((await h.store.reminder(op.id))?.state).toBe('scheduled');
  });
  it('rejects credentials before an operation can persist them', async () => {
    const h = setup();
    await expect(
      h.operations.submit(
        { kind: 'reminder.create', reminder: { ...input, message: 'GOCSPX-' + 'do-not-store-this' } },
        'secret',
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(await h.store.operations()).toHaveLength(0);
  });
  it('uses the source calendar timezone for all-day reminders', async () => {
    const h = setup();
    vi.spyOn(h.calendar, 'inspect').mockResolvedValue({
      id: 'day',
      calendarId: 'primary',
      summary: 'Tüm gün',
      start: { date: '2026-10-25' },
      end: { date: '2026-10-26' },
    });
    vi.spyOn(h.calendar, 'calendars').mockResolvedValue([
      { id: 'primary', primary: true, summary: 'Takvim', timeZone: 'America/New_York' },
    ]);
    const record = await h.operations.reminders.execute(
      {
        kind: 'reminder.create',
        reminder: {
          title: 'Gün',
          message: 'Gün',
          enabled: true,
          event: { calendarId: 'primary', eventId: 'day', minutesBefore: 300 },
        },
      },
      crypto.randomUUID(),
    );
    expect(record.remindAt).toBe('2026-10-24T23:00:00.000Z');
  });
  it('delivers a still-pending reminder when Telegram is first connected after its deadline', async () => {
    const h = setup();
    await create(h);
    vi.setSystemTime(new Date(input.remindAt));
    await h.worker.tick();
    await h.store.set('telegram.startedAt', new Date(Date.now() + 60000).toISOString());
    await h.telegram.collectNotifications();
    await h.telegram.dispatch();
    expect(h.transport.call).toHaveBeenCalledTimes(1);
  });
  it('reports a partial calendar/reminder failure without recreating the event', async () => {
    const h = setup();
    vi.spyOn(h.store, 'saveReminder').mockRejectedValue(new AppError(503, 'Storage unavailable'));
    const input = {
      kind: 'event.create',
      calendarId: 'primary',
      event: {
        summary: 'Plan',
        start: { dateTime: '2026-10-24T15:00:00+03:00' },
        end: { dateTime: '2026-10-24T16:00:00+03:00' },
      },
      telegramReminderMinutes: 60,
    };
    const op = await h.operations.submit(input, 'partial');
    await expect(h.operations.execute(op.id)).rejects.toThrow();
    expect(await h.store.operation(op.id)).toMatchObject({
      status: 'unknown',
      error: expect.stringContaining('Takvim değişikliği uygulandı'),
    });
    await h.operations.execute(op.id);
    expect(await h.calendar.events('primary', '2026-10-24T00:00:00Z', '2026-10-25T00:00:00Z')).toHaveLength(
      1,
    );
  });
});
