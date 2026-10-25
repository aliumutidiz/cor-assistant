import { canonicalLanguage } from '../shared/languages.js';
import { randomUUID } from 'node:crypto';
import { CronExpressionParser } from 'cron-parser';
import {
  operationSchema,
  routineInput,
  type Action,
  type Routine,
  type Operation,
  type CalendarEvent,
  type Job,
} from '../shared/contracts.js';
import { digest } from './crypto.js';
import type { CalendarGateway } from './google.js';
import { newJob, type Store } from './repositories.js';
import { AppError } from './errors.js';
import { localDayRange, localDateRange, upcomingWeekRange } from '../shared/time.js';
import type { ReportInput } from './routine-report.js';
import { PersonalMemory } from './memory-service.js';
import { memoryInput } from '../shared/memory.js';
import { containsCredential } from './sensitive.js';
import { ReminderService } from './reminder-service.js';
export function nextRun(cron: string, timeZone: string, from = new Date()) {
  try {
    if (cron.trim().split(/\s+/).length !== 5) throw Error();
    return CronExpressionParser.parse(cron, { tz: timeZone, currentDate: from }).next().toISOString()!;
  } catch {
    throw new AppError(400, 'Geçerli, beş alanlı bir cron zamanlaması gerekli.');
  }
}
export function risk(a: Action): 'normal' | 'high' {
  if (a.kind.startsWith('reminder.')) return 'normal';
  if (
    a.kind === 'memory.create' ||
    a.kind === 'memory.update' ||
    a.kind === 'memory.restore' ||
    a.kind === 'memory.complete'
  )
    return 'normal';
  if (a.kind === 'memory.archive') return 'normal';
  if (
    a.kind === 'preferences.update' ||
    a.kind === 'routine.create' ||
    a.kind === 'routine.update' ||
    a.kind === 'routine.run'
  )
    return 'normal';
  if (a.kind === 'routine.delete') return 'normal';
  if (a.kind.startsWith('sharing.') || a.kind.startsWith('calendar.')) return 'high';
  if (
    'scope' in a &&
    (a.scope !== 'single' ||
      a.notify ||
      a.conference ||
      a.kind === 'event.delete' ||
      a.kind === 'event.move' ||
      a.kind === 'event.respond' ||
      a.event?.recurrence?.length ||
      a.event?.visibility === 'public' ||
      a.event?.guestsCanModify ||
      a.event?.attendees?.length)
  )
    return 'high';
  return 'normal';
}
export function validateAction(input: unknown): Action {
  const a = operationSchema.parse(input);
  if (a.kind === 'preferences.update' && containsCredential(JSON.stringify(a)))
    throw new AppError(400, 'Connection credentials cannot be saved in the communication profile.');
  if ('reminder' in a && containsCredential(JSON.stringify(a.reminder)))
    throw new AppError(400, 'Bağlantı sırları hatırlatmalara kaydedilemez.');
  if (
    a.kind === 'memory.create' ||
    a.kind === 'memory.update' ||
    a.kind === 'memory.complete' ||
    a.kind === 'memory.archive' ||
    a.kind === 'memory.restore'
  ) {
    if (a.kind !== 'memory.create' && (!a.memoryId || !a.version))
      throw new AppError(400, 'Kayıt kimliği ve güncel sürümü gerekli.');
    if (a.kind === 'memory.create' || a.kind === 'memory.update') {
      const record = memoryInput.parse(a.record);
      if (containsCredential(JSON.stringify(record)))
        throw new AppError(400, 'Bağlantı sırları kişisel hafızaya kaydedilemez.');
    }
  }
  if ('scope' in a) {
    if (a.telegramReminderMinutes !== undefined && !['event.create', 'event.update'].includes(a.kind))
      throw new AppError(
        400,
        'Hatırlatma ayarı yalnızca etkinlik oluştururken veya düzenlerken kullanılabilir.',
      );
    if (typeof a.telegramReminderMinutes === 'number' && a.event && !a.event.recurrence?.length) {
      const day = a.event.start.date;
      const start =
        a.event.start.dateTime ??
        localDateRange(
          day!,
          new Date(Date.parse(day + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10),
          a.event.start.timeZone ?? 'Europe/Istanbul',
        ).from;
      if (Date.parse(start) - a.telegramReminderMinutes * 60000 <= Date.now())
        throw new AppError(400, 'Hatırlatma zamanı geçmişte kalıyor. Daha yakın bir zaman seç.');
    }
    if (a.kind !== 'event.create' && (!a.eventId || !a.etag))
      throw new AppError(400, 'Etkinlik ve güncel sürümü gerekli.');
    if (['event.create', 'event.update'].includes(a.kind) && !a.event)
      throw new AppError(400, 'Etkinlik ayrıntıları gerekli.');
    if (a.kind === 'event.move' && !a.destination) throw new AppError(400, 'Hedef takvim gerekli.');
    if (a.kind === 'event.respond' && !a.response) throw new AppError(400, 'Katılım yanıtı gerekli.');
    if (a.scope === 'following' && !a.instanceStart)
      throw new AppError(400, 'Seri örneğinin başlangıcı gerekli.');
    if (a.kind === 'event.create' && a.scope !== 'single')
      throw new AppError(400, 'Yeni etkinlikte seri hedefi kullanılamaz.');
  }
  if ('summary' in a || a.kind.startsWith('calendar.')) {
    const c = a as Extract<Action, { summary?: string }>;
    if (c.kind !== 'calendar.create' && !c.calendarId) throw new AppError(400, 'Takvim kimliği gerekli.');
    if (['calendar.create', 'calendar.update'].includes(c.kind) && !c.summary)
      throw new AppError(400, 'Takvim adı gerekli.');
    if (['calendar.update', 'calendar.delete'].includes(c.kind) && !c.etag)
      throw new AppError(400, 'Takvimin güncel ETag değeri gerekli.');
  }
  if (a.kind === 'sharing.set') {
    if (
      !a.role ||
      (['user', 'group'].includes(a.scopeType) && !a.email) ||
      (a.scopeType === 'domain' && !a.domain)
    )
      throw new AppError(400, 'Paylaşım hedefi ve rol gerekli.');
    if (a.ruleId && !a.etag) throw new AppError(400, 'Mevcut paylaşım için güncel sürüm gerekli.');
  }
  if (a.kind === 'sharing.delete' && (!a.ruleId || !a.etag))
    throw new AppError(400, 'Paylaşım kimliği ve sürümü gerekli.');
  if ('routineId' in a || a.kind.startsWith('routine.')) {
    const r = a as Extract<Action, { routineId?: string }>;
    if (r.kind !== 'routine.create' && (!r.routineId || !r.version))
      throw new AppError(400, 'Rutin ve güncel sürümü gerekli.');
    if (['routine.create', 'routine.update'].includes(r.kind) && !r.routine)
      throw new AppError(400, 'Rutin tanımı gerekli.');
    if (r.routine) nextRun(r.routine.cron, r.routine.timeZone);
    if (r.routine?.kind.startsWith('ai_')) {
      const first = nextRun(r.routine.cron, r.routine.timeZone);
      if (
        Date.parse(nextRun(r.routine.cron, r.routine.timeZone, new Date(first))) - Date.parse(first) <
        3600000
      )
        throw new AppError(400, 'AI raporları en sık saatte bir çalışabilir.');
    }
    if (r.routine?.kind === 'reminder' && !r.routine.message)
      throw new AppError(400, 'Hatırlatma metni gerekli.');
  }
  return a;
}
export class RoutineService {
  constructor(private store: Store) {}
  async seed() {
    if (await this.store.get('seeded')) return;
    for (const input of [
      { name: 'Güne bakış', cron: '0 8 * * *', kind: 'daily_summary' },
      { name: 'Haftaya bakış', cron: '0 18 * * 0', kind: 'weekly_summary' },
    ]) {
      const x = routineInput.parse(input);
      await this.store.saveRoutine({
        ...x,
        id: randomUUID(),
        version: 1,
        nextRun: nextRun(x.cron, x.timeZone),
        updatedAt: new Date().toISOString(),
      });
    }
    await this.store.set('seeded', true);
  }
  async execute(a: Extract<Action, { routineId?: string }>, operationId: string) {
    const old = (await this.store.routines()).find((r) => r.id === a.routineId);
    if (a.kind !== 'routine.create' && (!old || old.version !== a.version))
      throw new AppError(409, 'Rutin değişmiş. Güncel sürümü seçin.');
    if (a.kind === 'routine.delete') {
      await this.store.set('routine.deleted:' + operationId, old);
      await this.store.deleteRoutine(old!.id, a.version!);
      return { deleted: true };
    }
    if (a.kind === 'routine.run') {
      await this.store.enqueue(
        newJob(old!.kind.startsWith('ai_') ? 'ai_report' : 'routine', 'manual:' + operationId, {
          routine: old!,
        }),
      );
      return { queued: true };
    }
    const input = routineInput.parse(a.routine);
    const r: Routine = {
      ...input,
      id: old?.id ?? randomUUID(),
      version: (old?.version ?? 0) + 1,
      nextRun: nextRun(input.cron, input.timeZone),
      updatedAt: new Date().toISOString(),
    };
    await this.store.saveRoutine(r, old?.version);
    return r;
  }
  async schedule() {
    for (const r of await this.store.routines()) {
      if (!r.enabled || Date.parse(r.nextRun) > Date.now()) continue;
      const lateness = Date.now() - Date.parse(r.nextRun);
      if (lateness < 15 * 60000)
        await this.store.enqueue(
          newJob(
            r.kind.startsWith('ai_') ? 'ai_report' : 'routine',
            `routine:${r.id}:${r.version}:${r.nextRun}`,
            { routine: r },
            r.nextRun,
          ),
        );
      const next = {
        ...r,
        version: r.version + 1,
        nextRun: nextRun(r.cron, r.timeZone),
        updatedAt: new Date().toISOString(),
      };
      try {
        await this.store.saveRoutine(next, r.version);
      } catch (e) {
        if (!(e instanceof AppError && e.status === 409)) throw e;
      }
    }
  }
}
export class OperationService {
  readonly reminders: ReminderService;
  constructor(
    private store: Store,
    private calendar: CalendarGateway,
    private routines: RoutineService,
  ) {
    this.reminders = new ReminderService(store, calendar);
  }
  async submit(input: unknown, key: string) {
    const action = validateAction(input),
      hash = digest(action),
      now = new Date().toISOString();
    const existing = await this.store.operationForKey(key);
    if (existing) {
      if (existing.hash !== hash) throw new AppError(409, 'Aynı istek anahtarı farklı içerikle kullanıldı.');
      if (existing.status === 'queued')
        await this.store.enqueue(
          newJob('operation', 'operation:' + existing.id, { operationId: existing.id }),
        );
      return existing;
    }
    let high = risk(action) === 'high';
    let preview: Operation['preview'];
    if ('reminderId' in action) {
      const current = await this.store.reminder(action.reminderId);
      if (!current || current.version !== action.version)
        throw new AppError(409, 'Hatırlatma değişmiş. Güncel sürümü yeniden yükle.');
      preview = { title: current.title, body: current.message, kind: 'reminder' };
    }
    if ('memoryId' in action) {
      const current = await this.store.memory(action.memoryId);
      if (!current || current.version !== action.version)
        throw new AppError(409, 'Kayıt değişmiş. Güncel sürümü yeniden yükle.');
      preview = { title: current.title, body: current.body.slice(0, 1000), kind: current.kind };
    }
    if ('eventId' in action && action.eventId && action.kind !== 'event.create') {
      const current = (await this.calendar.inspect('event', action.calendarId, action.eventId)) as
        CalendarEvent | undefined;
      if (current?.attendees?.length || current?.recurrence?.length) high = true;
      if (
        action.kind === 'event.delete' &&
        action.scope === 'single' &&
        !action.notify &&
        !action.conference &&
        current?.id === action.eventId &&
        current.etag === action.etag &&
        !current.attendees?.length &&
        current.visibility !== 'public' &&
        !current.recurrence?.length &&
        !current.recurringEventId
      ) {
        const calendars = await this.calendar.calendars();
        // Narrow exception: verified owner calendar, one non-recurring private event.
        // Unknown permissions, guests, whole-series, and bulk/calendar clearing stay high-risk.
        if (
          calendars.some(
            (c) =>
              (c.id === action.calendarId || (action.calendarId === 'primary' && c.primary)) &&
              c.accessRole === 'owner',
          )
        )
          high = false;
      }
    }
    const op: Operation = {
      id: randomUUID(),
      key,
      hash,
      action,
      risk: high ? 'high' : 'normal',
      ...(preview ? { preview } : {}),
      status: high ? 'awaiting_approval' : 'queued',
      createdAt: now,
      updatedAt: now,
      expiresAt: new Date(Date.now() + 15 * 60000).toISOString(),
    };
    const saved = await this.store.insertOperation(op);
    if (saved.hash !== hash) throw new AppError(409, 'Aynı istek anahtarı farklı içerikle kullanıldı.');
    if (saved.status === 'queued')
      await this.store.enqueue(newJob('operation', 'operation:' + saved.id, { operationId: saved.id }));
    return saved;
  }
  async approve(id: string, hash: string) {
    const op = await this.store.operation(id);
    if (!op) throw new AppError(404, 'İşlem bulunamadı.');
    if (op.status !== 'awaiting_approval' || op.hash !== hash || Date.parse(op.expiresAt) < Date.now())
      throw new AppError(409, 'Onay geçersiz veya süresi dolmuş.');
    op.status = 'queued';
    op.updatedAt = new Date().toISOString();
    if (!(await this.store.transition(op, 'awaiting_approval')))
      throw new AppError(409, 'İşlem zaten işlendi.');
    await this.store.enqueue(newJob('operation', 'operation:' + op.id, { operationId: op.id }));
    return op;
  }
  async cancel(id: string) {
    const op = await this.store.operation(id);
    if (!op || !['awaiting_approval', 'queued'].includes(op.status))
      throw new AppError(409, 'Bu işlem iptal edilemiyor.');
    const previous = op.status;
    op.status = 'canceled';
    op.updatedAt = new Date().toISOString();
    if (!(await this.store.transition(op, previous))) throw new AppError(409, 'İşlem başlamış.');
    return op;
  }
  async repairQueue() {
    for (const op of await this.store.queuedOperations())
      if (op.status === 'queued')
        await this.store.enqueue(newJob('operation', 'operation:' + op.id, { operationId: op.id }));
  }
  async execute(id: string) {
    const op = await this.store.operation(id);
    if (!op || op.status !== 'queued') return { skipped: true };
    op.status = 'running';
    op.updatedAt = new Date().toISOString();
    if (!(await this.store.transition(op, 'queued'))) return { skipped: true };
    let calendarApplied = false;
    try {
      const a = op.action;
      let result: unknown;
      if (
        a.kind === 'memory.create' ||
        a.kind === 'memory.update' ||
        a.kind === 'memory.complete' ||
        a.kind === 'memory.archive' ||
        a.kind === 'memory.restore'
      )
        result = await new PersonalMemory(this.store).execute(a, op.id);
      else if (a.kind === 'reminder.create' || a.kind === 'reminder.update' || a.kind === 'reminder.cancel')
        result = await this.reminders.execute(a, op.id);
      else if (a.kind.startsWith('routine.'))
        result = await this.routines.execute(a as Extract<Action, { routineId?: string }>, op.id);
      else if (a.kind === 'preferences.update') {
        result = {
          language: 'en',
          ...((await this.store.get<object>('preferences')) ?? {}),
          timeZone: a.timeZone,
          ...(a.language !== undefined ? { language: canonicalLanguage(a.language) } : {}),
          ...(a.displayName !== undefined ? { displayName: a.displayName } : {}),
          ...(a.communicationStyle !== undefined ? { communicationStyle: a.communicationStyle } : {}),
          ...(a.onboarded !== undefined ? { onboarded: a.onboarded } : {}),
        };
        await this.store.set('preferences', result);
      } else {
        result = await this.calendar.execute(a, op.id);
        calendarApplied = true;
        op.result = result;
        if ('scope' in a) {
          const linked = (await this.store.reminders()).filter(
            (r) =>
              r.event?.calendarId === a.calendarId &&
              r.event.eventId === a.eventId &&
              r.state === 'scheduled',
          );
          if (a.kind === 'event.delete' || a.telegramReminderMinutes === null)
            for (const r of linked)
              await this.reminders.execute(
                { kind: 'reminder.cancel', reminderId: r.id, version: r.version },
                op.id,
              );
          if (a.kind === 'event.move')
            for (const r of linked)
              await this.reminders.execute(
                {
                  kind: 'reminder.update',
                  reminderId: r.id,
                  version: r.version,
                  reminder: {
                    title: r.title,
                    message: r.message,
                    enabled: r.enabled,
                    event: { ...r.event!, calendarId: a.destination! },
                  },
                },
                op.id,
              );
          if (
            (a.kind === 'event.create' || a.kind === 'event.update') &&
            typeof a.telegramReminderMinutes === 'number'
          ) {
            const event = result as CalendarEvent;
            const reminder = {
              title: a.event!.summary,
              message: a.event!.summary,
              enabled: true,
              event: {
                calendarId: a.calendarId,
                eventId: event.id,
                minutesBefore: a.telegramReminderMinutes,
              },
            };
            const current = linked[0];
            await this.reminders.execute(
              current
                ? { kind: 'reminder.update', reminderId: current.id, version: current.version, reminder }
                : { kind: 'reminder.create', reminder },
              op.id,
            );
          }
        }
      }
      op.status = 'succeeded';
      op.result = result;
      await this.store.transition({ ...op, updatedAt: new Date().toISOString() }, 'running');
      return result;
    } catch (e) {
      const uncertain = calendarApplied || !(e instanceof AppError) || e.uncertain;
      op.status = uncertain ? 'unknown' : 'failed';
      op.error = calendarApplied
        ? 'Takvim değişikliği uygulandı fakat bağlı hatırlatma güncellenemedi. Yeniden etkinlik oluşturmadan hatırlatmaları kontrol et.'
        : e instanceof AppError
          ? e.message
          : 'İşlem tamamlanamadı.';
      await this.store.transition({ ...op, updatedAt: new Date().toISOString() }, 'running');
      throw e;
    }
  }
}
export function conflicts(events: CalendarEvent[]) {
  const sorted = events
    .filter((e) => e.status !== 'cancelled' && e.transparency !== 'transparent')
    .sort(
      (a, b) => Date.parse(a.start.dateTime ?? a.start.date!) - Date.parse(b.start.dateTime ?? b.start.date!),
    );
  const pairs: { first: string; second: string }[] = [];
  for (let i = 0; i < sorted.length; i++)
    for (let j = i + 1; j < sorted.length; j++) {
      if (
        Date.parse(sorted[j].start.dateTime ?? sorted[j].start.date!) >=
        Date.parse(sorted[i].end.dateTime ?? sorted[i].end.date!)
      )
        break;
      pairs.push({ first: sorted[i].summary, second: sorted[j].summary });
    }
  return pairs;
}
export class WorkerService {
  private reportStop = new AbortController();
  private reportRunning?: Promise<boolean>;
  private reminderSync?: Promise<void>;
  constructor(
    private store: Store,
    private calendar: CalendarGateway,
    private routines: RoutineService,
    private operations: OperationService,
    private report?: (input: ReportInput, signal?: AbortSignal) => Promise<unknown>,
  ) {}
  async sync() {
    if (!(await this.calendar.connected())) return;
    for (const c of await this.calendar.calendars()) await this.calendar.sync(c.id);
  }
  async tick() {
    await this.store.recover();
    await this.operations.repairQueue();
    await this.routines.schedule();
    await new PersonalMemory(this.store).schedule();
    await this.operations.reminders.schedule(false);
    const job = await this.store.claim();
    if (!job) return false;
    return this.runJob(job);
  }
  async tickReports(): Promise<boolean> {
    if (this.reportRunning || this.reportStop.signal.aborted) return false;
    const task = (async () => {
      const job = await this.store.claim(['ai_report']);
      return job ? this.runJob(job) : false;
    })();
    this.reportRunning = task;
    try {
      return await task;
    } finally {
      this.reportRunning = undefined;
    }
  }
  async tickReminderLinks() {
    if (this.reminderSync || this.reportStop.signal.aborted) return;
    const task = this.operations.reminders.schedule();
    this.reminderSync = task;
    try {
      await task;
    } finally {
      this.reminderSync = undefined;
    }
  }
  async stop() {
    this.reportStop.abort();
    await this.reportRunning?.catch(() => {});
    await this.reminderSync?.catch(() => {});
  }
  private async runJob(job: Job) {
    try {
      if (job.kind === 'operation') job.result = await this.operations.execute(job.payload.operationId!);
      else if (job.payload.reminder) {
        const record = await this.operations.reminders.current(job.payload.reminder);
        job.result = record
          ? {
              type: 'reminder',
              title: record.title,
              message: record.message,
              execution: 'deterministic',
              llmUsed: false,
            }
          : { skipped: true, reason: 'Reminder changed or canceled' };
      } else if (job.payload.taskReminder) {
        const { memoryId, remindAt } = job.payload.taskReminder;
        const task = await this.store.memory(memoryId);
        job.result =
          !task || task.archived || task.taskState === 'done' || task.remindAt !== remindAt
            ? { skipped: true, reason: 'Task completed, removed or rescheduled' }
            : {
                type: 'task_reminder',
                title: task.title,
                message: task.body,
                remindAt,
                execution: 'deterministic',
                llmUsed: false,
              };
      } else {
        const r = job.payload.routine!;
        const current = (await this.store.routines()).find((x) => x.id === r.id);
        const scheduled = !job.key.startsWith('manual:');
        const changed =
          current &&
          digest({
            name: current.name,
            cron: current.cron,
            timeZone: current.timeZone,
            kind: current.kind,
            message: current.message ?? null,
          }) !==
            digest({
              name: r.name,
              cron: r.cron,
              timeZone: r.timeZone,
              kind: r.kind,
              message: r.message ?? null,
            });
        if (
          !current ||
          changed ||
          (scheduled && (!current.enabled || Date.now() - Date.parse(job.scheduledAt) > 15 * 60000))
        ) {
          job.result = { skipped: true, reason: 'Routine deleted, paused or revised' };
        } else if (r.kind === 'reminder') {
          job.result = {
            type: 'reminder',
            title: r.name,
            message: r.message,
            execution: 'deterministic',
            llmUsed: false,
          };
        } else {
          const now = new Date(),
            end = new Date(
              now.getTime() +
                (r.kind === 'weekly_summary' ? 7 : r.kind === 'upcoming_check' ? 1 / 24 : 1) * 86400000,
            );
          const range =
            r.kind === 'ai_weekly_summary'
              ? upcomingWeekRange(r.timeZone, now)
              : r.kind === 'ai_daily_summary'
                ? localDayRange(r.timeZone, 1, now)
                : r.kind === 'daily_summary' || r.kind === 'weekly_summary'
                  ? localDayRange(r.timeZone, r.kind === 'weekly_summary' ? 7 : 1, now)
                  : { from: now.toISOString(), to: end.toISOString() };
          const events = (await this.calendar.events('primary', range.from, range.to)).filter(
            (e) =>
              e.status !== 'cancelled' &&
              !e.attendees?.some((p) => (p as { self?: boolean }).self && p.responseStatus === 'declined'),
          );
          if (r.kind.startsWith('ai_')) {
            if (!this.report) throw new AppError(503, 'AI rapor sağlayıcısı bağlı değil.');
            job.result = await this.report({ routine: r, ...range, events }, this.reportStop.signal);
          } else
            job.result =
              r.kind === 'conflict_check'
                ? { conflicts: conflicts(events) }
                : {
                    message: events.length ? `${events.length} etkinlik var.` : 'Bu aralıkta etkinlik yok.',
                    events: events.map((e) => ({ id: e.id, summary: e.summary, start: e.start, end: e.end })),
                  };
        }
      }
      job.status = 'succeeded';
    } catch (e) {
      if (job.payload.reminder) {
        job.status = 'queued';
        job.scheduledAt = new Date(Date.now() + 60000).toISOString();
        await this.store.finish(job);
        return true;
      }
      job.status = e instanceof AppError && e.uncertain ? 'unknown' : 'failed';
      job.error = e instanceof AppError ? e.message : 'Arka plan işi tamamlanamadı.';
    }
    job.finishedAt = new Date().toISOString();
    await this.store.finish(job);
    return true;
  }
}
