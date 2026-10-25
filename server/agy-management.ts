import { createConnection } from 'node:net';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Config } from './config.js';
import { AppError } from './errors.js';
import type { Store } from './repositories.js';
import { newJob } from './repositories.js';

export type AgyStatus = {
  available: boolean;
  active?: boolean;
  session?: string | null;
  offset?: number;
  connection?: { state: string; model?: string; updatedAt?: string };
};
export class AgyManagement {
  constructor(private config: Config) {}
  async call<T = AgyStatus>(request: Record<string, unknown>): Promise<T> {
    if (!this.config.AGY_ENABLED || !this.config.AGY_SOCKET)
      throw new AppError(503, 'AGY konsolu bu sunucuda etkin değil.');
    return await new Promise<T>((resolve, reject) => {
      const socket = createConnection({ path: '/run/cor-agy-console/console.sock' });
      let result = Buffer.alloc(0),
        finished = false;
      const finish = (error?: Error, value?: T) => {
        if (finished) return;
        finished = true;
        clearTimeout(timer);
        socket.destroy();
        if (error) reject(error);
        else resolve(value!);
      };
      const timer = setTimeout(
        () => finish(new AppError(504, 'AGY bağlantı kontrolü zaman aşımına uğradı.')),
        request.control === 'check' ? 25000 : 5000,
      );
      socket.once('connect', () => socket.write(JSON.stringify(request) + '\n'));
      socket.on('data', (part: Buffer) => {
        result = Buffer.concat([result, part]);
        if (result.length > 196608) return finish(new AppError(502, 'Konsol çıktı sınırı aşıldı.'));
        const end = result.indexOf(10);
        if (end < 0) return;
        try {
          const value = JSON.parse(result.subarray(0, end).toString('utf8'));
          if (value.error)
            finish(
              new AppError(409, 'AGY konsolu meşgul veya bu oturum sona ermiş. Yeniden açmayı deneyin.'),
            );
          else finish(undefined, { available: true, ...value });
        } catch {
          finish(new AppError(502, 'AGY konsol yanıtı okunamadı.'));
        }
      });
      socket.once('error', () => finish(new AppError(503, 'AGY konsol servisine ulaşılamadı.')));
      socket.once('close', () => finish(new AppError(503, 'AGY konsol bağlantısı kapandı.')));
    });
  }
  async status(): Promise<AgyStatus> {
    if (!this.config.AGY_ENABLED) return { available: false, connection: { state: 'disabled' } };
    try {
      return await this.call({ control: 'status' });
    } catch {
      return { available: false, connection: { state: 'unreachable' } };
    }
  }
}

export function agyManagementRoutes(app: FastifyInstance, manager: AgyManagement) {
  const session = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
  app.get('/api/agy/status', () => manager.status());
  app.post('/api/agy/check', () => manager.call({ control: 'check' }));
  app.post('/api/agy/console/start', () => manager.call({ control: 'start' }));
  app.get('/api/agy/console/read', (req) => {
    const value = z
      .object({ session, offset: z.coerce.number().int().min(0).max(10000000) })
      .strict()
      .parse(req.query);
    return manager.call({ control: 'read', ...value });
  });
  app.post('/api/agy/console/input', { config: { rateLimit: { max: 300, timeWindow: 60000 } } }, (req) => {
    const value = z
      .object({ session, input: z.string().max(2000) })
      .strict()
      .parse(req.body);
    if (Buffer.byteLength(value.input) > 4096) throw new AppError(413, 'Konsol girdisi çok uzun.');
    return manager.call({ control: 'write', ...value });
  });
  app.post('/api/agy/console/resize', (req) => {
    const value = z
      .object({ session, cols: z.number().int().min(20).max(200), rows: z.number().int().min(8).max(60) })
      .strict()
      .parse(req.body);
    return manager.call({ control: 'resize', ...value });
  });
  app.post('/api/agy/console/stop', (req) => {
    const value = z.object({ session }).strict().parse(req.body);
    return manager.call({ control: 'stop', ...value });
  });
}

export async function notifyAgySession(manager: AgyManagement, store: Store, config: Config) {
  const state = await manager.status();
  if (state.connection?.state === 'ready') {
    await store.set('agy.auth-notified', '');
    return;
  }
  if (state.connection?.state !== 'auth_required' || !config.TELEGRAM_ENABLED) return;
  const key = state.connection.updatedAt ?? 'unknown';
  const previous = await store.get<string>('agy.auth-notified');
  if (previous) return;
  await store.enqueue(
    newJob('telegram_outgoing', 'agy:auth:' + key, {
      telegram: {
        text:
          'AGY oturumu yenilenmeli. C.O.R. → Ayarlar → AGY bağlantısı bölümünden konsolu açıp yeniden giriş yapabilirsin.\n' +
          config.APP_ORIGIN,
      },
    }),
  );
  await store.set('agy.auth-notified', key);
}

export async function monitorAgyConnection(manager: AgyManagement, store: Store, config: Config) {
  if (!config.AGY_ENABLED) return;
  const status = await manager.status();
  const age = Date.now() - Date.parse(status.connection?.updatedAt ?? '1970-01-01');
  if (
    status.available &&
    !status.active &&
    status.connection?.state !== 'auth_required' &&
    age >= 15 * 60000
  ) {
    // Model listing checks authentication without sending a prompt or renewing login.
    await manager.call({ control: 'check' }).catch(() => {});
  }
  await notifyAgySession(manager, store, config);
}
