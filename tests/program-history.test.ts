import { describe, it, expect, vi } from 'vitest';
import { MemoryStore, newJob } from '../server/repositories';
import { PersonalMemory } from '../server/memory-service';
import { memoryInput } from '../shared/memory';
import { programAvailability } from '../server/program-availability';
import { mergeMessages, reconcileMessages } from '../shared/chat-messages';
import { AssistantService } from '../server/provider';
import { RoutineService, OperationService } from '../server/services';
import { DemoCalendar } from '../server/google';
import { ChatRequests } from '../server/chat-requests';
async function program(store: MemoryStore, patch: Record<string, unknown> = {}) {
  return new PersonalMemory(store).execute(
    {
      kind: 'memory.create',
      record: memoryInput.parse({
        kind: 'program',
        title: 'Class timetable',
        body: 'Weekly classes',
        program: {
          timeZone: 'Europe/Istanbul',
          enabled: true,
          entries: [
            {
              id: crypto.randomUUID(),
              title: 'Mathematics',
              frequency: 'weekly',
              days: [1],
              start: '09:00',
              end: '10:00',
              location: 'Room A',
            },
          ],
          ...patch,
        },
      }),
    },
    crypto.randomUUID(),
  );
}
describe('program availability and conversation reliability', () => {
  it('includes weekly commitments with exact offsets and excludes paused, skipped and nonblocking commitments from busy claims', async () => {
    const store = new MemoryStore();
    await program(store);
    await program(store, { enabled: false });
    await program(store, { excludedDates: ['2026-10-26'] });
    await program(store, { blocksTime: false });
    const result = await programAvailability(store, '2026-10-26T05:00:00Z', '2026-10-26T08:00:00Z');
    expect(result.occurrences).toHaveLength(2);
    expect(result.occurrences.filter((row) => row.blocksTime)).toHaveLength(1);
    expect(result.occurrences[0]).toMatchObject({
      start: '2026-10-26T06:00:00.000Z',
      end: '2026-10-26T07:00:00.000Z',
    });
    expect(result.partial).toBe(false);
  });
  it('skips monthly days absent from a month', async () => {
    const store = new MemoryStore();
    await program(store, {
      entries: [
        {
          id: crypto.randomUUID(),
          title: 'Monthly review',
          frequency: 'monthly',
          days: [31],
          start: '09:00',
          end: '10:00',
        },
      ],
    });
    expect(
      (await programAvailability(store, '2027-02-01T00:00:00Z', '2027-03-01T00:00:00Z')).occurrences,
    ).toEqual([]);
  });
  it('treats DST folds conservatively and does not pretend missing spring times are free', async () => {
    const store = new MemoryStore();
    await program(store, {
      timeZone: 'America/New_York',
      entries: [
        {
          id: crypto.randomUUID(),
          title: 'Fall class',
          frequency: 'weekly',
          days: [7],
          start: '01:30',
          end: '02:30',
        },
      ],
    });
    const fold = await programAvailability(store, '2026-11-01T00:00:00Z', '2026-11-02T00:00:00Z');
    expect(fold.occurrences[0]).toMatchObject({
      start: '2026-11-01T05:30:00.000Z',
      end: '2026-11-01T07:30:00.000Z',
      ambiguous: true,
    });
    const gapStore = new MemoryStore();
    await program(gapStore, {
      timeZone: 'America/New_York',
      entries: [
        {
          id: crypto.randomUUID(),
          title: 'Gap class',
          frequency: 'weekly',
          days: [7],
          start: '02:30',
          end: '03:30',
        },
      ],
    });
    const gap = await programAvailability(gapStore, '2026-03-08T00:00:00Z', '2026-03-09T00:00:00Z');
    expect(gap).toMatchObject({ partial: true, unresolved: 1, occurrences: [] });
  });
  it('merges snapshots chronologically and replaces local pending messages with stored copies', () => {
    const local = {
      exchangeId: 'chat:web:test',
      role: 'user' as const,
      text: 'Pending',
      createdAt: '2026-10-26T10:00:00Z',
    };
    const old = {
      id: '99',
      role: 'assistant' as const,
      text: 'Old imported message',
      createdAt: '2026-10-20T10:00:00Z',
    };
    const recent = { id: '2', role: 'assistant' as const, text: 'New', createdAt: '2026-10-25T10:00:00Z' };
    const saved = { ...local, id: '100' };
    expect(mergeMessages([recent, old, local], [saved]).map((row) => row.text)).toEqual([
      'Old imported message',
      'New',
      'Pending',
    ]);
    expect(reconcileMessages([old, local], [recent, saved])).toHaveLength(3);
    expect(reconcileMessages([local], [saved])[0].id).toBe('100');
  });
  it('completes a visible shorthand-amount task after automatically checking the exact current record', async () => {
    const store = new MemoryStore(),
      calendar = new DemoCalendar(),
      memory = new PersonalMemory(store),
      operations = new OperationService(store, calendar, new RoutineService(store));
    const task = await memory.execute(
      {
        kind: 'memory.create',
        record: memoryInput.parse({
          kind: 'task',
          title: 'Transfer 7500 TL into the reserve',
          body: 'Reserve transfer of 7500 TL',
          taskState: 'open',
        }),
      },
      crypto.randomUUID(),
    );
    const outputs = [
      { group: 'personal-memory' },
      {
        message: 'Completion request',
        action: { kind: 'memory.complete', memoryId: task.id, version: 1 },
        read: null,
      },
    ];
    const generate = vi.fn(async () => ({ output: outputs.shift() }));
    const result = (await new AssistantService({ generate }, store, calendar, operations).chat(
      '7.5k tlyi yatırdım bu arada',
      'deposit-complete',
    )) as { operation: { status: string } };
    expect(result.operation.status).toBe('succeeded');
    expect(await memory.inspect(task.id)).toMatchObject({ taskState: 'done', archived: true, version: 2 });
    expect(generate).toHaveBeenCalledTimes(2);
  });
  it('archives a failed durable web exchange and does not retry it as a new request', async () => {
    const store = new MemoryStore(),
      chat = vi.fn().mockRejectedValue(new Error('Transport failure')),
      service = new ChatRequests(store, { chat } as unknown as AssistantService),
      id = crypto.randomUUID();
    await service.submit(id, 'Keep this failed request');
    await service.tick();
    const rows = await store.conversation();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ text: 'Keep this failed request', exchangeId: 'chat:web:' + id });
    expect(rows[1].role).toBe('assistant');
    await service.tick();
    expect(chat).toHaveBeenCalledTimes(1);
  });
  it('passes timetable evidence alongside calendar reads to the assistant', async () => {
    const store = new MemoryStore(),
      calendar = new DemoCalendar(),
      operations = new OperationService(store, calendar, new RoutineService(store));
    await program(store);
    const outputs = [
      { group: 'calendar-read' },
      {
        message: 'Checking sources',
        action: null,
        read: {
          kind: 'freebusy',
          calendarId: 'primary',
          from: '2026-10-26T05:00:00Z',
          to: '2026-10-26T08:00:00Z',
        },
      },
      { message: 'Your class occupies 09:00–10:00 in Istanbul.', action: null, read: null },
    ];
    const generate = vi.fn(async (_prompt: string) => ({ output: outputs.shift() }));
    await new AssistantService({ generate }, store, calendar, operations).chat(
      'Am I free that morning?',
      'check-with-program',
    );
    expect(generate.mock.calls.at(-1)?.[0]).toContain('Mathematics');
    expect(generate.mock.calls.at(-1)?.[0]).toContain('"kind":"program-availability"');
  });
});
