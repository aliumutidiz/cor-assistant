import { PGlite } from '@electric-sql/pglite';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { readFile, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type pg from 'pg';
import { PostgresStore, newJob } from '../server/repositories.js';
import { RoutineService, OperationService, WorkerService } from '../server/services.js';
import { DemoCalendar } from '../server/google.js';
let db: PGlite, store: PostgresStore, path: string;
function connect() {
  store = new PostgresStore({
    query: async (sql: string, params?: unknown[]) => {
      const result = await db.query(sql, params);
      return { ...result, rowCount: result.affectedRows };
    },
    end: async () => {
      await db.close();
    },
  } as unknown as pg.Pool);
}
beforeAll(async () => {
  path = await mkdtemp(join(tmpdir(), 'cor-pg-'));
  db = new PGlite(path);
  await db.exec(await readFile(new URL('../server/schema.sql', import.meta.url), 'utf8'));
  connect();
}, 30000);
afterAll(async () => {
  await db.close();
  await rm(path, { recursive: true, force: true });
});
describe('PostgreSQL repository against an embedded PostgreSQL engine', () => {
  it('persists structured profile records and retrieves Turkish evidence across the full archive', async () => {
    const { PersonalMemory } = await import('../server/memory-service.js');
    const { memoryInput } = await import('../shared/memory.js');
    const memory = new PersonalMemory(store);
    const record = await memory.execute(
      {
        kind: 'memory.create',
        record: memoryInput.parse({
          kind: 'profile',
          title: 'İstanbul ulaşım tercihi',
          body: 'İstanbul içinde vapur tercih ederim.',
          profile: { category: 'preference' },
        }),
      },
      crypto.randomUUID(),
    );
    expect((await store.recall('istanbul vapur')).some((row) => row.id === record.id)).toBe(true);
    await store.appendConversation(
      'chat:telegram:profile-fixture',
      'Vapurla İstanbul yolculuğu',
      'Kayıtlı tercih.',
    );
    expect((await store.recallConversation('istanbul vapur'))[0]).toMatchObject({ channel: 'telegram' });
    expect((await memory.profileContext()).statements.some((row) => row.id === record.id)).toBe(true);
    // The schema is safe to re-apply without replacing the durable records.
    await db.exec(await readFile(new URL('../server/schema.sql', import.meta.url), 'utf8'));
    expect((await store.memory(record.id))?.profile?.category).toBe('preference');
    const list = await memory.execute(
      {
        kind: 'memory.create',
        record: memoryInput.parse({
          kind: 'shopping_list',
          title: 'Market',
          body: 'Alınacaklar',
          shopping: { items: [{ id: crypto.randomUUID(), name: 'Süt', quantity: '2 litre' }] },
        }),
      },
      crypto.randomUUID(),
    );
    expect((await memory.search({ query: 'sut' })).items.some((row) => row.id === list.id)).toBe(true);
    expect((await store.recall('süt')).some((row) => row.id === list.id)).toBe(true);
  });
  it('persists typed memory, indexed Turkish retrieval, atomic revisions and voice quotas', async () => {
    const memory = new (await import('../server/memory-service.js')).PersonalMemory(store);
    const operations = new OperationService(store, new DemoCalendar(), new RoutineService(store));
    const create = await operations.submit(
      {
        kind: 'memory.create',
        record: {
          kind: 'idea',
          title: 'Ortak ekipman',
          body: 'Mahallede ekipman kiralama fikri.',
          summary: 'Paylaşımlı araçlar',
          tags: ['proje'],
          occurredOn: '2026-10-20',
        },
      },
      'pg-memory',
    );
    await operations.execute(create.id);
    const queued = await store.claim(['operation']);
    expect(queued?.payload.operationId).toBe(create.id);
    await store.finish({ ...queued!, status: 'succeeded' });
    const found = await memory.search({ query: 'ekipman' });
    expect(found.items[0].id).toBe(create.id);
    expect(
      (await memory.search({ from: '2026-10-20T00:00:00+03:00', to: '2026-10-21T00:00:00+03:00' })).items[0]
        .id,
    ).toBe(create.id);
    expect((await memory.search({ query: 'proje' })).items[0].id).toBe(create.id);
    const unicode = await operations.submit(
      {
        kind: 'memory.create',
        record: {
          kind: 'fact',
          title: 'IŞIK ÇALIŞMASI',
          body: 'Özgün kayıt.',
          summary: '',
          tags: ['İstanbul'],
        },
      },
      'pg-memory-turkish',
    );
    await operations.execute(unicode.id);
    const unicodeJob = await store.claim(['operation']);
    await store.finish({ ...unicodeJob!, status: 'succeeded' });
    for (const query of ['ışık', 'isik', 'çalışma', 'calisma', 'istanbul'])
      expect((await memory.search({ query })).items.some((r) => r.id === unicode.id)).toBe(true);
    const first = found.items[0];
    const revised = {
      ...first,
      version: 2,
      body: 'Kiralama fikri, önce küçük pilot.',
      updatedAt: new Date().toISOString(),
    };
    const operationId = crypto.randomUUID();
    await store.saveMemory(revised, 1, operationId);
    await store.saveMemory(revised, 1, operationId);
    expect((await store.memoryHistory(first.id)).map((r) => r.version)).toEqual([2, 1]);
    await expect(store.saveMemory({ ...revised, version: 3 }, 1, crypto.randomUUID())).rejects.toMatchObject({
      status: 409,
    });
    await db.close();
    db = new PGlite(path);
    connect();
    expect((await store.memory(first.id))?.body).toContain('küçük pilot');
    expect(await Promise.all(Array.from({ length: 5 }, () => store.reserveVoice('fixture-day', 2)))).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
  });
  it('persists due tasks, deduplicates reminders and preserves completed task history', async () => {
    const memory = new (await import('../server/memory-service.js')).PersonalMemory(store);
    const input = (await import('../shared/memory.js')).memoryInput.parse({
      kind: 'task',
      title: 'Fatura',
      body: 'Faturayı öde.',
      remindAt: '2026-01-01T12:00:00+03:00',
    });
    const task = await memory.execute({ kind: 'memory.create', record: input }, crypto.randomUUID());
    expect(task.remindAt).toBe('2026-01-01T09:00:00.000Z');
    expect((await store.dueTasks('2026-02-01T00:00:00Z')).map((r) => r.id)).toContain(task.id);
    await memory.schedule();
    expect(await store.dueTasks('2026-02-01T00:00:00Z')).toHaveLength(0);
    const job = await store.claim(['routine']);
    expect(job?.payload.taskReminder?.memoryId).toBe(task.id);
    await store.finish({ ...job!, status: 'succeeded', finishedAt: new Date().toISOString() });
    await memory.execute(
      { kind: 'memory.complete', memoryId: task.id, version: task.version },
      crypto.randomUUID(),
    );
    await db.close();
    db = new PGlite(path);
    connect();
    await db.exec(await readFile(new URL('../server/schema.sql', import.meta.url), 'utf8'));
    expect(await store.memory(task.id)).toMatchObject({ taskState: 'done', archived: true });
    expect(await store.memoryHistory(task.id)).toHaveLength(2);
  });
  it('persists full conversation and paginates after a database restart', async () => {
    const text = 'full-message '.repeat(700);
    await store.appendConversation('pg-conversation', text, 'stored answer');
    await store.appendConversation('pg-conversation', text, 'duplicate');
    await db.close();
    db = new PGlite(path);
    connect();
    const last = await store.conversation(1);
    expect(last[0].text).toBe('stored answer');
    expect((await store.conversation(1, last[0].id))[0].text).toBe(text);
  });
  it('persists disabled routines across database restart', async () => {
    await new RoutineService(store).seed();
    await db.close();
    db = new PGlite(path);
    connect();
    expect(await store.routines()).toHaveLength(2);
    expect((await store.routines())[0].enabled).toBe(false);
  });
  it('claims a queue entry only once', async () => {
    await store.enqueue(newJob('routine', 'postgres-claim', { routine: (await store.routines())[0] }));
    const first = await store.claim();
    const second = await store.claim();
    expect(first?.status).toBe('running');
    expect(second).toBeUndefined();
    await store.finish({ ...first!, status: 'succeeded' });
  });
  it('deduplicates operation inserts and executes a durable job', async () => {
    const calendar = new DemoCalendar(),
      routines = new RoutineService(store),
      operations = new OperationService(store, calendar, routines),
      worker = new WorkerService(store, calendar, routines, operations);
    const action = { kind: 'preferences.update', timeZone: 'Europe/London', language: 'tr' };
    const a = await operations.submit(action, 'postgres-idem');
    const b = await operations.submit(action, 'postgres-idem');
    expect(a.id).toBe(b.id);
    await worker.tick();
    expect((await store.operation(a.id))?.status).toBe('succeeded');
    expect(await store.get('preferences')).toHaveProperty('timeZone', 'Europe/London');
  });
  it('consumes OAuth state atomically', async () => {
    await store.putTransient(
      'oauth-test',
      { verifier: 'not-a-token' },
      new Date(Date.now() + 60000).toISOString(),
    );
    expect(await store.takeTransient('oauth-test')).toEqual({ verifier: 'not-a-token' });
    expect(await store.takeTransient('oauth-test')).toBeUndefined();
  });
  it('preserves event cache and sync token together', async () => {
    await store.saveCache('primary', 'next-token', []);
    expect(await store.cache('primary')).toMatchObject({ token: 'next-token', events: [] });
  });
  it('does not replay expired running work', async () => {
    await store.enqueue(newJob('routine', 'expired-job', { routine: (await store.routines())[0] }));
    await store.claim();
    await db.query("UPDATE jobs SET started_at=now()-interval '11 minutes' WHERE job_key='expired-job'");
    await store.recover();
    expect((await store.jobs()).find((j) => j.key === 'expired-job')?.status).toBe('unknown');
    expect(await store.claim()).toBeUndefined();
  });
  it('enforces optimistic routine revisions', async () => {
    const r = (await store.routines())[0];
    await store.saveRoutine({ ...r, version: r.version + 1 }, r.version);
    await expect(store.saveRoutine({ ...r, version: r.version + 1 }, r.version)).rejects.toThrow();
  });
  it('partitions Telegram jobs and persists retry_after scheduling', async () => {
    const job = newJob('telegram_outgoing', 'pg-telegram-send', { telegram: { text: 'Hatırlatma' } });
    await store.enqueue(job);
    expect(await store.claim()).toBeUndefined();
    const claimed = await store.claim(['telegram_outgoing']);
    expect(claimed?.id).toBe(job.id);
    await store.finish({
      ...claimed!,
      status: 'queued',
      scheduledAt: new Date(Date.now() + 60000).toISOString(),
    });
    expect(await store.claim(['telegram_outgoing'])).toBeUndefined();
  });
  it('collects unnotified routine results using the durable outbox key', async () => {
    const finished = new Date().toISOString();
    const r = (await store.routines())[0];
    const job = {
      ...newJob('routine', 'pg-notification-fixture', { routine: r }),
      status: 'succeeded' as const,
      finishedAt: finished,
      result: { message: 'Özet' },
    };
    await store.enqueue(job);
    expect((await store.pendingNotifications(finished)).jobs.some((j) => j.id === job.id)).toBe(true);
    await store.enqueue(newJob('telegram_outgoing', 'tg:job:' + job.id, { telegram: { text: 'Özet' } }));
    expect((await store.pendingNotifications(finished)).jobs.some((j) => j.id === job.id)).toBe(false);
  });
  it('persists independent reminders across database restart and enforces optimistic cancellation', async () => {
    const { ReminderService } = await import('../server/reminder-service.js');
    const service = new ReminderService(store, new DemoCalendar());
    const id = crypto.randomUUID();
    const record = await service.execute(
      {
        kind: 'reminder.create',
        reminder: {
          title: 'Kalıcı bildirim',
          message: 'Veritabanında sakla',
          remindAt: new Date(Date.now() + 3600000).toISOString(),
          enabled: true,
        },
      },
      id,
    );
    await db.close();
    db = new PGlite(path);
    connect();
    expect(await store.reminder(id)).toMatchObject({
      id,
      title: record.title,
      state: 'scheduled',
      version: 1,
    });
    const restarted = new ReminderService(store, new DemoCalendar());
    await restarted.execute({ kind: 'reminder.cancel', reminderId: id, version: 1 }, crypto.randomUUID());
    await expect(
      restarted.execute({ kind: 'reminder.cancel', reminderId: id, version: 1 }, crypto.randomUUID()),
    ).rejects.toMatchObject({ status: 409 });
    expect((await store.reminder(id))?.state).toBe('canceled');
  });
});
