import pg from 'pg';
import type { Config } from './config.js';
import { MemoryStore, PostgresStore } from './repositories.js';
import { migrate } from './migrate.js';
export async function createStore(config: Config) {
  if (config.DEMO_MODE) return new MemoryStore();
  const pool = new pg.Pool({ connectionString: config.DATABASE_URL, max: 8 });
  await migrate(pool);
  return new PostgresStore(pool);
}
