import { loadConfig } from './config.js';
import { chmod } from 'node:fs/promises';
import { createApp } from './app.js';
import { createStore } from './runtime.js';
import { TelegramService, TelegramApi, startTelegram } from './telegram.js';
import { LocalSpeechTranscriber } from './speech.js';
import { monitorAgyConnection } from './agy-management.js';
import { setTimeout as delay } from 'node:timers/promises';
const config = loadConfig();
const store = await createStore(config);
const { app, worker, routines, assistant, operations, agyManagement, chatRequests, connections } =
  await createApp(config, store);
await routines.seed();
let stopTelegram: (() => Promise<void>) | undefined;
const connectionStop = new AbortController();
const connectionLoop = (async () => {
  let revision = '';
  while (!connectionStop.signal.aborted) {
    try {
      const next = await connections.read();
      if (next.revision !== revision) {
        await stopTelegram?.();
        stopTelegram = undefined;
        await connections.apply();
        revision = next.revision;
        stopTelegram = config.TELEGRAM_ENABLED
          ? startTelegram(
              new TelegramService(
                config,
                store,
                new TelegramApi(config.TELEGRAM_BOT_TOKEN),
                new LocalSpeechTranscriber(config),
                assistant,
                operations,
              ),
              store,
            )
          : undefined;
        if (!config.TELEGRAM_ENABLED)
          await store.set('telegram.status', { state: 'disabled', updatedAt: new Date().toISOString() });
      }
    } catch {
      app.log.warn('Connection configuration could not be applied');
    }
    try {
      await delay(5000, undefined, { signal: connectionStop.signal });
    } catch {
      break;
    }
  }
})();
let ticking = false;
let lastSync = 0;
let agyMonitoring = false;
const agyTimer = setInterval(async () => {
  if (agyMonitoring || !config.AGY_ENABLED) return;
  agyMonitoring = true;
  try {
    await monitorAgyConnection(agyManagement, store, config);
  } catch {
    app.log.warn('AGY connection monitoring did not complete');
  } finally {
    agyMonitoring = false;
  }
}, 30000);
const timer = setInterval(async () => {
  if (ticking) return;
  ticking = true;
  try {
    await worker.tick();
    if (Date.now() - lastSync > 5 * 60000) {
      lastSync = Date.now();
      await worker.sync();
    }
  } catch (error) {
    app.log.error({ type: error instanceof Error ? error.name : 'unknown' }, 'Worker tick failed');
  } finally {
    ticking = false;
  }
}, 1000);
const reportTimer = setInterval(() => {
  void chatRequests.tick().catch(() => app.log.warn('Chat request processing failed'));
  void worker.tickReports().catch(() => app.log.warn('Scheduled AI report did not complete'));
  void worker.tickReminderLinks().catch(() => app.log.warn('Linked reminder refresh did not complete'));
}, 1000);
const close = async () => {
  clearInterval(timer);
  clearInterval(reportTimer);
  clearInterval(agyTimer);
  connectionStop.abort();
  await connectionLoop;
  await Promise.all([worker.stop(), chatRequests.stop()]);
  await stopTelegram?.();
  await app.close();
  await store.close();
};
process.once('SIGINT', () => void close());
process.once('SIGTERM', () => void close());
if (config.HTTP_SOCKET) {
  await app.listen({ path: config.HTTP_SOCKET });
  await chmod(config.HTTP_SOCKET, 0o660);
} else {
  await app.listen({ host: config.LISTEN_HOST, port: config.PORT });
}
