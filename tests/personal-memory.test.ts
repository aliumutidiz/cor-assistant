import { describe, it, expect, vi } from 'vitest';
import { MemoryStore } from '../server/repositories.js';
import { PersonalMemory } from '../server/memory-service.js';
import { DemoCalendar } from '../server/google.js';
import { OperationService, RoutineService, WorkerService } from '../server/services.js';
import { AssistantService } from '../server/provider.js';
import { memoryInput } from '../shared/memory.js';
import { memoryOperation } from '../shared/memory.js';

const input = memoryInput.parse({
  kind: 'purchase',
  title: 'Kulaklık',
  body: '850 TL ödedim; 2 yıl garantisi var.',
  amount: '850',
  currency: 'TRY',
});
function setup(outputs: unknown[] = []) {
  const store = new MemoryStore(),
    calendar = new DemoCalendar();
  const operations = new OperationService(store, calendar, new RoutineService(store));
  const generate = vi.fn(async (_prompt: string) => ({ output: outputs.shift() }));
  return {
    store,
    operations,
    memory: new PersonalMemory(store),
    generate,
    assistant: new AssistantService({ generate }, store, calendar, operations),
  };
}
describe('personal memory', () => {
  it('keeps a pending task, completes it without destructive approval and suppresses its queued reminder', async () => {
    const h = setup();
    const task = await h.memory.execute(
      {
        kind: 'memory.create',
        record: memoryInput.parse({
          kind: 'task',
          title: 'Fatura',
          body: 'Faturayı öde.',
          remindAt: new Date(Date.now() - 1000).toISOString(),
        }),
      },
      crypto.randomUUID(),
    );
    await Promise.all([h.memory.schedule(), h.memory.schedule()]);
    expect(await h.store.jobs()).toHaveLength(1);
    const done = await h.operations.submit(
      { kind: 'memory.complete', memoryId: task.id, version: task.version },
      'complete-task',
    );
    expect(done.status).toBe('queued');
    await h.operations.execute(done.id);
    expect(await h.store.memory(task.id)).toMatchObject({
      taskState: 'done',
      archived: true,
      body: 'Faturayı öde.',
    });
    expect((await h.memory.search({ kind: 'task' })).items).toHaveLength(0);
    expect((await h.memory.search({ kind: 'task', archived: true })).items).toHaveLength(1);
    const worker = new WorkerService(h.store, new DemoCalendar(), new RoutineService(h.store), h.operations);
    await worker.tick();
    expect((await h.store.jobs()).find((j) => j.payload.taskReminder)?.result).toMatchObject({
      skipped: true,
    });
    expect(await h.store.memoryHistory(task.id)).toHaveLength(2);
    const current = (await h.store.memory(task.id))!;
    await h.memory.execute(
      { kind: 'memory.restore', memoryId: task.id, version: current.version },
      crypto.randomUUID(),
    );
    expect(await h.store.memory(task.id)).toMatchObject({ taskState: 'open', archived: false });
  });
  it('delivers a due task once without calling a model, including after a text revision', async () => {
    const h = setup();
    const task = await h.memory.execute(
      {
        kind: 'memory.create',
        record: memoryInput.parse({
          kind: 'task',
          title: 'Fatura',
          body: 'Faturayı öde.',
          remindAt: new Date(Date.now() - 1000).toISOString(),
        }),
      },
      crypto.randomUUID(),
    );
    const worker = new WorkerService(h.store, new DemoCalendar(), new RoutineService(h.store), h.operations);
    await worker.tick();
    const job = (await h.store.jobs())[0];
    expect(job).toMatchObject({
      status: 'succeeded',
      result: { type: 'task_reminder', llmUsed: false, message: 'Faturayı öde.' },
    });
    await h.memory.execute(
      {
        kind: 'memory.update',
        memoryId: task.id,
        version: task.version,
        record: memoryInput.strip().parse({ ...task, body: 'Ödenecek fatura.' }),
      },
      crypto.randomUUID(),
    );
    await worker.tick();
    expect(await h.store.jobs()).toHaveLength(1);
    expect(h.generate).not.toHaveBeenCalled();
  });
  it('retrieves a known purchase day without fabricating a timestamp', async () => {
    const h = setup();
    const op = await h.operations.submit(
      { kind: 'memory.create', record: { ...input, occurredOn: '2026-10-20' } },
      'known-day',
    );
    await h.operations.execute(op.id);
    expect(await h.store.memory(op.id)).toMatchObject({
      occurredOn: '2026-10-20',
      occurredAt: null,
      timeZone: 'Europe/Istanbul',
    });
    expect(
      (await h.memory.search({ from: '2026-10-20T00:00:00+03:00', to: '2026-10-21T00:00:00+03:00' })).items,
    ).toHaveLength(1);
    expect(
      (await h.memory.search({ from: '2026-10-21T00:00:00+03:00', to: '2026-10-22T00:00:00+03:00' })).items,
    ).toHaveLength(0);
  });
  it('rejects forged creation identities and never sends credential-bearing chat to the model', async () => {
    expect(() =>
      memoryOperation.parse({ kind: 'memory.create', memoryId: crypto.randomUUID(), record: input }),
    ).toThrow();
    const h = setup();
    await expect(
      h.assistant.chat('Anahtarım GOCSPX-' + 'private-fixture', 'blocked-key'),
    ).rejects.toMatchObject({
      status: 400,
    });
    expect(h.generate).not.toHaveBeenCalled();
    expect(await h.store.conversation()).toHaveLength(0);
  });
  it('captures a purchase with provenance and retrieves the original content', async () => {
    const h = setup([
      { group: 'personal-memory' },
      { message: 'Kaydediyorum', action: { kind: 'memory.create', record: input }, read: null },
    ]);
    const result = (await h.assistant.chat(
      '850 TL’ye kulaklık aldım, 2 yıl garantisi var.',
      'telegram:owner-test',
    )) as { operation: { id: string; status: string }; message: string };
    expect(result.operation.status).toBe('succeeded');
    expect(result.message).toContain('Saved to your personal memory');
    const record = await h.store.memory(result.operation.id);
    expect(record).toMatchObject({
      ...input,
      version: 1,
      source: { channel: 'telegram', text: '850 TL’ye kulaklık aldım, 2 yıl garantisi var.' },
    });
    expect((await h.memory.search({ query: 'kulak' })).items[0].id).toBe(record?.id);
  });
  it('updates optimistically, preserves revisions and requires approval for archive', async () => {
    const h = setup();
    const op = await h.operations.submit({ kind: 'memory.create', record: input }, 'record-one');
    await h.operations.execute(op.id);
    const first = (await h.store.memory(op.id))!;
    const update = await h.operations.submit(
      {
        kind: 'memory.update',
        memoryId: first.id,
        version: 1,
        record: { ...input, body: 'Düzeltme: 800 TL ödedim.', amount: '800' },
      },
      'record-update',
    );
    await h.operations.execute(update.id);
    expect((await h.store.memoryHistory(first.id)).map((r) => r.version)).toEqual([2, 1]);
    await expect(
      h.operations.submit(
        { kind: 'memory.update', memoryId: first.id, version: 1, record: input },
        'record-stale',
      ),
    ).rejects.toMatchObject({ status: 409 });
    const archive = await h.operations.submit(
      { kind: 'memory.archive', memoryId: first.id, version: 2 },
      'record-archive',
    );
    expect(archive.status).toBe('queued');
    await h.operations.execute(archive.id);
    expect((await h.memory.search({ query: 'kulaklık' })).items).toEqual([]);
    expect((await h.memory.search({ archived: true })).items).toHaveLength(1);
    const restore = await h.operations.submit(
      { kind: 'memory.restore', memoryId: first.id, version: 3 },
      'restore',
    );
    await h.operations.execute(restore.id);
    expect((await h.memory.search({ query: 'kulaklık' })).items[0].version).toBe(4);
  });
  it('reads the full current record and regenerates a summary-based update', async () => {
    const h = setup();
    const op = await h.operations.submit({ kind: 'memory.create', record: input }, 'seed');
    await h.operations.execute(op.id);
    h.generate
      .mockResolvedValueOnce({ output: { group: 'personal-memory' } })
      .mockResolvedValueOnce({
        output: { message: 'Arıyorum', action: null, read: { kind: 'memories', query: 'kulaklık' } },
      })
      .mockResolvedValueOnce({
        output: {
          message: 'Güncelle',
          read: null,
          action: { kind: 'memory.update', memoryId: op.id, version: 1, record: input },
        },
      });
    h.generate.mockResolvedValueOnce({
      output: {
        message: 'Update after full read',
        action: {
          kind: 'memory.update',
          memoryId: op.id,
          version: 1,
          record: { ...input, summary: 'Updated summary' },
        },
        read: null,
      },
    });
    const reply = (await h.assistant.chat('Kulaklık kaydını güncelle', 'update-without-full-read')) as {
      operation: { status: string };
    };
    expect(reply.operation.status).toBe('succeeded');
    expect(h.generate.mock.calls.at(-1)?.[0]).toContain('"complete":true');
    expect((await h.memory.inspect(op.id)).body).toBe(input.body);
  });
  it('honors an explicit do-not-save instruction even if the model proposes a write', async () => {
    const h = setup([
      { group: 'personal-memory' },
      { message: 'Kayıt', action: { kind: 'memory.create', record: input }, read: null },
    ]);
    await expect(
      h.assistant.chat('Bunu kaydetme, sadece örnek: kulaklık aldım.', 'no-save'),
    ).rejects.toMatchObject({ status: 400 });
    expect((await h.memory.search({})).items).toEqual([]);
  });
  it('does not combine unsupported currencies or invent missing amounts', () => {
    expect(
      memoryInput.parse({ kind: 'purchase', title: 'Bir ürün', body: 'Fiyatı söylemedim.' }),
    ).toMatchObject({ amount: null, currency: null, occurredAt: null });
    expect(() => memoryInput.parse({ ...input, currency: null })).toThrow();
    expect(() => memoryInput.parse({ ...input, amount: 'NaN' })).toThrow();
  });
  it('rejects secret material before writing memory records', async () => {
    const h = setup();
    await expect(
      h.operations.submit(
        { kind: 'memory.create', record: { ...input, body: 'GOCSPX-' + 'do-not-store-this' } },
        'secret',
      ),
    ).rejects.toMatchObject({ status: 400 });
    expect(await h.store.operations()).toHaveLength(0);
    expect((await h.memory.search({})).items).toEqual([]);
  });
});
