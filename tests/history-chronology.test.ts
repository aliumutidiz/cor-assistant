import { it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import type pg from 'pg';
import { PostgresStore, newJob } from '../server/repositories';
it('paginates by actual dates, recovers failed exchanges once and honors removal tombstones', async () => {
  const db = new PGlite();
  try {
    const schema = await readFile(new URL('../server/schema.sql', import.meta.url), 'utf8');
    await db.exec(schema);
    const store = new PostgresStore({
      query: async (sql: string, params?: unknown[]) => {
        const r = await db.query(sql, params);
        return { ...r, rowCount: r.affectedRows };
      },
    } as unknown as pg.Pool);
    await store.appendConversation('chat:web:recent', 'Recent request', 'Recent reply');
    await store.appendConversation('chat:web:imported', 'Old request', 'Old reply');
    await db.query(
      "UPDATE conversation_messages SET created_at=CASE WHEN request_key LIKE '%recent:%' THEN '2026-10-25T10:00:00Z'::timestamptz ELSE '2026-10-20T10:00:00Z'::timestamptz END",
    );
    const latest = await store.conversation(2);
    expect(latest.map((row) => row.text)).toEqual(['Recent request', 'Recent reply']);
    expect((await store.conversation(2, latest[0].id)).map((row) => row.text)).toEqual([
      'Old request',
      'Old reply',
    ]);
    for (const [id, error] of [
      ['failed', 'Genuine connection error'],
      ['deleted', 'This reply was removed from local chat history.'],
    ]) {
      await store.set('assistant.request:' + id, { status: 'failed', error });
      const job = newJob('assistant', 'assistant:' + id, {
        chatRequest: { id, message: 'Previously missing request' },
      });
      job.status = 'failed';
      await store.enqueue(job);
    }
    await db.exec(schema);
    await db.exec(schema);
    const rows = await store.conversation();
    expect(rows.filter((row) => row.exchangeId === 'chat:web:failed')).toHaveLength(2);
    expect(rows.filter((row) => row.exchangeId === 'chat:web:deleted')).toHaveLength(0);
  } finally {
    await db.close();
  }
}, 30000);
