import { describe, it, expect, vi } from 'vitest';
import { MemoryStore } from '../server/repositories';
import { DemoCalendar } from '../server/google';
import { RoutineService, OperationService, WorkerService, validateAction, nextRun } from '../server/services';
function setup() {
  const store = new MemoryStore(),
    calendar = new DemoCalendar(),
    routines = new RoutineService(store),
    operations = new OperationService(store, calendar, routines),
    worker = new WorkerService(store, calendar, routines, operations);
  return { store, calendar, routines, operations, worker };
}
const input = {
  name: 'Sabah hatırlatması',
  kind: 'reminder',
  message: 'Hapını iç.',
  cron: '0 7 * * *',
  timeZone: 'Europe/Istanbul',
  enabled: true,
} as const;
describe('deterministic reminders', () => {
  it('fires at 07:00 Istanbul without calendar access or a model dependency', async () => {
    const h = setup();
    const read = vi.spyOn(h.calendar, 'events');
    expect(nextRun(input.cron, input.timeZone, new Date('2026-10-19T12:00:00Z'))).toBe(
      '2026-10-20T04:00:00.000Z',
    );
    const op = await h.operations.submit({ kind: 'routine.create', routine: input }, 'reminder-create');
    await h.worker.tick();
    const r = (await h.store.routines())[0];
    await h.store.saveRoutine({ ...r, nextRun: new Date(Date.now() - 1000).toISOString() }, r.version);
    await h.worker.tick();
    expect((await h.store.jobs()).find((j) => j.kind === 'routine')?.result).toEqual({
      type: 'reminder',
      title: input.name,
      message: input.message,
      execution: 'deterministic',
      llmUsed: false,
    });
    expect(read).not.toHaveBeenCalled();
    expect((await h.store.operation(op.id))?.status).toBe('succeeded');
  });
  it('requires reminder text', () => {
    expect(() =>
      validateAction({ kind: 'routine.create', routine: { ...input, message: undefined } }),
    ).toThrow('Hatırlatma metni');
  });
  it('preserves text while pausing and changing time', async () => {
    const h = setup();
    await h.operations.submit({ kind: 'routine.create', routine: input }, 'create');
    await h.worker.tick();
    const r = (await h.store.routines())[0];
    await h.operations.submit(
      {
        kind: 'routine.update',
        routineId: r.id,
        version: r.version,
        routine: { ...input, cron: '0 8 * * *', enabled: false },
      },
      'change',
    );
    await h.worker.tick();
    expect((await h.store.routines())[0]).toMatchObject({
      message: input.message,
      enabled: false,
      cron: '0 8 * * *',
    });
  });
});
