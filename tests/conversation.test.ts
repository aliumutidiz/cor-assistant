import { describe, expect, it } from 'vitest';
import { conversationContext } from '../server/conversation.js';
import { MemoryStore } from '../server/repositories.js';

describe('archived conversation and bounded working context', () => {
  it('retains complete messages independently of the context budget and deduplicates retries', async () => {
    const store = new MemoryStore();
    const text = 'uzun '.repeat(1200);
    await store.appendConversation('one', text, 'yanıt '.repeat(1800));
    await store.appendConversation('one', text, 'duplicate');
    expect(await store.conversation()).toHaveLength(2);
    expect((await store.conversation())[0].text).toBe(text);
    expect((await store.conversation())[1].text.length).toBeGreaterThan(6000);
  });
  it('paginates without losing or repeating messages', async () => {
    const store = new MemoryStore();
    for (let i = 0; i < 30; i++) await store.appendConversation('key-' + i, 'u' + i, 'a' + i);
    const recent = await store.conversation(50);
    const previous = await store.conversation(50, recent[0].id);
    expect(recent).toHaveLength(50);
    expect(previous).toHaveLength(10);
    expect(new Set([...previous, ...recent].map((m) => m.id)).size).toBe(60);
  });
  it('retrieves relevant older messages beyond the recent window without extra model calls', () => {
    const rows = [
      { role: 'user' as const, text: 'Ankara ziyaretini planlıyoruz.' },
      ...Array.from({ length: 40 }, (_, i) => ({ role: 'assistant' as const, text: 'Son mesaj ' + i })),
    ];
    expect(
      conversationContext(rows, 'Ankara planı nasıldı?').some((row) => row.text.includes('ziyaretini')),
    ).toBe(true);
  });
  it('enforces a working-context budget without changing the archive', () => {
    const rows = Array.from({ length: 50 }, () => ({ role: 'user' as const, text: 'x'.repeat(6000) }));
    expect(
      conversationContext(rows, 'x').reduce((total, row) => total + row.text.length, 0),
    ).toBeLessThanOrEqual(48000);
    expect(rows[0].text).toHaveLength(6000);
  });
});
