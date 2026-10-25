import { z } from 'zod';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Store } from './repositories.js';
import type { CalendarGateway, GoogleCalendar } from './google.js';
import type { OperationService } from './services.js';
import { nextRun } from './services.js';
import type { AssistantService } from './provider.js';
import type { Config } from './config.js';
import { requestKey } from './security.js';
import { routineInput } from '../shared/contracts.js';
import { AppError } from './errors.js';
const params = z.object({ id: z.uuid() });
export class BaseController {
  protected ok(reply: FastifyReply, data: unknown) {
    return reply.send(data);
  }
}
export class ApiController extends BaseController {
  private progressStreams = new Set<FastifyReply['raw']>();
  closeProgress() {
    for (const stream of this.progressStreams) stream.end();
    this.progressStreams.clear();
  }
  constructor(
    private store: Store,
    private calendar: CalendarGateway,
    private google: GoogleCalendar,
    private operations: OperationService,
    private assistant: AssistantService,
    private config: Config,
  ) {
    super();
  }
  session = async (req: FastifyRequest, reply: FastifyReply) =>
    this.ok(reply, {
      csrf: req.ownerSession.csrf,
      demo: this.config.DEMO_MODE,
      owner: this.config.OWNER_EMAIL || 'Yerel kullanıcı',
      canLogout: this.config.NODE_ENV === 'production' && this.config.AUTH_MODE === 'google',
      googleConnected: await this.calendar.connected(),
      agyEnabled: this.config.AGY_ENABLED,
      asyncChat: true,
      telegram: {
        delivery: await this.store.get('telegram.delivery'),
        enabled: this.config.TELEGRAM_ENABLED,
        voiceEnabled: this.config.STT_ENABLED,
        status: (await this.store.get('telegram.status')) ?? { state: 'disabled' },
      },
      onboardingRequired:
        !this.config.DEMO_MODE && !(await this.store.get<{ onboarded?: boolean }>('preferences'))?.onboarded,
      preferences: (await this.store.get('preferences')) ?? { timeZone: 'Europe/Istanbul', language: 'en' },
    });
  calendars = async (_req: FastifyRequest, reply: FastifyReply) =>
    this.ok(reply, await this.calendar.calendars());
  events = async (req: FastifyRequest, reply: FastifyReply) => {
    const q = z
      .object({
        calendarId: z.string().max(1024).default('primary'),
        from: z.iso.datetime({ offset: true }),
        to: z.iso.datetime({ offset: true }),
      })
      .parse(req.query);
    if (Date.parse(q.to) <= Date.parse(q.from) || Date.parse(q.to) - Date.parse(q.from) > 93 * 86400000)
      throw new AppError(400, 'En fazla 93 günlük tarih aralığı seçin.');
    return this.ok(reply, await this.calendar.events(q.calendarId, q.from, q.to));
  };
  sharing = async (req: FastifyRequest, reply: FastifyReply) => {
    const q = z.object({ calendarId: z.string().min(1).max(1024) }).parse(req.query);
    return this.ok(reply, await this.calendar.sharing(q.calendarId));
  };
  resource = async (req: FastifyRequest, reply: FastifyReply) => {
    const q = z
      .object({
        kind: z.enum(['event', 'calendar', 'instances', 'settings', 'colors']),
        calendarId: z.string().min(1).max(1024).default('primary'),
        eventId: z.string().min(1).max(1024).optional(),
      })
      .strict()
      .parse(req.query);
    return this.ok(reply, await this.calendar.inspect(q.kind, q.calendarId, q.eventId));
  };
  routines = async (_req: FastifyRequest, reply: FastifyReply) => this.ok(reply, await this.store.routines());
  previewRoutine = async (req: FastifyRequest, reply: FastifyReply) => {
    const r = routineInput.parse(req.body);
    return this.ok(reply, { nextRun: nextRun(r.cron, r.timeZone) });
  };
  history = async (_req: FastifyRequest, reply: FastifyReply) =>
    this.ok(reply, { operations: await this.store.operations(), jobs: await this.store.jobs() });
  submit = async (req: FastifyRequest, reply: FastifyReply) =>
    this.ok(reply, await this.operations.submit(req.body, requestKey(req)));
  approve = async (req: FastifyRequest, reply: FastifyReply) => {
    const { id } = params.parse(req.params);
    const { hash } = z
      .object({ hash: z.string().regex(/^[a-f0-9]{64}$/) })
      .strict()
      .parse(req.body);
    const operation = await this.operations.approve(id, hash);
    try {
      await this.operations.execute(operation.id);
    } catch {
      /* Persisted status is authoritative. */
    }
    return this.ok(reply, await this.store.operation(operation.id));
  };
  cancel = async (req: FastifyRequest, reply: FastifyReply) =>
    this.ok(reply, await this.operations.cancel(params.parse(req.params).id));
  chat = async (req: FastifyRequest, reply: FastifyReply) => {
    const { message } = z
      .object({ message: z.string().trim().min(1).max(6000) })
      .strict()
      .parse(req.body);
    const abort = new AbortController();
    req.raw.on('aborted', () => abort.abort());
    return this.ok(reply, await this.assistant.chat(message, requestKey(req), abort.signal));
  };
  conversation = async (req: FastifyRequest, reply: FastifyReply) => {
    const { before } = z
      .object({
        before: z
          .string()
          .regex(/^[1-9]\d{0,18}$/)
          .refine((value) => BigInt(value) <= 9223372036854775807n)
          .optional(),
      })
      .parse(req.query);
    return this.ok(reply, await this.store.conversation(50, before));
  };
  connect = async (req: FastifyRequest, reply: FastifyReply) => {
    if (this.config.DEMO_MODE) throw new AppError(409, 'Google bağlantısı için canlı moda geçin.');
    return this.ok(reply, { url: await this.google.authorization(req.ownerSession.id) });
  };
  callback = async (req: FastifyRequest, reply: FastifyReply) => {
    const q = z
      .object({ state: z.string().min(20).max(200), code: z.string().min(1).max(4000) })
      .parse(req.query);
    await this.google.callback(q.state, q.code, req.ownerSession.id);
    return reply.redirect(this.config.APP_ORIGIN + '/?connected=1');
  };
  sync = async (req: FastifyRequest, reply: FastifyReply) => {
    const { calendarId } = z
      .object({ calendarId: z.string().min(1).max(1024) })
      .strict()
      .parse(req.body);
    await this.calendar.sync(calendarId);
    return this.ok(reply, { syncedAt: new Date().toISOString() });
  };
  progress = async (req: FastifyRequest, reply: FastifyReply) => {
    this.progressStreams.add(reply.raw);
    reply.hijack();
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    let busy = false;
    const send = async () => {
      if (busy || reply.raw.destroyed || reply.raw.writableEnded) return;
      busy = true;
      try {
        const operations = await this.store.operations();
        const jobs = await this.store.jobs();
        if (reply.raw.destroyed || reply.raw.writableEnded) return;
        reply.raw.write('event: operations\ndata: ' + JSON.stringify(operations) + '\n\n');
        reply.raw.write('event: jobs\ndata: ' + JSON.stringify(jobs) + '\n\n');
      } catch {
        if (!reply.raw.destroyed && !reply.raw.writableEnded) reply.raw.write('event: error\ndata: {}\n\n');
      } finally {
        busy = false;
      }
    };
    await send();
    const interval = setInterval(() => void send(), 3000);
    const timeout = setTimeout(() => reply.raw.end(), 5 * 60000);
    reply.raw.on('close', () => {
      this.progressStreams.delete(reply.raw);
      clearInterval(interval);
      clearTimeout(timeout);
    });
  };
}
