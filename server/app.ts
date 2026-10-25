import Fastify, { LogController } from 'fastify';
import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import cookie from '@fastify/cookie';
import serveStatic from '@fastify/static';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { ZodError } from 'zod';
import * as Sentry from '@sentry/node';
import type { Config } from './config.js';
import type { Store } from './repositories.js';
import { GoogleCalendar, DemoCalendar, type CalendarGateway } from './google.js';
import { OperationService, RoutineService, WorkerService } from './services.js';
import { AgyProvider, DisabledProvider, AssistantService, type ModelProvider } from './provider.js';
import { security } from './security.js';
import { ApiController } from './controllers.js';
import { AppError } from './errors.js';
import { OwnerAuth, isLoginCallback } from './login.js';
import { AgySocketProvider } from './agy-socket.js';
import { AgyManagement, agyManagementRoutes } from './agy-management.js';
import { memoryRoutes } from './memory-routes.js';
import { voiceRoutes } from './voice-routes.js';
import { ChatRequests, chatRequestRoutes } from './chat-requests.js';
import { ResearchService, researchRoutes } from './research.js';
import { Connections, connectionRoutes } from './connections.js';
export async function createApp(
  config: Config,
  store: Store,
  overrides: { calendar?: CalendarGateway; provider?: ModelProvider; agyManagement?: AgyManagement } = {},
) {
  const app = Fastify({
    bodyLimit: 32768,
    trustProxy: false,
    logger:
      config.NODE_ENV === 'test'
        ? false
        : { redact: ['req.headers', 'req.body', 'res.headers', 'err.config', 'err.request'], level: 'info' },
    logController: new LogController({ disableRequestLogging: true }),
    requestTimeout: 180000,
  });
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        connectSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'"],
        mediaSrc: ["'self'", 'blob:'],
        objectSrc: ["'none'"],
        frameAncestors: ["'none'"],
      },
    },
    referrerPolicy: { policy: 'no-referrer' },
  });
  await app.register(cookie, { secret: config.SESSION_SECRET });
  await app.register(rateLimit, {
    max: (req) => (req.method === 'GET' ? 600 : 120),
    timeWindow: 60000,
    keyGenerator: (req) => req.ip + ':' + (req.method === 'GET' ? 'read' : 'write'),
  });
  const auth = new OwnerAuth(config, store);
  await security(app, config, store, auth);
  const agyManagement = overrides.agyManagement ?? new AgyManagement(config);
  agyManagementRoutes(app, agyManagement);
  memoryRoutes(app, store);
  voiceRoutes(app, store, config);
  const connections = new Connections(config, store);
  await connections.apply();
  connectionRoutes(app, connections);
  app.addHook('onSend', async (req, reply, payload) => {
    if (req.url.startsWith('/api/')) reply.header('Cache-Control', 'no-store');
    return payload;
  });
  app.setErrorHandler((error, req, reply) => {
    if (error instanceof ZodError)
      return reply.code(400).send({
        error: 'Girdi geçersiz.',
        details: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
      });
    if (error instanceof AppError)
      return reply.code(error.status).send({ error: error.message, uncertain: error.uncertain });
    const code = (error as { statusCode?: number }).statusCode;
    const status = typeof code === 'number' && code < 500 ? code : 500;
    if (status === 500) {
      Sentry.captureException(error, { extra: { requestId: req.id } });
      app.log.error(
        { requestId: req.id, errorType: error instanceof Error ? error.name : 'unknown' },
        'Unhandled request failure',
      );
    }
    return reply.code(status).send({
      error: status === 429 ? 'Çok fazla istek. Biraz bekleyin.' : 'İstek tamamlanamadı.',
      requestId: req.id,
    });
  });
  const google = new GoogleCalendar(store, config);
  const calendar = overrides.calendar ?? (config.DEMO_MODE ? new DemoCalendar() : google);
  const routines = new RoutineService(store);
  const operations = new OperationService(store, calendar, routines);
  const research = new ResearchService(store);
  researchRoutes(app, research);
  const assistant = new AssistantService(
    overrides.provider ??
      (config.AGY_ENABLED
        ? config.AGY_SOCKET
          ? new AgySocketProvider(config)
          : new AgyProvider(config)
        : new DisabledProvider()),
    store,
    calendar,
    operations,
    {
      get telegram() {
        return config.TELEGRAM_ENABLED;
      },
      voice: config.STT_ENABLED,
    },
    research,
  );
  const worker = new WorkerService(store, calendar, routines, operations, (input, signal) =>
    assistant.report(input, signal),
  );
  const c = new ApiController(store, calendar, google, operations, assistant, config);
  app.addHook('preClose', async () => c.closeProgress());
  const chatRequests = new ChatRequests(store, assistant);
  chatRequestRoutes(app, chatRequests);
  app.get('/healthz', async () => ({ ok: true }));
  app.get('/api/session', c.session);
  if (config.AUTH_MODE === 'google') {
    app.get('/api/auth/login', { config: { rateLimit: { max: 10, timeWindow: 60000 } } }, auth.start);
    app.post('/api/auth/logout', auth.logout);
  }
  app.get('/api/calendars', c.calendars);
  app.get('/api/events', c.events);
  app.get('/api/sharing', c.sharing);
  app.get('/api/resources', c.resource);
  app.get('/api/routines', c.routines);
  app.get('/api/reminders', async () => store.reminders());
  app.post('/api/routines/preview', c.previewRoutine);
  app.get('/api/history', c.history);
  app.post('/api/operations', { bodyLimit: 65536 }, c.submit);
  app.post('/api/operations/:id/approve', c.approve);
  app.post('/api/operations/:id/cancel', c.cancel);
  app.post('/api/chat', { config: { rateLimit: { max: 12, timeWindow: 60000 } } }, c.chat);
  app.get('/api/chat/history', c.conversation);
  app.post('/api/oauth/connect', c.connect);
  app.get('/api/oauth/callback', (req, reply) =>
    config.AUTH_MODE === 'google' && isLoginCallback(req.url)
      ? auth.callback(req, reply)
      : c.callback(req, reply),
  );
  app.post('/api/sync', c.sync);
  app.get('/api/progress', c.progress);
  const dist = fileURLToPath(new URL('../dist/', import.meta.url));
  if (existsSync(dist)) {
    await app.register(serveStatic, { root: dist });
    app.setNotFoundHandler((req, reply) =>
      req.url.startsWith('/api/')
        ? reply.code(404).send({ error: 'Bulunamadı.' })
        : reply.sendFile('index.html'),
    );
  }
  return { app, worker, routines, operations, calendar, assistant, agyManagement, chatRequests, connections };
}
