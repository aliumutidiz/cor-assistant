import { describe, it, expect, vi, afterEach } from 'vitest';
import { personalProgram, programOccurrences } from '../shared/personal-resources';
import { MemoryStore } from '../server/repositories';
import { PersonalMemory } from '../server/memory-service';
import { memoryInput, memorySearch } from '../shared/memory';
import { ProgramNotifications } from '../server/program-notifications';
import { programAvailability } from '../server/program-availability';
import { createApp } from '../server/app';
import { loadConfig } from '../server/config';
import { prefersProgramCapability } from '../server/program-intent';
import { TelegramService, type TelegramTransport } from '../server/telegram';
import { RoutineService, OperationService, WorkerService } from '../server/services';
import { DemoCalendar } from '../server/google';
const entryId = '00000000-0000-4000-8000-000000000001';
function program(patch: Record<string, unknown> = {}) {
  return personalProgram.parse({
    timeZone: 'Europe/Istanbul',
    entries: [
      {
        id: entryId,
        title: 'Exercise',
        frequency: 'cycle',
        days: [1],
        cycle: { anchor: '2026-10-30', activeDays: 1, restDays: 1 },
        start: '09:00',
        end: '10:00',
        notifyMinutesBefore: 15,
      },
    ],
    ...patch,
  });
}
async function saved(store: MemoryStore, data = program()) {
  await new PersonalMemory(store).execute(
    {
      kind: 'memory.create',
      record: memoryInput.parse({
        kind: 'program',
        title: 'Exercise plan',
        body: 'Owner requested exercise cycle',
        program: data,
      }),
    },
    crypto.randomUUID(),
  );
  return (await store.memories(memorySearch.parse({ kind: 'program', limit: 10, archived: false }))).items[0];
}
afterEach(() => vi.useRealTimers());
describe('local planning and cycles', () => {
  it('rechecks the program immediately before sending a prepared Telegram message', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-30T05:45:01Z'));
    const store = new MemoryStore();
    const record = await saved(store);
    const calendar = new DemoCalendar(),
      routines = new RoutineService(store),
      operations = new OperationService(store, calendar, routines);
    const worker = new WorkerService(store, calendar, routines, operations);
    const transport = { call: vi.fn().mockResolvedValue([]), download: vi.fn() };
    const assistant = { chat: vi.fn() };
    const service = new TelegramService(
      { ...loadConfig({ NODE_ENV: 'test', TELEGRAM_OWNER_ID: '42' }), TELEGRAM_ENABLED: true },
      store,
      transport as TelegramTransport,
      { transcribe: vi.fn() },
      assistant,
      operations,
    );
    await store.set('telegram.startedAt', new Date(Date.now() - 1000).toISOString());
    await worker.tick();
    await service.collectNotifications();
    await service.collectNotifications();
    expect((await store.jobs()).filter((job) => job.kind === 'telegram_outgoing')).toHaveLength(1);
    await new PersonalMemory(store).execute(
      {
        kind: 'memory.update',
        memoryId: record.id,
        version: record.version,
        record: memoryInput.strip().parse({ ...record, program: { ...record.program, enabled: false } }),
      },
      crypto.randomUUID(),
    );
    await service.dispatch();
    expect(transport.call).not.toHaveBeenCalled();
    expect(assistant.chat).not.toHaveBeenCalled();
  });
  it('routes active/rest requests to programs while respecting explicit Google Calendar intent', () => {
    expect(prefersProgramCapability('1 gün spor yapacağım 1 gün yapmayacağım')).toBe(true);
    expect(prefersProgramCapability('Exercise every other day')).toBe(true);
    expect(prefersProgramCapability('Gün aşırı sporu Google takvimime ekle')).toBe(false);
  });
  it('keeps alternate days across a month boundary without creating Google events', () => {
    expect(programOccurrences(program(), '2026-10-30', '2026-11-06').map((item) => item.day)).toEqual([
      '2026-10-30',
      '2026-11-01',
      '2026-11-03',
      '2026-11-05',
    ]);
  });
  it('supports three active days then one rest day, and never starts before the anchor', () => {
    const data = program();
    data.entries[0].cycle!.activeDays = 3;
    expect(programOccurrences(data, '2026-10-29', '2026-11-05').map((item) => item.day)).toEqual([
      '2026-10-30',
      '2026-10-31',
      '2026-11-01',
      '2026-11-03',
      '2026-11-04',
    ]);
  });
  it('skips one day without shifting the cycle and retains completion', () => {
    const data = program({
      exceptions: [
        { entryId, day: '2026-11-01', status: 'skipped' },
        { entryId, day: '2026-11-03', status: 'done' },
      ],
    });
    const items = programOccurrences(data, '2026-10-30', '2026-11-06');
    expect(items.map((item) => item.day)).toEqual(['2026-10-30', '2026-11-03', '2026-11-05']);
    expect(items[1].status).toBe('done');
  });
  it('moves an occurrence across a query boundary and resolves its new time for availability', async () => {
    const store = new MemoryStore();
    await saved(
      store,
      program({
        exceptions: [
          {
            entryId,
            day: '2026-10-30',
            status: 'moved',
            movedTo: '2026-11-02',
            movedStart: '14:00',
            movedEnd: '15:00',
          },
        ],
      }),
    );
    const data = await programAvailability(store, '2026-11-02T00:00:00Z', '2026-11-03T00:00:00Z');
    expect(data.occurrences).toHaveLength(1);
    expect(data.occurrences[0]).toMatchObject({
      originalDay: '2026-10-30',
      start: '2026-11-02T11:00:00.000Z',
      blocksTime: true,
    });
  });
  it('pauses an inclusive vacation interval without resetting the cycle', () => {
    expect(
      programOccurrences(
        program({ paused: { from: '2026-11-01', until: '2026-11-03' } }),
        '2026-10-30',
        '2026-11-06',
      ).map((item) => item.day),
    ).toEqual(['2026-10-30', '2026-11-05']);
  });
  it('rejects missing cycle anchors, duplicate exceptions and reversed moved times', () => {
    const data = program();
    delete data.entries[0].cycle;
    expect(personalProgram.safeParse(data).success).toBe(false);
    expect(() =>
      program({
        exceptions: [
          { entryId, day: '2026-11-01', status: 'skipped' },
          { entryId, day: '2026-11-01', status: 'done' },
        ],
      }),
    ).toThrow();
    expect(() =>
      program({
        exceptions: [
          {
            entryId,
            day: '2026-11-01',
            status: 'moved',
            movedTo: '2026-11-02',
            movedStart: '15:00',
            movedEnd: '14:00',
          },
        ],
      }),
    ).toThrow();
  });
  it('schedules one durable notification without a model and suppresses completion before delivery', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-30T05:45:01Z'));
    const store = new MemoryStore();
    const record = await saved(store);
    await new ProgramNotifications(store).schedule();
    await new ProgramNotifications(store).schedule();
    const jobs = (await store.jobs()).filter((job) => job.payload.programReminder);
    expect(jobs).toHaveLength(1);
    expect(await new ProgramNotifications(store).current(jobs[0].payload.programReminder!)).toBeDefined();
    await new PersonalMemory(store).execute(
      {
        kind: 'memory.update',
        memoryId: record.id,
        version: record.version,
        record: memoryInput.strip().parse({
          ...record,
          program: { ...record.program, exceptions: [{ entryId, day: '2026-10-30', status: 'done' }] },
        }),
      },
      crypto.randomUUID(),
    );
    expect(await new ProgramNotifications(store).current(jobs[0].payload.programReminder!)).toBeUndefined();
  });
  it('suppresses quiet-hour notifications and does not catch up after a long outage', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-30T05:45:01Z'));
    const store = new MemoryStore();
    await saved(store, program({ quietHours: { start: 22, end: 10 } }));
    await new ProgramNotifications(store).schedule();
    expect(await store.jobs()).toHaveLength(0);
    const second = new MemoryStore();
    await saved(second);
    vi.setSystemTime(new Date('2026-10-30T07:00:00Z'));
    await new ProgramNotifications(second).schedule();
    expect(await second.jobs()).toHaveLength(0);
  });
  it('projects local entries with authenticated bounded queries and explicit sources', async () => {
    const store = new MemoryStore();
    await saved(store);
    const { app } = await createApp(loadConfig({ NODE_ENV: 'test' }), store);
    try {
      const response = await app.inject({ url: '/api/session', headers: { host: 'localhost' } });
      const cookie = response.cookies[0].name + '=' + response.cookies[0].value;
      const headers = { host: 'localhost', cookie };
      const result = await app.inject({
        url: '/api/planner?from=2026-10-30T00:00:00Z&to=2026-11-01T00:00:00Z',
        headers,
      });
      expect(result.statusCode).toBe(200);
      expect(result.json().items[0].source).toBe('program');
      expect(
        (await app.inject({ url: '/api/planner?from=2026-10-30T00:00:00Z&to=2027-11-01T00:00:00Z', headers }))
          .statusCode,
      ).toBe(400);
    } finally {
      await app.close();
    }
  });
});
