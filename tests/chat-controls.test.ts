import { afterAll, beforeAll, describe, it, expect } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { readFile } from 'node:fs/promises';
import type pg from 'pg';
import { MemoryStore, PostgresStore, newJob } from '../server/repositories';
import { readConversationState } from '../server/chat-state';
let db: PGlite, pgStore: PostgresStore;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(await readFile(new URL('../server/schema.sql', import.meta.url), 'utf8'));
  pgStore = new PostgresStore({
    query: async (sql: string, params?: unknown[]) => {
      const r = await db.query(sql, params);
      return { ...r, rowCount: r.affectedRows };
    },
  } as unknown as pg.Pool);
}, 30000);
afterAll(async () => {
  await db?.close();
});
for (const kind of ['memory', 'postgres'] as const)
  describe(kind + ' conversation controls', () => {
    it('forgets only the selected exchange, protects retries and rotates context', async () => {
      const store = kind === 'memory' ? new MemoryStore() : pgStore;
      const id = '12345678-1234-4234-8234-123456789012';
      await store.appendConversation('chat:web:' + id, 'secret exchange', 'private reply');
      await store.appendConversation('chat:web:other', 'keep exchange', 'keep reply');
      await store.set('chat:web:' + id, { hash: 'hash', result: { message: 'private reply' } });
      await store.set('assistant.request:' + id, {
        hash: 'hash',
        status: 'succeeded',
        result: { message: 'private reply' },
      });
      await store.set('assistant.clarification:old', { request: 'secret exchange', question: 'one hour?' });
      const first = (await store.conversation())[0];
      const next = await store.changeConversation({
        expectedVersion: 1,
        mode: 'forget',
        messageId: first.id,
      });
      expect(await store.get('assistant.clarification:old')).toBeUndefined();
      expect(next.contextId).not.toBe('initial');
      expect((await store.conversation()).map((x) => x.text)).toEqual(['keep exchange', 'keep reply']);
      expect(JSON.stringify(await store.get('chat:web:' + id))).not.toContain('private reply');
      expect((await store.get<{ status: string }>('assistant.request:' + id))?.status).toBe('failed');
      await expect(store.changeConversation({ expectedVersion: 1, mode: 'delete' })).rejects.toThrow();
      const fresh = await store.changeConversation({ expectedVersion: next.version, mode: 'new' });
      expect(await store.conversation(50, undefined, fresh.visibleAfter)).toEqual([]);
      expect(await store.conversation()).toHaveLength(2);
      await store.appendConversation('chat:web:fresh', 'new message', 'new reply');
      expect((await store.conversation(50, undefined, fresh.contextAfter)).map((x) => x.text)).toEqual([
        'new message',
        'new reply',
      ]);
      const reset = await store.changeConversation({ expectedVersion: fresh.version, mode: 'reset' });
      expect(reset.visibleAfter).toBe(fresh.visibleAfter);
      expect(await store.conversation(50, undefined, reset.contextAfter)).toEqual([]);
      await store.changeConversation({ expectedVersion: reset.version, mode: 'delete' });
      expect(await store.conversation()).toEqual([]);
      expect((await readConversationState(store)).version).toBe(5);
    });
    it('refuses changes while durable assistant work is pending', async () => {
      const store = kind === 'memory' ? new MemoryStore() : pgStore;
      const old = await readConversationState(store);
      await store.enqueue(
        newJob('assistant', 'pending-context-test', { chatRequest: { id: 'pending', message: 'hello' } }),
      );
      await expect(store.changeConversation({ expectedVersion: old.version, mode: 'new' })).rejects.toThrow();
      expect(await readConversationState(store)).toEqual(old);
    });
  });
