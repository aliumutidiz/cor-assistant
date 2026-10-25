import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import { MemoryStore, newJob } from '../server/repositories';
import { RoutineService, OperationService } from '../server/services';
import { PersonalMemory } from '../server/memory-service';
import { memoryInput } from '../shared/memory';
import { DemoCalendar } from '../server/google';
import {
  TelegramService,
  TelegramApi,
  TelegramApiError,
  type TelegramTransport,
  type Keyboard,
} from '../server/telegram';
import { loadConfig } from '../server/config';
import type { Job } from '../shared/contracts';
import { AppError } from '../server/errors';
const config = {
  ...loadConfig({
    NODE_ENV: 'test',
    TELEGRAM_OWNER_ID: '42',
    STT_ENABLED: 'true',
    STT_MODEL_PATH: 'fixture-model',
  }),
  TELEGRAM_ENABLED: true,
};
const incoming = (id = 1, extra: Record<string, unknown> = {}, owner = 42) => ({
  update_id: id,
  message: {
    message_id: id,
    date: Math.floor(Date.now() / 1000),
    from: { id: owner },
    chat: { id: owner, type: 'private' },
    ...extra,
  },
});
function setup(overrides: Partial<typeof config> = {}) {
  const store = new MemoryStore(),
    calendar = new DemoCalendar(),
    routines = new RoutineService(store),
    operations = new OperationService(store, calendar, routines);
  const api = {
    call: vi.fn<TelegramTransport['call']>().mockResolvedValue([]),
    download: vi.fn().mockResolvedValue(new Uint8Array([1, 2, 3])),
  };
  const speech = { transcribe: vi.fn().mockResolvedValue('Yarın saat 10 ile 11 arasına toplantı ekle.') };
  const assistant = { chat: vi.fn().mockResolvedValue({ message: 'İsteğin hazır.' }) };
  const service = new TelegramService(
    { ...config, ...overrides },
    store,
    api as unknown as TelegramTransport,
    speech,
    assistant,
    operations,
  );
  return { store, calendar, routines, operations, api, speech, assistant, service };
}
async function queue(h: ReturnType<typeof setup>, update: unknown) {
  await h.store.enqueue(
    newJob('telegram_incoming', 'tg:incoming:test:' + Math.random(), { telegram: { update } }),
  );
  await h.service.processIncoming();
}
describe('Telegram channel security and commands', () => {
  it('routes assistant failures to the originating allowed chat instead of the default group', async () => {
    const h = setup({ TELEGRAM_ALLOWED_CHAT_IDS: [-100111, -100222], TELEGRAM_CHAT_ID: -100111 });
    h.assistant.chat.mockRejectedValue(new AppError(503, 'Temporary model error'));
    await queue(h, incoming(1, { text: 'New request', chat: { id: -100222, type: 'supergroup' } }));
    await h.service.dispatch();
    expect(h.api.call).toHaveBeenCalledWith(
      'sendMessage',
      expect.objectContaining({ chat_id: -100222, text: 'Temporary model error' }),
      undefined,
    );
  });

  it('replies in the originating allowed group and rejects removed outgoing destinations', async () => {
    const groups = [-100111, -100222];
    const h = setup({ TELEGRAM_ALLOWED_CHAT_IDS: groups, TELEGRAM_CHAT_ID: groups[0] });
    await queue(h, incoming(1, { text: 'Merhaba', chat: { id: groups[1], type: 'supergroup' } }));
    await h.service.dispatch();
    expect(h.api.call).toHaveBeenCalledWith(
      'sendMessage',
      expect.objectContaining({ chat_id: groups[1] }),
      undefined,
    );
    h.api.call.mockClear();
    await queue(h, incoming(2, { text: 'Merhaba', chat: { id: groups[1], type: 'supergroup' } }));
    groups.splice(1, 1);
    await h.service.dispatch();
    expect(h.api.call).not.toHaveBeenCalledWith('sendMessage', expect.anything(), undefined);
  });
  it('sends formatted assistant replies as entities without a misleading queued suffix', async () => {
    const h = setup();
    const op = { status: 'succeeded' };
    h.assistant.chat.mockResolvedValue({
      message: '**Buz Pateni**\nTakvimine ekledim.',
      operation: op,
    } as never);
    await queue(h, incoming(1, { text: 'Yarın 15-16 Buz Pateni ekle' }));
    await h.service.dispatch();
    expect(h.api.call).toHaveBeenCalledWith(
      'sendMessage',
      expect.objectContaining({
        text: expect.stringContaining('Buz Pateni\nTakvimine ekledim.'),
        entities: expect.arrayContaining([expect.objectContaining({ type: 'bold', offset: 0, length: 10 })]),
      }),
      undefined,
    );
    const sent = h.api.call.mock.calls.find(([method]) => method === 'sendMessage')?.[1];
    expect(sent?.text).not.toContain('sıraya alındı');
    expect(sent?.text).not.toContain('**');
  });
  it('restricts group commands to both the configured group and owner', async () => {
    const h = setup({ TELEGRAM_CHAT_ID: -100321 });
    h.api.call.mockResolvedValue([
      incoming(1, { text: '/durum', chat: { id: -100321, type: 'group' } }),
      incoming(2, { text: '/durum', chat: { id: -100321, type: 'group' } }, 99),
      incoming(3, { text: '/durum', chat: { id: -100999, type: 'supergroup' } }),
      incoming(4, { text: '/durum' }),
    ]);
    await h.service.poll();
    expect((await h.store.jobs()).filter((j) => j.kind === 'telegram_incoming')).toHaveLength(1);
    await h.service.processIncoming();
    await h.service.dispatch();
    expect(h.api.call).toHaveBeenCalledWith(
      'sendMessage',
      expect.objectContaining({ chat_id: -100321 }),
      undefined,
    );
    expect(h.assistant.chat).not.toHaveBeenCalled();
  });
  it('accepts addressed commands in configured supergroups without a model call', async () => {
    const h = setup({ TELEGRAM_CHAT_ID: -100123 });
    await queue(h, incoming(1, { text: '/durum@cor_bot', chat: { id: -100123, type: 'supergroup' } }));
    expect(h.assistant.chat).not.toHaveBeenCalled();
    expect((await h.store.jobs()).some((j) => j.kind === 'telegram_outgoing')).toBe(true);
  });
  it('requires persistent configuration and numeric owner identity', () => {
    expect(() => loadConfig({ TELEGRAM_ENABLED: 'true' })).toThrow();
    expect(() =>
      loadConfig({
        TELEGRAM_ENABLED: 'true',
        TELEGRAM_BOT_TOKEN: '123:' + 'a'.repeat(30),
        TELEGRAM_OWNER_ID: '42',
      }),
    ).toThrow(/persistent/);
    expect(loadConfig({ TELEGRAM_OWNER_ID: '' }).TELEGRAM_OWNER_ID).toBeUndefined();
  });
  it('ignores unauthorized users before downloading audio or invoking the model', async () => {
    const h = setup();
    h.api.call.mockResolvedValue([incoming(1, { voice: { file_id: 'voice', duration: 5 } }, 99)]);
    await h.service.poll();
    expect(await h.store.jobs()).toHaveLength(0);
    expect(h.api.download).not.toHaveBeenCalled();
    expect(h.assistant.chat).not.toHaveBeenCalled();
    expect(await h.store.get('telegram.offset')).toBe(2);
  });
  it('rejects groups even if the sender is the owner', async () => {
    const h = setup();
    h.api.call.mockResolvedValue([
      { ...incoming(), message: { ...incoming().message, chat: { id: -1, type: 'group' } } },
    ]);
    await h.service.poll();
    expect(await h.store.jobs()).toHaveLength(0);
  });
  it('persists updates before advancing offset and deduplicates repeated deliveries', async () => {
    const h = setup();
    h.api.call.mockResolvedValue([incoming(4, { text: '/rutinler' })]);
    await h.service.poll();
    await h.service.poll();
    expect(await h.store.get('telegram.offset')).toBe(5);
    expect((await h.store.jobs()).filter((j) => j.kind === 'telegram_incoming')).toHaveLength(1);
  });
  it('keeps polling offset unchanged if persistence fails', async () => {
    const h = setup();
    h.api.call.mockResolvedValue([incoming(5, { text: '/rutinler' })]);
    vi.spyOn(h.store, 'enqueue').mockRejectedValueOnce(new Error('database offline'));
    await expect(h.service.poll()).rejects.toThrow();
    expect(await h.store.get('telegram.offset')).toBeUndefined();
  });
  it('lists routines without an LLM', async () => {
    const h = setup();
    await h.routines.seed();
    await queue(h, incoming(1, { text: '/rutinler' }));
    expect(h.assistant.chat).not.toHaveBeenCalled();
    expect(
      (await h.store.jobs()).find((j) => j.kind === 'telegram_outgoing')?.payload.telegram?.text,
    ).toContain('Güne bakış');
  });
  it('does not execute stale messages after a server outage', async () => {
    const h = setup();
    await queue(h, incoming(1, { text: 'Toplantıyı sil', date: 1 }));
    expect(h.assistant.chat).not.toHaveBeenCalled();
    expect(
      (await h.store.jobs()).find((j) => j.kind === 'telegram_outgoing')?.payload.telegram?.text,
    ).toContain('eski');
  });
  it('processes confident voice directly without transcript confirmation or a signature link', async () => {
    const h = setup();
    await queue(h, incoming(1, { voice: { file_id: 'voice', duration: 5, mime_type: 'audio/ogg' } }));
    expect(h.speech.transcribe).toHaveBeenCalledOnce();
    expect(h.assistant.chat).toHaveBeenCalledWith(
      'Yarın saat 10 ile 11 arasına toplantı ekle.',
      'telegram:1',
      expect.any(AbortSignal),
      'telegram:42',
    );
    const out = (await h.store.jobs()).find((j) => j.kind === 'telegram_outgoing')!;
    expect(out.payload.telegram?.text).not.toContain('Şöyle anladım');
    expect(out.payload.telegram?.text).not.toContain('C.O.R.:');
    expect(out.payload.telegram?.keyboard).toBeUndefined();
  });
  it('refuses excessive or unsupported voice messages gracefully', async () => {
    const h = setup();
    h.api.call.mockResolvedValue([incoming(1, { voice: { file_id: 'voice', duration: 121 } })]);
    await h.service.poll();
    expect(h.api.download).not.toHaveBeenCalled();
    expect((await h.store.jobs())[0].payload.telegram?.text).toContain('2 dakika');
  });
  it('does not invent a command when speech decoding is uncertain', async () => {
    const h = setup();
    h.speech.transcribe.mockRejectedValue(new AppError(422, 'Kaydı anlayamadım.'));
    await queue(h, incoming(1, { voice: { file_id: 'voice', duration: 5 } }));
    expect(h.assistant.chat).not.toHaveBeenCalled();
    expect(
      (await h.store.jobs()).find((j) => j.kind === 'telegram_outgoing')?.payload.telegram?.text,
    ).toContain('anlayamadım');
  });
  it('binds risk approval buttons to the persisted operation hash', async () => {
    const h = setup();
    const op = await h.operations.submit({ kind: 'calendar.create', summary: 'Spor' }, 'chat:telegram:1');
    h.assistant.chat.mockResolvedValue({ message: 'Onay gerekiyor.', operation: op } as never);
    await queue(h, incoming(1, { text: 'Spor takvimi oluştur' }));
    const out = (await h.store.jobs()).find((j) => j.kind === 'telegram_outgoing')!;
    expect(out.payload.telegram?.text).toContain('calendar.create');
    const data = (out.payload.telegram?.keyboard as Keyboard).inline_keyboard[0][0].callback_data;
    await queue(h, {
      update_id: 2,
      callback_query: {
        id: 'callback',
        from: { id: 42 },
        message: { chat: { id: 42, type: 'private' } },
        data,
      },
    });
    expect((await h.store.operation(op.id))?.status).toBe('succeeded');
    await queue(h, {
      update_id: 3,
      callback_query: { id: 'again', from: { id: 42 }, message: { chat: { id: 42, type: 'private' } }, data },
    });
    const replies = (await h.store.jobs()).filter((j) => j.kind === 'telegram_outgoing');
    expect(replies.at(-1)?.payload.telegram?.text).not.toContain('kullanılmış');
    expect((await h.store.jobs()).filter((j) => j.kind === 'operation')).toHaveLength(1);
  });
  it('does not lose an approval when the Telegram callback acknowledgement has expired', async () => {
    const h = setup();
    const op = await h.operations.submit({ kind: 'calendar.create', summary: 'Spor' }, 'chat:telegram:9');
    h.assistant.chat.mockResolvedValue({ message: 'Onay gerekiyor.', operation: op } as never);
    await queue(h, incoming(9, { text: 'Spor takvimi oluştur' }));
    const out = (await h.store.jobs()).find((j) => j.payload.telegram?.keyboard)!;
    const data = (out.payload.telegram?.keyboard as Keyboard).inline_keyboard[0][0].callback_data;
    h.api.call.mockRejectedValueOnce(new AppError(400, 'query is too old'));
    await queue(h, {
      update_id: 10,
      callback_query: {
        id: 'expired-toast',
        from: { id: 42 },
        message: { chat: { id: 42, type: 'private' } },
        data,
      },
    });
    expect((await h.store.operation(op.id))?.status).toBe('succeeded');
  });
  it('lets a legacy voice confirmation recover from provider failure without a consumed-token dead end', async () => {
    const h = setup(),
      nonce = 'a'.repeat(24);
    await h.store.putTransient(
      'tg:confirmation:' + nonce,
      { type: 'voice', text: 'deneme', requestKey: 'telegram:old' },
      new Date(Date.now() + 60000).toISOString(),
    );
    h.assistant.chat.mockRejectedValueOnce(new AppError(503, 'AGY geçici olarak yanıt veremedi.'));
    const callback = (id: number) => ({
      update_id: id,
      callback_query: {
        id: String(id),
        from: { id: 42 },
        message: { chat: { id: 42, type: 'private' } },
        data: 'yes:' + nonce,
      },
    });
    await queue(h, callback(1));
    await queue(h, callback(2));
    await queue(h, callback(3));
    expect(h.assistant.chat).toHaveBeenCalledTimes(2);
    expect(
      (await h.store.jobs()).find((j) => j.key === 'tg:reply:telegram:3:0')?.payload.telegram?.text,
    ).toBe('İsteğin hazır.');
  });
  it('cancels an undelivered task reminder after the task is completed', async () => {
    const h = setup(),
      memory = new PersonalMemory(h.store);
    await h.store.set('telegram.startedAt', new Date(Date.now() - 1000).toISOString());
    const task = await memory.execute(
      {
        kind: 'memory.create',
        record: memoryInput.parse({
          kind: 'task',
          title: 'Fatura',
          body: 'Faturayı öde.',
          remindAt: new Date(Date.now() - 1000).toISOString(),
        }),
      },
      crypto.randomUUID(),
    );
    await h.store.enqueue({
      ...newJob('routine', 'fixture-task-notification', {
        taskReminder: { memoryId: task.id, remindAt: task.remindAt! },
      }),
      status: 'succeeded',
      finishedAt: new Date().toISOString(),
      result: { type: 'task_reminder', title: task.title, message: task.body },
    });
    await h.service.collectNotifications();
    await memory.execute(
      { kind: 'memory.complete', memoryId: task.id, version: task.version },
      crypto.randomUUID(),
    );
    await h.service.dispatch();
    expect(h.api.call).not.toHaveBeenCalled();
  });
  it('collects reminder notifications durably without running a model', async () => {
    const h = setup();
    await h.store.set('telegram.startedAt', new Date(Date.now() - 1000).toISOString());
    const r = {
      id: crypto.randomUUID(),
      name: 'Sabah',
      cron: '0 7 * * *',
      timeZone: 'Europe/Istanbul',
      kind: 'reminder' as const,
      message: 'Hapını iç.',
      enabled: true,
      version: 1,
      nextRun: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    const j = {
      ...newJob('routine', 'routine-fixture', { routine: r }),
      status: 'succeeded' as const,
      finishedAt: new Date().toISOString(),
      result: { message: r.message },
    };
    await h.store.enqueue(j);
    await h.service.collectNotifications();
    await h.service.collectNotifications();
    const outgoing = (await h.store.jobs()).filter((j) => j.kind === 'telegram_outgoing');
    expect(outgoing).toHaveLength(1);
    expect(outgoing[0].payload.telegram?.text).toContain('Hapını iç.');
    expect(h.assistant.chat).not.toHaveBeenCalled();
    await h.service.dispatch();
    expect(h.api.call).toHaveBeenCalledWith(
      'sendMessage',
      expect.objectContaining({ chat_id: 42, text: expect.stringContaining('Hapını iç.') }),
      undefined,
    );
  });
  it('does not retry an ambiguous send, but honors explicit Telegram retry_after', async () => {
    const h = setup();
    await h.service.reply('a', 'Test');
    h.api.call.mockRejectedValueOnce(new TelegramApiError(502, 'unknown', true));
    await h.service.dispatch();
    expect((await h.store.jobs())[0].status).toBe('unknown');
    expect(await h.service.dispatch()).toBe(false);
    await h.service.reply('b', 'Retry');
    h.api.call.mockRejectedValueOnce(new TelegramApiError(429, 'rate', false, 30));
    await h.service.dispatch();
    const queued = (await h.store.jobs()).find((j) => j.status === 'queued')!;
    expect(Date.parse(queued.scheduledAt)).toBeGreaterThan(Date.now() + 29000);
  });
  it('keeps Telegram jobs out of the calendar worker queue', async () => {
    const h = setup();
    await h.service.reply('a', 'Test');
    expect(await h.store.claim()).toBeUndefined();
    expect((await h.store.claim(['telegram_outgoing']))?.kind).toBe('telegram_outgoing');
  });
});
afterEach(() => vi.unstubAllGlobals());
describe('Telegram transport and voice downloads', () => {
  it('does not expose token-bearing URLs on a failed request', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('https://secret-token')));
    await expect(new TelegramApi('private-token').call('sendMessage', {})).rejects.toMatchObject({
      message: 'Telegram bağlantısı kesildi.',
      uncertain: true,
    });
  });
  it('rejects malicious file paths before downloading', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ ok: true, result: { file_path: '../secret' } })));
    vi.stubGlobal('fetch', fetch);
    await expect(new TelegramApi('token').download('file')).rejects.toThrow(/yolu/);
    expect(fetch).toHaveBeenCalledOnce();
  });
  it('enforces download size even if Telegram metadata omits it', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValueOnce(
          new Response(JSON.stringify({ ok: true, result: { file_path: 'voice/file.oga' } })),
        )
        .mockResolvedValueOnce(new Response('x', { headers: { 'content-length': String(9 * 1024 * 1024) } })),
    );
    await expect(new TelegramApi('token').download('file')).rejects.toMatchObject({ status: 413 });
  });
});
