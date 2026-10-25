import pg from 'pg';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { beforeAll, afterAll, describe, it, expect } from 'vitest';
import { PostgresStore, newJob } from '../server/repositories';
const enabled = Boolean(process.env.TEST_DATABASE_URL);
let pool: pg.Pool, admin: pg.Pool, store: PostgresStore;
const schema = 'cor_test_' + randomBytes(8).toString('hex');
describe.skipIf(!enabled)('real PostgreSQL concurrent workers (CI)', () => {
  beforeAll(async () => {
    admin = new pg.Pool({ connectionString: process.env.TEST_DATABASE_URL });
    await admin.query('CREATE SCHEMA ' + schema);
    pool = new pg.Pool({
      connectionString: process.env.TEST_DATABASE_URL,
      max: 4,
      options: '-c search_path=' + schema,
    });
    await pool.query(await readFile(new URL('../server/schema.sql', import.meta.url), 'utf8'));
    store = new PostgresStore(pool);
  });
  afterAll(async () => {
    await pool.end();
    await admin.query('DROP SCHEMA ' + schema + ' CASCADE');
    await admin.end();
  });
  it('allows only one worker to claim each durable job', async () => {
    await store.enqueue(newJob('operation', 'concurrent-job', { operationId: 'test' }));
    const claims = await Promise.all([store.claim(), store.claim()]);
    expect(claims.filter(Boolean)).toHaveLength(1);
  });
  it('uses unique keys across independent connections', async () => {
    const job = newJob('operation', 'unique-job', { operationId: 'test' });
    await Promise.all([store.enqueue(job), store.enqueue({ ...job, id: crypto.randomUUID() })]);
    expect((await store.jobs()).filter((j) => j.key === 'unique-job')).toHaveLength(1);
  });
});
