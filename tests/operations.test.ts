import { beforeEach, describe, expect, it, vi } from 'vitest';
import { MemoryStore, newJob } from '../server/repositories.js';
import {
  RoutineService,
  OperationService,
  WorkerService,
  nextRun,
  risk,
  validateAction,
  conflicts,
} from '../server/services.js';
import { DemoCalendar } from '../server/google.js';
import { AppError } from '../server/errors.js';
import { eventSchema, type Operation, type Routine } from '../shared/contracts.js';
let store: MemoryStore,
  calendar: DemoCalendar,
  routines: RoutineService,
  operations: OperationService,
  worker: WorkerService;
const event = {
  summary: 'Dişçi',
  start: { dateTime: '2026-10-20T14:00:00+03:00' },
  end: { dateTime: '2026-10-20T15:00:00+03:00' },
};
beforeEach(() => {
  store = new MemoryStore();
  calendar = new DemoCalendar();
  routines = new RoutineService(store);
  operations = new OperationService(store, calendar, routines);
  worker = new WorkerService(store, calendar, routines, operations);
});
describe('operation journal', () => {
  it('directly deletes only a verified single owned event, preserving series/guest approvals', async () => {
    const created = await operations.submit(
      { kind: 'event.create', calendarId: 'primary', event },
      'delete-single-create',
    );
    await operations.execute(created.id);
    const current = (await calendar.inspect('event', 'primary', created.id)) as { id: string; etag: string };
    const action = { kind: 'event.delete', calendarId: 'primary', eventId: current.id, etag: current.etag };
    expect((await operations.submit(action, 'delete-single')).status).toBe('queued');
    expect((await operations.submit({ ...action, scope: 'series' }, 'delete-series')).status).toBe(
      'awaiting_approval',
    );
    expect((await operations.submit({ ...action, notify: true }, 'delete-notify')).status).toBe(
      'awaiting_approval',
    );
  });
  it('executes a duplicate request exactly once', async () => {
    const a = await operations.submit({ kind: 'event.create', calendarId: 'primary', event }, 'duplicate');
    const b = await operations.submit({ event, calendarId: 'primary', kind: 'event.create' }, 'duplicate');
    expect(a.id).toBe(b.id);
    await worker.tick();
    await worker.tick();
    expect(await calendar.events('primary', '2026-10-20T00:00:00Z', '2026-10-21T00:00:00Z')).toHaveLength(1);
  });
  it('rejects idempotency-key reuse with changed content', async () => {
    await operations.submit({ kind: 'event.create', calendarId: 'primary', event }, 'duplicate');
    await expect(
      operations.submit(
        { kind: 'event.create', calendarId: 'primary', event: { ...event, summary: 'Other' } },
        'duplicate',
      ),
    ).rejects.toThrow(/farklı/);
  });
  it('binds approval to content and prevents double approval', async () => {
    const op = await operations.submit({ kind: 'calendar.create', summary: 'Spor' }, 'approval');
    expect(op.status).toBe('awaiting_approval');
    await expect(operations.approve(op.id, 'wrong')).rejects.toThrow();
    await operations.approve(op.id, op.hash);
    await expect(operations.approve(op.id, op.hash)).rejects.toThrow();
    await worker.tick();
    expect((await store.operation(op.id))?.status).toBe('succeeded');
  });
  it('rejects expired approvals', async () => {
    const op = await operations.submit({ kind: 'calendar.create', summary: 'Spor' }, 'approval');
    op.expiresAt = new Date(0).toISOString();
    await store.transition(op, 'awaiting_approval');
    await expect(operations.approve(op.id, op.hash)).rejects.toThrow();
  });
  it('does not execute canceled queued actions', async () => {
    const op = await operations.submit({ kind: 'event.create', calendarId: 'primary', event }, 'cancel');
    await operations.cancel(op.id);
    await worker.tick();
    expect(await calendar.events('primary', '2026-10-20T00:00:00Z', '2026-10-21T00:00:00Z')).toHaveLength(0);
  });
  it('marks transport-ambiguous writes as unknown, never retries automatically', async () => {
    vi.spyOn(calendar, 'execute').mockRejectedValue(new AppError(502, 'Unknown result', true));
    const op = await operations.submit({ kind: 'event.create', calendarId: 'primary', event }, 'unknown');
    await worker.tick();
    await worker.tick();
    expect((await store.operation(op.id))?.status).toBe('unknown');
    expect(calendar.execute).toHaveBeenCalledTimes(1);
  });
  it('rejects stale event ETags', async () => {
    const create = await operations.submit({ kind: 'event.create', calendarId: 'primary', event }, 'create');
    await worker.tick();
    const update = await operations.submit(
      { kind: 'event.update', calendarId: 'primary', eventId: create.id, etag: 'wrong', event },
      'update',
    );
    await worker.tick();
    expect((await store.operation(update.id))?.status).toBe('failed');
  });
  it('requires approval for recurrence, guests, invitations and deletion', () => {
    for (const patch of [
      { scope: 'series' },
      { notify: true },
      { event: { ...event, attendees: [{ email: 'ayse@example.org' }] } },
      { kind: 'event.delete', eventId: 'a', etag: 'b' },
    ])
      expect(
        risk(
          validateAction({
            kind: 'event.create',
            calendarId: 'primary',
            event,
            ...patch,
            ...('scope' in patch ? { kind: 'event.update', eventId: 'a', etag: 'b' } : {}),
          }),
        ),
      ).toBe('high');
  });
  it('does not let skills change executable security settings', () => {
    expect(() =>
      validateAction({
        kind: 'preferences.update',
        timeZone: 'Europe/Istanbul',
        language: 'tr',
        AGY_ENABLED: true,
      }),
    ).toThrow();
  });
});
describe('routine scheduler', () => {
  it('seeds disabled routines only once', async () => {
    await routines.seed();
    await routines.seed();
    const r = await store.routines();
    expect(r).toHaveLength(2);
    expect(r.every((x) => !x.enabled)).toBe(true);
  });
  it('calculates Istanbul and London DST transitions', () => {
    expect(nextRun('0 8 * * *', 'Europe/Istanbul', new Date('2026-10-19T12:00:00Z'))).toBe(
      '2026-10-20T05:00:00.000Z',
    );
    expect(nextRun('0 8 * * *', 'Europe/London', new Date('2026-10-24T12:00:00Z'))).toBe(
      '2026-10-25T08:00:00.000Z',
    );
  });
  it('rejects invalid cron or timezone', () => {
    expect(() => nextRun('* * * * * *', 'Europe/Istanbul')).toThrow();
    expect(() => nextRun('0 8 * * *', 'Invalid')).toThrow();
  });
  it('prevents stale routine edits', async () => {
    await routines.seed();
    const r = (await store.routines())[0];
    await routines.execute(
      {
        kind: 'routine.update',
        routineId: r.id,
        version: r.version,
        routine: { name: r.name, kind: r.kind, cron: r.cron, timeZone: r.timeZone, enabled: true },
      },
      'first',
    );
    await expect(
      routines.execute({ kind: 'routine.delete', routineId: r.id, version: r.version }, 'second'),
    ).rejects.toThrow();
  });
  it('does not duplicate a due routine when scheduling twice', async () => {
    await routines.seed();
    const r = (await store.routines())[0];
    await store.saveRoutine(
      { ...r, enabled: true, nextRun: new Date(Date.now() - 1000).toISOString() },
      r.version,
    );
    await Promise.all([routines.schedule(), routines.schedule()]);
    expect(await store.jobs()).toHaveLength(1);
  });
  it('skips queued scheduled work after pausing', async () => {
    await routines.seed();
    const r = (await store.routines())[0];
    const active = { ...r, enabled: true };
    await store.enqueue(newJob('routine', 'scheduled:test', { routine: active }));
    const read = vi.spyOn(calendar, 'events');
    await worker.tick();
    expect(read).not.toHaveBeenCalled();
    expect((await store.jobs())[0].result).toHaveProperty('skipped', true);
  });
  it('allows explicit manual execution of a disabled routine', async () => {
    await routines.seed();
    const r = (await store.routines())[0];
    await routines.execute({ kind: 'routine.run', routineId: r.id, version: r.version }, 'manual');
    await worker.tick();
    expect((await store.jobs())[0].status).toBe('succeeded');
  });
  it('skips old missed runs instead of flooding summaries', async () => {
    await routines.seed();
    const r = (await store.routines())[0];
    await store.saveRoutine({ ...r, enabled: true, nextRun: '2020-01-01T00:00:00Z' }, r.version);
    await routines.schedule();
    expect(await store.jobs()).toHaveLength(0);
    expect(Date.parse((await store.routines())[0].nextRun)).toBeGreaterThan(Date.now());
  });
});
describe('dates and conflicts', () => {
  it('requires exclusive all-day ends', () => {
    expect(
      eventSchema.safeParse({ summary: 'Tatil', start: { date: '2026-10-20' }, end: { date: '2026-10-20' } })
        .success,
    ).toBe(false);
    expect(
      eventSchema.safeParse({ summary: 'Tatil', start: { date: '2026-10-20' }, end: { date: '2026-10-21' } })
        .success,
    ).toBe(true);
  });
  it('rejects mixed all-day and timed boundaries', () => {
    expect(eventSchema.safeParse({ ...event, start: { date: '2026-10-20' } }).success).toBe(false);
  });
  it('detects overlapping meetings but ignores transparent ones', () => {
    const a = { ...event, id: 'a', calendarId: 'primary' };
    expect(conflicts([a, { ...a, id: 'b', summary: 'Spor' }])).toHaveLength(1);
    expect(conflicts([a, { ...a, id: 'b', transparency: 'transparent' }])).toHaveLength(0);
  });
});
