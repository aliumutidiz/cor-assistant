import { describe, it, expect, vi } from 'vitest';
import { prefersProgramCapability } from '../server/program-intent';
import { AssistantService, scopedResponseSchema } from '../server/provider';
import { MemoryStore } from '../server/repositories';
import { DemoCalendar } from '../server/google';
import { RoutineService, OperationService } from '../server/services';
import { PersonalMemory } from '../server/memory-service';
import { memoryInput } from '../shared/memory';
const entry = {
  id: crypto.randomUUID(),
  title: 'Numerical Methods',
  frequency: 'weekly' as const,
  days: [3],
  start: '09:10',
  end: '10:45',
  location: '',
};
const record = memoryInput.parse({
  kind: 'program',
  title: 'Class timetable',
  body: 'Weekly mathematics classes',
  tags: ['classes', 'timetable'],
  program: {
    timeZone: 'Europe/Istanbul',
    enabled: true,
    blocksTime: true,
    from: null,
    until: null,
    excludedDates: [],
    entries: [entry],
  },
});
const create = { message: 'Program proposal', action: { kind: 'memory.create', record }, read: null };
function harness(outputs: unknown[] = []) {
  const store = new MemoryStore(),
    calendar = new DemoCalendar(),
    operations = new OperationService(store, calendar, new RoutineService(store));
  const generate = vi.fn(async (_prompt: string) => ({ output: outputs.shift() }));
  return {
    store,
    calendar,
    operations,
    generate,
    memory: new PersonalMemory(store),
    assistant: new AssistantService({ generate }, store, calendar, operations),
  };
}
describe('program intent and bounded orchestration', () => {
  it('repairs a nested JSON program proposal once without executing the quoted write', async () => {
    const h = harness([{ message: JSON.stringify(create), action: null, read: null }, create]);
    const result = (await h.assistant.chat(
      'Ders programıma çarşamba Numerical Methods ekle',
      'nested-program',
    )) as { operation: { status: string } };
    expect(result.operation.status).toBe('succeeded');
    expect(h.generate).toHaveBeenCalledTimes(2);
    expect(h.generate.mock.calls[1][0]).toContain('FORMAT_RECOVERY');
    expect(await h.store.operations()).toHaveLength(1);
    expect((await h.memory.search({ kind: 'program' })).items).toHaveLength(1);
  });

  it.each([
    'çarşamba saat 09:10 ile 10:45 arasında Numerical Methods dersim var.',
    'takvime değil ders programıma eklemeni istemiştim',
    'I have a Numerical Methods class on Wednesday, 09:10–10:45.',
    'Not my calendar, add it to my class timetable.',
  ])('routes a timetable request to programs: %s', (text) =>
    expect(prefersProgramCapability(text)).toBe(true),
  );
  it.each([
    'Çarşamba Numerical Methods dersim var, takvime ekle.',
    'Add my Wednesday class to Google Calendar.',
    'Bu çarşamba 09:10 dersim var.',
    'JavaScript programını anlat.',
    'Haftalık programımı her pazar bir rutinle özetle.',
  ])('does not replace an explicit calendar or unrelated capability: %s', (text) =>
    expect(prefersProgramCapability(text)).toBe(false),
  );
  it('creates a weekly program from a weekday class without calendar operations or a routing generation', async () => {
    const h = harness([create]);
    await h.store.set('preferences', { language: 'tr', timeZone: 'Europe/Istanbul' });
    const execute = vi.spyOn(h.calendar, 'execute');
    const result = (await h.assistant.chat(
      'çarşamba saat 09:10 ile 10:45 arasında Numerical Methods dersim var.',
      'class-create',
    )) as { skill: string; message: string; operation: { status: string } };
    expect(result.skill).toBe('program-management');
    expect(result.operation.status).toBe('succeeded');
    expect(result.message).toContain('Programına kaydettim');
    expect(h.generate).toHaveBeenCalledTimes(1);
    expect(execute).not.toHaveBeenCalled();
    const saved = (await h.memory.search({ kind: 'program' })).items[0];
    expect(saved.program).toMatchObject({ from: null, until: null, entries: [entry] });
    expect(h.generate.mock.calls[0][0]).toContain('"programIndex":{"items":[],"partial":false}');
  });
  it('uses original owner details in a correction without deleting a prior calendar record', async () => {
    const h = harness([create]);
    await h.store.appendConversation(
      'chat:web:earlier',
      'Çarşamba 09:10–10:45 Numerical Methods dersim var.',
      'Numerical Methods was added to the next Wednesday in Google Calendar.',
    );
    const execute = vi.spyOn(h.calendar, 'execute');
    const result = (await h.assistant.chat(
      'takvime değil ders programıma eklemeni istemiştim',
      'class-correction',
    )) as { message: string; operation: { status: string } };
    expect(result.operation.status).toBe('succeeded');
    expect(h.generate.mock.calls[0][0]).toContain('Çarşamba 09:10');
    expect(result.message).toContain('Google Calendar entries were not changed');
    expect(execute).not.toHaveBeenCalled();
    expect((await h.memory.search({ kind: 'program' })).items).toHaveLength(1);
  });
  it('automatically reads a known program and regenerates an append while preserving unrelated entries', async () => {
    const h = harness();
    const saved = await h.memory.execute({ kind: 'memory.create', record }, crypto.randomUUID());
    const extra = { ...entry, id: crypto.randomUUID(), title: 'Logic', days: [4] };
    const update = {
      message: 'Append class',
      action: {
        kind: 'memory.update',
        memoryId: saved.id,
        version: 1,
        record: { ...record, program: { ...record.program!, entries: [entry, extra] } },
      },
      read: null,
    };
    h.generate.mockResolvedValueOnce({ output: update }).mockResolvedValueOnce({ output: update });
    const result = (await h.assistant.chat('Ders programıma perşembe Logic ekle', 'append-class')) as {
      operation: { status: string };
    };
    expect(result.operation.status).toBe('succeeded');
    expect(h.generate.mock.calls.at(-1)?.[0]).toContain('"complete":true');
    expect((await h.memory.inspect(saved.id)).program?.entries).toEqual([entry, extra]);
  });
  it('recovers one repeated search into a valid program action without another identical database read', async () => {
    const read = {
      message: 'Looking',
      action: null,
      read: { kind: 'memories', memoryKind: 'program', query: 'Class timetable' },
    };
    const h = harness([read, read, create]);
    const search = vi.spyOn(h.store, 'memories');
    const result = (await h.assistant.chat('Ders programıma çarşamba bir ders ekle', 'repeat-read')) as {
      operation: { status: string };
    };
    expect(result.operation.status).toBe('succeeded');
    expect(h.generate).toHaveBeenCalledTimes(3);
    expect(search.mock.calls.filter(([q]) => q.kind === 'program')).toHaveLength(2);
    expect(h.generate.mock.calls.at(-1)?.[0]).toContain('PROGRAM_READ_RECOVERY');
  });
  it('returns a focused clarification instead of a narrower-search error when the model keeps repeating', async () => {
    const read = { message: 'Looking', action: null, read: { kind: 'memories', memoryKind: 'program' } };
    const h = harness([read, read, read]);
    const result = (await h.assistant.chat('Ders programımı kontrol et', 'stuck-program')) as {
      message: string;
      operation?: unknown;
    };
    expect(result.message).toContain('Which personal timetable');
    expect(result.operation).toBeUndefined();
    expect(h.generate).toHaveBeenCalledTimes(3);
    expect(await h.store.operations()).toEqual([]);
  });
  it('cannot create a calendar event or a non-program memory through the program schema', () => {
    const schema = scopedResponseSchema('program-management');
    expect(
      schema.safeParse({
        message: 'wrong',
        read: null,
        action: {
          kind: 'memory.create',
          record: { kind: 'fact', title: 'Unrelated', body: 'Not a program' },
        },
      }).success,
    ).toBe(false);
    expect(
      schema.safeParse({ message: 'wrong', read: null, action: { kind: 'event.create', event: {} } }).success,
    ).toBe(false);
  });
  it('keeps an explicit calendar class request on the calendar path', async () => {
    const action = {
      kind: 'event.create',
      calendarId: 'primary',
      event: {
        summary: 'Numerical Methods',
        start: { dateTime: '2030-01-02T09:10:00+03:00' },
        end: { dateTime: '2030-01-02T10:45:00+03:00' },
      },
    };
    const h = harness([{ group: 'event-management' }, { message: 'Calendar proposal', action, read: null }]);
    const result = (await h.assistant.chat(
      'Çarşamba Numerical Methods dersim var, takvime ekle.',
      'explicit-calendar',
    )) as { operation: { status: string } };
    expect(result.operation.status).toBe('succeeded');
    expect((await h.memory.search({ kind: 'program' })).items).toHaveLength(0);
    expect(h.generate).toHaveBeenCalledTimes(2);
  });
  it('rejects a non-program archive target even if the model supplies an existing ID', async () => {
    const h = harness();
    const fact = await h.memory.execute(
      {
        kind: 'memory.create',
        record: memoryInput.parse({ kind: 'fact', title: 'Unrelated fact', body: 'Keep this record' }),
      },
      crypto.randomUUID(),
    );
    h.generate.mockResolvedValue({
      output: {
        message: 'Archive proposal',
        read: null,
        action: { kind: 'memory.archive', memoryId: fact.id, version: 1 },
      },
    });
    await expect(h.assistant.chat('Ders programını arşivle', 'wrong-target')).rejects.toMatchObject({
      status: 403,
    });
    expect((await h.memory.inspect(fact.id)).archived).toBe(false);
  });
});
