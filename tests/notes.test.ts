import { describe, it, expect } from 'vitest';
import { randomUUID } from 'node:crypto';
import { memoryInput, memorySearch } from '../shared/memory';
import { noteTarget, sameNoteTarget } from '../shared/notes';
import { MemoryStore } from '../server/repositories';
import { PersonalMemory } from '../server/memory-service';
import { prefersProgramCapability } from '../server/program-intent';
import { OperationService, RoutineService } from '../server/services';
import { DemoCalendar } from '../server/google';
import { operationMessage } from '../shared/operation-message';

const day = { type: 'day' as const, day: '2026-11-26' };
const note = (target: unknown, body = 'Bring the printed worksheet.') =>
  memoryInput.parse({ kind: 'note', title: 'Worksheet', body, noteTarget: target });
describe('attached notes', () => {
  it('executes notes through normal validated, idempotent operations without calendar writes', async () => {
    const store = new MemoryStore(),
      calendar = new DemoCalendar(),
      operations = new OperationService(store, calendar, new RoutineService(store));
    const key = 'note-' + randomUUID(),
      action = { kind: 'memory.create' as const, record: note(day) };
    const queued = await operations.submit(action, key);
    await operations.execute(queued.id);
    const saved = await store.operation(queued.id);
    expect(saved?.status).toBe('succeeded');
    expect((await store.memory(queued.id))?.noteTarget).toEqual(day);
    expect((await operations.submit(action, key)).id).toBe(queued.id);
    expect(operationMessage(saved!, 'Europe/Istanbul', 'tr')).toContain('Notunu kaydettim.');
    expect((await store.memories(memorySearch.parse({ kind: 'note' }))).items).toHaveLength(1);
  });
  it('keeps target types strict and rejects mismatched dates and unrelated record kinds', () => {
    expect(() => noteTarget.parse({ ...day, command: 'run' })).toThrow();
    expect(() => memoryInput.parse({ ...note(day), occurredOn: '2026-11-27' })).toThrow();
    expect(() => memoryInput.parse({ ...note(day), kind: 'fact' })).toThrow();
    expect(() => memoryInput.parse({ kind: 'note', title: 'Missing target', body: 'Text' })).toThrow();
    expect(sameNoteTarget({ day: day.day, type: 'day' }, day)).toBe(true);
  });
  it('persists dated notes without jobs and filters the target before pagination', async () => {
    const store = new MemoryStore(),
      memory = new PersonalMemory(store);
    const id = randomUUID();
    const first = await memory.execute({ kind: 'memory.create', record: note(day) }, id);
    const replay = await memory.execute({ kind: 'memory.create', record: note(day) }, id);
    expect(replay.id).toBe(first.id);
    expect(replay.version).toBe(1);
    for (let i = 0; i < 3; i++)
      await memory.execute(
        { kind: 'memory.create', record: note({ type: 'day', day: '2026-11-27' }, 'Other date') },
        randomUUID(),
      );
    const page = await memory.search({ kind: 'note', noteTarget: day, limit: 1 });
    expect(page.items.map((row) => row.id)).toEqual([first.id]);
    expect(page.next).toBeUndefined();
    expect(page.items[0].occurredOn).toBe(day.day);
    await memory.execute(
      { kind: 'memory.create', record: note({ type: 'workspace' }, 'Undated general note') },
      randomUUID(),
    );
    expect(
      (
        await memory.search({ kind: 'note', from: '2026-11-25T21:00:00Z', to: '2026-11-26T21:00:00Z' })
      ).items.map((row) => row.id),
    ).toEqual([first.id]);
    expect(await store.jobs()).toHaveLength(0);
  });
  it('separates whole programs, activities and individual occurrences and guards target IDs', async () => {
    const store = new MemoryStore(),
      memory = new PersonalMemory(store),
      entryId = randomUUID();
    const program = await memory.execute(
      {
        kind: 'memory.create',
        record: memoryInput.parse({
          kind: 'program',
          title: 'Classes',
          body: 'Weekly classes',
          program: {
            timeZone: 'Europe/Istanbul',
            entries: [
              {
                id: entryId,
                title: 'Calculus',
                frequency: 'weekly',
                days: [4],
                start: '10:30',
                end: '12:20',
              },
            ],
          },
        }),
      },
      randomUUID(),
    );
    const scopes = [
      { type: 'program' as const, id: program.id },
      { type: 'program' as const, id: program.id, entryId },
      { type: 'program' as const, id: program.id, entryId, day: day.day },
    ];
    for (const target of scopes)
      await memory.execute({ kind: 'memory.create', record: note(target) }, randomUUID());
    for (const target of scopes)
      expect(
        (await store.memories(memorySearch.parse({ kind: 'note', noteTarget: target }))).items,
      ).toHaveLength(1);
    expect((await memory.search({ kind: 'note', noteTarget: scopes[2] })).items[0].occurredOn).toBe(day.day);
    expect(
      (await memory.search({ kind: 'note', from: '2026-11-25T21:00:00Z', to: '2026-11-26T21:00:00Z' })).items,
    ).toHaveLength(1);
    await expect(
      memory.execute(
        { kind: 'memory.create', record: note({ ...scopes[0], entryId: randomUUID() }) },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ status: 404 });
    expect((await memory.inspect(program.id)).version).toBe(1);
  });
  it('versions edits, rejects stale changes and restores archived notes with their attachment intact', async () => {
    const memory = new PersonalMemory(new MemoryStore());
    const saved = await memory.execute({ kind: 'memory.create', record: note(day) }, randomUUID());
    const edited = await memory.execute(
      { kind: 'memory.update', memoryId: saved.id, version: 1, record: note(day, 'Bring two copies.') },
      randomUUID(),
    );
    await expect(
      memory.execute(
        { kind: 'memory.update', memoryId: saved.id, version: 1, record: note(day, 'Stale text') },
        randomUUID(),
      ),
    ).rejects.toMatchObject({ status: 409 });
    const archived = await memory.execute(
      { kind: 'memory.archive', memoryId: saved.id, version: edited.version },
      randomUUID(),
    );
    expect((await memory.search({ kind: 'note', noteTarget: day })).items).toHaveLength(0);
    const restored = await memory.execute(
      { kind: 'memory.restore', memoryId: saved.id, version: archived.version },
      randomUUID(),
    );
    expect(restored.body).toBe('Bring two copies.');
    expect(restored.noteTarget).toEqual(day);
    expect(restored.version).toBe(4);
  });
  it('routes note requests away from program replacement', () => {
    expect(prefersProgramCapability('Calculus ders programıma not ekle: çalışma kağıdı getir.')).toBe(false);
    expect(prefersProgramCapability('Add a note to my weekly class timetable.')).toBe(false);
    expect(prefersProgramCapability('Ders programımın notlarını göster.')).toBe(false);
    expect(prefersProgramCapability('Ders programına not düş: kitapları getir.')).toBe(false);
    expect(prefersProgramCapability('Not my calendar, add it to my class timetable.')).toBe(true);
  });
});
