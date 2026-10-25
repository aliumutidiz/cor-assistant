import { describe, it, expect, vi } from 'vitest';
import { upcomingWeekRange } from '../shared/time.js';
import { MemoryStore, newJob } from '../server/repositories.js';
import { DemoCalendar } from '../server/google.js';
import { OperationService, RoutineService, WorkerService, validateAction } from '../server/services.js';
import { routineReport } from '../server/routine-report.js';
import type { Routine } from '../shared/contracts.js';
import { AppError } from '../server/errors.js';

function fixture(kind: Routine['kind']) {
  const store = new MemoryStore(),
    calendar = new DemoCalendar(),
    routines = new RoutineService(store);
  const operation = new OperationService(store, calendar, routines);
  const report = vi.fn().mockResolvedValue({ message: 'Haftanı inceledim.', llmUsed: true });
  const worker = new WorkerService(store, calendar, routines, operation, report);
  const routine: Routine = {
    id: crypto.randomUUID(),
    name: 'Rapor',
    kind,
    cron: '0 18 * * 0',
    timeZone: 'Europe/Istanbul',
    enabled: false,
    version: 1,
    nextRun: '2030-01-01T00:00:00Z',
    updatedAt: new Date().toISOString(),
    message: 'İyi geceler.',
  };
  return { store, calendar, routines, report, worker, routine };
}
describe('read-only AI routines', () => {
  it('keeps fixed reminders running while an AI report is waiting for the model', async () => {
    const h = fixture('ai_weekly_summary');
    await h.store.saveRoutine(h.routine);
    await h.routines.execute({ kind: 'routine.run', routineId: h.routine.id, version: 1 }, 'report');
    let release!: () => void, began!: () => void;
    const started = new Promise<void>((resolve) => {
      began = resolve;
    });
    h.report.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ message: 'Rapor hazır.', llmUsed: true });
          began();
        }),
    );
    const background = h.worker.tickReports();
    await started;
    const fixed = { ...h.routine, id: crypto.randomUUID(), kind: 'reminder' as const };
    await h.store.saveRoutine(fixed);
    await h.routines.execute({ kind: 'routine.run', routineId: fixed.id, version: 1 }, 'fixed');
    await h.worker.tick();
    const jobs = await h.store.jobs();
    expect(jobs.find((j) => j.kind === 'ai_report')?.status).toBe('running');
    expect(jobs.find((j) => j.kind === 'routine')).toMatchObject({
      status: 'succeeded',
      result: { llmUsed: false },
    });
    release();
    await background;
    expect((await h.store.pendingNotifications('2000-01-01T00:00:00Z')).jobs).toHaveLength(2);
  });
  it('resolves the upcoming Monday–Sunday week in local time, including DST', () => {
    expect(upcomingWeekRange('Europe/Istanbul', new Date('2026-10-25T19:00:00Z'))).toEqual({
      from: '2026-10-25T21:00:00.000Z',
      to: '2026-11-01T21:00:00.000Z',
    });
    expect(upcomingWeekRange('Europe/London', new Date('2026-10-23T12:00:00Z'))).toEqual({
      from: '2026-10-26T00:00:00.000Z',
      to: '2026-11-02T00:00:00.000Z',
    });
  });
  it.each(['reminder', 'weekly_summary', 'daily_summary'] as const)(
    'does not call AGY for %s',
    async (kind) => {
      const h = fixture(kind);
      await h.store.saveRoutine(h.routine);
      await h.store.enqueue(newJob('routine', 'manual:fixed', { routine: h.routine }));
      await h.worker.tick();
      expect(h.report).not.toHaveBeenCalled();
      expect((await h.store.jobs())[0].status).toBe('succeeded');
    },
  );
  it('reads fresh calendar data, runs one AI report and retains failures instead of inventing success', async () => {
    const h = fixture('ai_weekly_summary');
    const read = vi.spyOn(h.calendar, 'events').mockResolvedValue([]);
    const write = vi.spyOn(h.calendar, 'execute');
    await h.store.saveRoutine(h.routine);
    await h.store.enqueue(newJob('routine', 'manual:ai', { routine: h.routine }));
    await h.worker.tick();
    expect(read).toHaveBeenCalledOnce();
    expect(h.report).toHaveBeenCalledOnce();
    expect(write).not.toHaveBeenCalled();
    expect((await h.store.jobs())[0].result).toMatchObject({ llmUsed: true });
    h.report.mockRejectedValueOnce(new AppError(503, 'AGY oturumu açılmalı.'));
    await h.store.enqueue(newJob('routine', 'manual:failed', { routine: h.routine }));
    await h.worker.tick();
    expect((await h.store.jobs()).find((j) => j.key === 'manual:failed')).toMatchObject({
      status: 'failed',
      error: 'AGY oturumu açılmalı.',
    });
  });
  it('bounds report content and rejects action-bearing model output', async () => {
    const h = fixture('ai_weekly_summary');
    const generate = vi.fn().mockResolvedValue({ output: { message: 'Bu aralıkta etkinliğin yok.' } });
    const result = await routineReport(
      { generate },
      { routine: h.routine, from: '2026-10-26T00:00:00+03:00', to: '2026-11-02T00:00:00+03:00', events: [] },
      AbortSignal.timeout(2000),
    );
    expect(result).toMatchObject({ llmUsed: true, eventCount: 0 });
    expect(generate.mock.calls[0][0]).not.toContain('assistant.history');
    generate.mockResolvedValueOnce({
      output: {
        message: JSON.stringify({ message: 'Bu aralıkta etkinliğin yok.', action: null, read: null }),
      },
    });
    expect(
      (
        await routineReport(
          { generate },
          { routine: h.routine, from: '', to: '', events: [] },
          AbortSignal.timeout(3000),
        )
      ).message,
    ).toBe('Bu aralıkta etkinliğin yok.');
    generate.mockResolvedValue({ output: { message: 'Sildim', action: { kind: 'calendar.clear' } } });
    await expect(
      routineReport(
        { generate },
        { routine: h.routine, from: '', to: '', events: [] },
        AbortSignal.timeout(3000),
      ),
    ).rejects.toThrow();
  });
  it('rejects wasteful minute-by-minute AI scheduling', () => {
    expect(() =>
      validateAction({
        kind: 'routine.create',
        routine: { name: 'AI', kind: 'ai_weekly_summary', cron: '* * * * *' },
      }),
    ).toThrow(/saatte/);
  });
  it('includes bounded personal evidence, communication preferences and explicit truncation', async () => {
    const h = fixture('ai_daily_summary');
    const generate = vi.fn().mockResolvedValue({output:{message:'Your available records have been checked.'}});
    const result = await routineReport({generate},{routine:h.routine,from:'2030-01-01T00:00:00Z',to:'2030-01-02T00:00:00Z',events:[],communication:{language:'en',displayName:'Alex'},personal:{tasks:[{title:'Renew membership'}],reminders:[{title:'Collect package'}],profile:'Prefer brief replies',programs:[{title:'Oversized program',occurrences:['x'.repeat(20000)]}],partial:false}},AbortSignal.timeout(3000));
    const prompt=generate.mock.calls[0][0] as string;
    expect(prompt).toContain('Renew membership');
    expect(prompt).toContain('Collect package');
    expect(prompt).toContain('"language":"en"');
    expect(prompt).not.toContain('x'.repeat(20000));
    expect(prompt).toContain('"partial":true');
    expect(result.truncated).toBe(true);
  });
});
