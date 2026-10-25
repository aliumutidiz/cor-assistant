import { describe, it, expect } from 'vitest';
import { memoryInput } from '../shared/memory.js';
import { personalProgram, programOccurrences } from '../shared/personal-resources.js';
import { memoryTerms, boundedMemoryHints } from '../shared/memory-retrieval.js';
import { PersonalMemory } from '../server/memory-service.js';
import { MemoryStore } from '../server/repositories.js';

const id = () => crypto.randomUUID();
describe('provider independent personal resources', () => {
  it('expands ISO weekdays, effective dates and exclusions without calendar writes', () => {
    const program = personalProgram.parse({
      timeZone: 'Europe/Istanbul',
      from: '2026-10-26',
      until: '2026-11-01',
      excludedDates: ['2026-10-28'],
      entries: [
        { id: id(), title: 'Ders', frequency: 'weekly', days: [1, 3, 7], start: '09:00', end: '10:00' },
      ],
    });
    expect(programOccurrences(program, '2026-10-24', '2026-11-03').map((row) => row.day)).toEqual([
      '2026-10-26',
      '2026-11-01',
    ]);
    expect(programOccurrences({ ...program, enabled: false }, '2026-10-24', '2026-11-03')).toEqual([]);
  });
  it('skips missing month days and rejects invalid schedules and oversized windows', () => {
    const program = personalProgram.parse({
      timeZone: 'Europe/Istanbul',
      entries: [
        { id: id(), title: 'Kontrol', frequency: 'monthly', days: [31], start: '18:00', end: '19:00' },
      ],
    });
    expect(programOccurrences(program, '2026-02-01', '2026-04-01').map((row) => row.day)).toEqual([
      '2026-03-31',
    ]);
    expect(() => programOccurrences(program, '2026-01-01', '2026-12-31')).toThrow();
    expect(() =>
      personalProgram.parse({
        ...program,
        entries: [{ ...program.entries[0], frequency: 'weekly', days: [8] }],
      }),
    ).toThrow();
    expect(() =>
      personalProgram.parse({ ...program, entries: [{ ...program.entries[0], end: '17:00' }] }),
    ).toThrow();
  });
  it('keeps list item identity, completion, provenance and revisions; rejects stale updates', async () => {
    const store = new MemoryStore(),
      memory = new PersonalMemory(store),
      itemId = id();
    const record = await memory.execute(
      {
        kind: 'memory.create',
        record: memoryInput.parse({
          kind: 'shopping_list',
          title: 'Market',
          body: 'Haftalık alınacaklar',
          shopping: { items: [{ id: itemId, name: 'Süt', quantity: '2 litre' }] },
        }),
      },
      id(),
    );
    const updated = memoryInput.strip().parse(record);
    updated.shopping!.items[0].checked = true;
    const saved = await memory.execute(
      { kind: 'memory.update', memoryId: record.id, version: record.version, record: updated },
      id(),
    );
    expect(saved.shopping!.items[0]).toMatchObject({
      id: itemId,
      name: 'Süt',
      quantity: '2 litre',
      checked: true,
    });
    expect((await memory.search({ query: 'süt' })).items[0].id).toBe(record.id);
    expect((await memory.context('Süt listemde var mı?'))[0].id).toBe(record.id);
    expect(await store.memoryHistory(record.id)).toHaveLength(2);
    await expect(
      memory.execute(
        { kind: 'memory.update', memoryId: record.id, version: record.version, record: updated },
        id(),
      ),
    ).rejects.toMatchObject({ status: 409 });
    expect(() => memoryInput.parse({ ...updated, kind: 'fact' })).toThrow();
  });
  it('excludes archived and expired profile statements and bounds automatic context', async () => {
    const memory = new PersonalMemory(new MemoryStore());
    for (let i = 0; i < 8; i++)
      await memory.execute(
        {
          kind: 'memory.create',
          record: memoryInput.parse({
            kind: 'profile',
            title: 'Tercih ' + i,
            body: 'Kısa yanıt '.repeat(50),
            profile: { category: 'preference' },
          }),
        },
        id(),
      );
    await memory.execute(
      {
        kind: 'memory.create',
        record: memoryInput.parse({
          kind: 'profile',
          title: 'Eski',
          body: 'Geçersiz tercih',
          profile: { category: 'priority', validUntil: '2020-01-01' },
        }),
      },
      id(),
    );
    const context = await memory.profileContext();
    expect(JSON.stringify(context.statements).length).toBeLessThanOrEqual(3000);
    expect(context.partial).toBe(true);
    expect(context.statements.some((row) => row.title === 'Eski')).toBe(false);
  });
  it('ranks old topical evidence ahead of generic recent rows and searches years of conversation', async () => {
    const store = new MemoryStore(),
      memory = new PersonalMemory(store);
    const important = await memory.execute(
      {
        kind: 'memory.create',
        record: memoryInput.parse({ kind: 'fact', title: 'Kulaklık garanti', body: 'İki yıl garanti var.' }),
      },
      id(),
    );
    for (let i = 0; i < 55; i++)
      await memory.execute(
        {
          kind: 'memory.create',
          record: memoryInput.parse({
            kind: 'idea',
            title: 'Başka fikir ' + i,
            body: 'Kulaklık için belki bir şey.',
          }),
        },
        id(),
      );
    const hints = await memory.context('Bana kulaklık garanti hakkında söyler misin?');
    expect(hints[0].id).toBe(important.id);
    expect(
      JSON.stringify(boundedMemoryHints(await store.recall('kulaklık'), 'kulaklık', 900)).length,
    ).toBeLessThanOrEqual(900);
    expect(memoryTerms('Bana bunu lütfen şimdi söyler misin kulaklık?')).toEqual(['kulaklik']);
    await store.appendConversation('chat:telegram:1', 'Ankara konferansı', 'Ekimde olacak.');
    for (let i = 0; i < 300; i++) await store.appendConversation('chat:web:' + i, 'Başka konu ' + i, 'Yanıt');
    expect((await store.recallConversation('Ankara konferansı'))[0]).toMatchObject({
      text: 'Ankara konferansı',
      channel: 'telegram',
    });
  });
});
