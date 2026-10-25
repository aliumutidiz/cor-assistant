import { it, expect, vi } from 'vitest';
import { ChatRequests } from '../server/chat-requests';
import { MemoryStore } from '../server/repositories';
import type { AssistantService } from '../server/provider';
it('acknowledges a long generation immediately and deduplicates retries', async () => {
  const store = new MemoryStore();
  let finish!: (r: unknown) => void;
  const chat = vi.fn(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const service = new ChatRequests(store, { chat } as unknown as AssistantService);
  const id = crypto.randomUUID();
  expect(await service.submit(id, 'AI haftalık rapor rutini oluştur')).toMatchObject({
    id,
    status: 'queued',
  });
  const running = service.tick();
  await Promise.resolve();
  await Promise.resolve();
  expect((await service.inspect(id)).status).toBe('running');
  await service.submit(id, 'AI haftalık rapor rutini oluştur');
  await expect(service.submit(id, 'Farklı içerik')).rejects.toMatchObject({ status: 409 });
  finish({ message: 'Rutini oluşturdum.' });
  await running;
  await service.tick();
  expect(await service.inspect(id)).toMatchObject({
    status: 'succeeded',
    result: { message: 'Rutini oluşturdum.' },
  });
  expect(chat).toHaveBeenCalledTimes(1);
});
it('keeps queued requests across a service replacement and hides credentials', async () => {
  const store = new MemoryStore();
  const chat = vi.fn().mockResolvedValue({ message: 'Tamamlandı.' });
  const first = new ChatRequests(store, { chat } as unknown as AssistantService);
  const id = crypto.randomUUID();
  await first.submit(id, 'Rutinleri göster');
  await new ChatRequests(store, { chat } as unknown as AssistantService).tick();
  expect((await first.inspect(id)).status).toBe('succeeded');
  await expect(first.submit(crypto.randomUUID(), 'GOCSPX-do-not-save')).rejects.toMatchObject({
    status: 400,
  });
});
