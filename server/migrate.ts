import { readFile } from 'node:fs/promises';
import pg from 'pg';
import { loadConfig } from './config.js';
export async function migrate(pool: pg.Pool) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(8217781)');
    await client.query(await readFile(new URL('./schema.sql', import.meta.url), 'utf8'));
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
}
if (process.argv[1]?.endsWith('migrate.ts')) {
  const pool = new pg.Pool({ connectionString: loadConfig().DATABASE_URL });
  try {
    await migrate(pool);
  } finally {
    await pool.end();
  }
}
