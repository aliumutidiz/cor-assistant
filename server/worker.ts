// The default server embeds a single worker. This optional standalone entry is
// for PostgreSQL deployments; SKIP LOCKED and unique job keys coordinate claims.
import { loadConfig } from './config.js';
import { createStore } from './runtime.js';
import { createApp } from './app.js';
const c = loadConfig();
if (c.DEMO_MODE) throw new Error('Standalone workers require PostgreSQL');
const store = await createStore(c);
const { app, worker, chatRequests } = await createApp(c, store);
let stopping = false;
let lastSync = 0;
process.once('SIGTERM', () => {
  stopping = true;
});
process.once('SIGINT', () => {
  stopping = true;
});
const reportTimer = setInterval(() => {
  void chatRequests.tick().catch(() => {});
  void worker.tickReports().catch(() => {});
  void worker.tickReminderLinks().catch(() => {});
}, 1000);
while (!stopping) {
  try {
    if (!(await worker.tick())) await new Promise((r) => setTimeout(r, 1000));
    if (Date.now() - lastSync > 5 * 60000) {
      lastSync = Date.now();
      await worker.sync();
    }
  } catch {
    await new Promise((r) => setTimeout(r, 3000));
  }
}
clearInterval(reportTimer);
await Promise.all([worker.stop(), chatRequests.stop()]);
await app.close();
await store.close();
