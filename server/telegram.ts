import { randomBytes } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { z } from 'zod';
import type { Config } from './config.js';
import type { Store } from './repositories.js';
import { newJob } from './repositories.js';
import type { Job, Operation } from '../shared/contracts.js';
import type { AssistantService } from './provider.js';
import type { OperationService } from './services.js';
import type { SpeechTranscriber } from './speech.js';
import { AppError } from './errors.js';
import { telegramMarkdown } from './telegram-markdown.js';
import { operationMessage } from '../shared/operation-message.js';
import { AsyncLocalStorage } from 'node:async_hooks';

const actor = z.object({ id: z.number().int().positive(), is_bot: z.boolean().optional() });
const chat = z.object({ id: z.number().int(), type: z.string() });
const message = z.object({
  message_id: z.number().int(),
  date: z.number().int(),
  from: actor.optional(),
  chat,
  text: z.string().max(6000).optional(),
  voice: z
    .object({
      file_id: z.string().min(1).max(1000),
      duration: z.number().nonnegative().max(120),
      file_size: z
        .number()
        .int()
        .positive()
        .max(8 * 1024 * 1024)
        .optional(),
      mime_type: z.enum(['audio/ogg', 'audio/opus', 'audio/mpeg', 'audio/mp4', 'audio/wav']).optional(),
    })
    .optional(),
});
export const telegramUpdate = z
  .object({
    update_id: z.number().int().nonnegative(),
    message: message.optional(),
    callback_query: z
      .object({
        id: z.string().max(200),
        from: actor,
        data: z.string().max(64).optional(),
        message: z.object({ chat }).optional(),
      })
      .optional(),
  })
  .refine(
    (u) => Boolean(u.message) !== Boolean(u.callback_query),
    'Exactly one message or callback is required',
  );
type Update = z.infer<typeof telegramUpdate>;
export type Keyboard = { inline_keyboard: { text: string; callback_data: string }[][] };
export interface TelegramTransport {
  call<T>(method: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<T>;
  download(fileId: string, signal?: AbortSignal): Promise<Uint8Array>;
}
export class TelegramApiError extends AppError {
  constructor(
    status: number,
    message: string,
    uncertain = false,
    public retryAfter?: number,
  ) {
    super(status, message, uncertain);
  }
}
export class TelegramApi implements TelegramTransport {
  constructor(private token: string) {}
  async call<T>(method: string, body: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
    if (
      !['getUpdates', 'getMe', 'getWebhookInfo', 'sendMessage', 'answerCallbackQuery', 'getFile'].includes(
        method,
      )
    )
      throw new AppError(400, 'Desteklenmeyen Telegram metodu.');
    let r: Response;
    try {
      r = await fetch(`https://api.telegram.org/bot${this.token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        signal: AbortSignal.any([
          AbortSignal.timeout(method === 'getUpdates' ? 35000 : 20000),
          ...(signal ? [signal] : []),
        ]),
      });
    } catch {
      throw new TelegramApiError(502, 'Telegram bağlantısı kesildi.', method === 'sendMessage');
    }
    let raw: unknown;
    try {
      raw = await r.json();
    } catch {
      throw new TelegramApiError(502, 'Telegram geçersiz yanıt verdi.', method === 'sendMessage');
    }
    const x = z
      .object({
        ok: z.boolean(),
        result: z.unknown().optional(),
        error_code: z.number().optional(),
        parameters: z.object({ retry_after: z.number().int().positive().max(3600).optional() }).optional(),
      })
      .safeParse(raw);
    if (!x.success)
      throw new TelegramApiError(502, 'Telegram yanıtı doğrulanamadı.', method === 'sendMessage');
    if (!x.data.ok || !r.ok)
      throw new TelegramApiError(
        x.data.error_code ?? 502,
        'Telegram isteği reddedildi (' + (x.data.error_code ?? r.status) + ').',
        (r.status >= 500 || (x.data.error_code ?? 0) >= 500) && method === 'sendMessage',
        x.data.parameters?.retry_after,
      );
    return x.data.result as T;
  }
  async download(fileId: string, signal?: AbortSignal) {
    const file = z
      .object({
        file_path: z.string().min(1),
        file_size: z
          .number()
          .max(8 * 1024 * 1024)
          .optional(),
      })
      .parse(await this.call('getFile', { file_id: fileId }, signal));
    if (
      !/^[A-Za-z0-9_./-]+$/.test(file.file_path) ||
      file.file_path.startsWith('/') ||
      file.file_path.split('/').some((p) => p === '..' || p === '.' || !p)
    )
      throw new AppError(400, 'Ses dosyasının yolu geçersiz.');
    let r: Response;
    try {
      r = await fetch(
        `https://api.telegram.org/file/bot${this.token}/` +
          file.file_path.split('/').map(encodeURIComponent).join('/'),
        { signal: AbortSignal.any([AbortSignal.timeout(20000), ...(signal ? [signal] : [])]) },
      );
    } catch {
      throw new AppError(502, 'Ses dosyası indirilemedi.');
    }
    if (!r.ok || !r.body) throw new AppError(502, 'Ses dosyası indirilemedi.');
    if (Number(r.headers.get('content-length')) > 8 * 1024 * 1024) {
      await r.body.cancel();
      throw new AppError(413, 'Ses kaydı çok büyük.');
    }
    const reader = r.body.getReader(),
      chunks: Uint8Array[] = [];
    let total = 0;
    try {
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        total += value.length;
        if (total > 8 * 1024 * 1024) throw new AppError(413, 'Ses kaydı çok büyük.');
        chunks.push(value);
      }
    } finally {
      await reader.cancel();
    }
    if (!total) throw new AppError(422, 'Ses kaydı boş.');
    return Buffer.concat(chunks);
  }
}
type Confirmation =
  | { type: 'voice'; text: string; requestKey: string }
  | { type: 'approval'; operationId: string; hash: string };
type ConfirmationReceipt = {
  record: Confirmation;
  expiresAt: string;
  choice?: 'yes' | 'no';
  message?: string;
  state: 'ready' | 'processing' | 'done' | 'failed';
};
export class TelegramService {
  private replyChat = new AsyncLocalStorage<number>();
  constructor(
    private config: Config,
    private store: Store,
    private api: TelegramTransport,
    private speech: SpeechTranscriber,
    private assistant: Pick<AssistantService, 'chat'>,
    private operations: OperationService,
  ) {}
  private allowedChat(target?: { id: number; type: string }) {
    const groups = this.config.TELEGRAM_ALLOWED_CHAT_IDS?.length
      ? this.config.TELEGRAM_ALLOWED_CHAT_IDS
      : this.config.TELEGRAM_CHAT_ID
        ? [this.config.TELEGRAM_CHAT_ID]
        : [];
    return groups.length
      ? !!target && groups.includes(target.id) && ['group', 'supergroup'].includes(target.type)
      : target?.type === 'private' && target.id === this.config.TELEGRAM_OWNER_ID;
  }
  private owned(u: Update) {
    const from = u.message?.from ?? u.callback_query?.from;
    const target = u.message?.chat ?? u.callback_query?.message?.chat;
    return Boolean(
      from && from.id === this.config.TELEGRAM_OWNER_ID && !from.is_bot && this.allowedChat(target),
    );
  }
  async initialize(signal?: AbortSignal) {
    await this.api.call('getMe', {}, signal);
    const hook = await this.api.call<{ url: string }>('getWebhookInfo', {}, signal);
    if (hook.url) throw new AppError(409, 'Botta webhook tanımlı. Long polling için önce kaldırın.');
    if (!(await this.store.get('telegram.startedAt')))
      await this.store.set('telegram.startedAt', new Date().toISOString());
    await this.store.set('telegram.status', { state: 'connected', updatedAt: new Date().toISOString() });
  }
  async poll(signal?: AbortSignal) {
    const offset = (await this.store.get<number>('telegram.offset')) ?? 0;
    const result = z
      .array(z.unknown())
      .parse(
        await this.api.call(
          'getUpdates',
          { offset, timeout: 25, limit: 25, allowed_updates: ['message', 'callback_query'] },
          signal,
        ),
      );
    let next = offset;
    for (const raw of result) {
      const id = z.object({ update_id: z.number().int().nonnegative() }).parse(raw).update_id;
      if (id < offset) continue;
      next = Math.max(next, id + 1);
      const parsed = telegramUpdate.safeParse(raw);
      if (parsed.success && this.owned(parsed.data))
        await this.store.enqueue(
          newJob('telegram_incoming', 'tg:incoming:' + id, { telegram: { update: parsed.data } }),
        );
      else if (!parsed.success) {
        const owner = z.object({ message: z.object({ from: actor, chat }) }).safeParse(raw);
        if (
          owner.success &&
          owner.data.message.from.id === this.config.TELEGRAM_OWNER_ID &&
          !owner.data.message.from.is_bot &&
          this.allowedChat(owner.data.message.chat)
        )
          await this.reply(
            'invalid:' + id,
            'Bu mesaj desteklenmiyor. Ses kaydı en fazla 2 dakika ve 8 MB olmalı; daha kısa bir kayıt veya yazılı komut gönderin.',
          );
      }
    }
    await this.store.set('telegram.offset', next);
    await this.store.set('telegram.status', { state: 'connected', updatedAt: new Date().toISOString() });
  }
  async reply(key: string, text: string, keyboard?: Keyboard) {
    await this.enqueueFormatted('tg:reply:' + key + ':0', text, keyboard);
  }
  private async enqueueFormatted(
    key: string,
    text: string,
    keyboard?: Keyboard,
    taskReminder?: Job['payload']['taskReminder'],
    reminder?: Job['payload']['reminder'],
  ) {
    const chunks = telegramMarkdown(text);
    for (let i = 0; i < chunks.length; i++)
      await this.store.enqueue(
        newJob('telegram_outgoing', i === 0 ? key : key + ':part:' + i, {
          ...(taskReminder ? { taskReminder } : {}),
          ...(reminder ? { reminder } : {}),
          telegram: {
            ...(this.replyChat.getStore() ? { chatId: this.replyChat.getStore() } : {}),
            ...chunks[i],
            ...(i === chunks.length - 1 && keyboard ? { keyboard } : {}),
          },
        }),
      );
  }
  private async confirm(record: Confirmation) {
    const nonce = randomBytes(18).toString('base64url');
    await this.store.set('tg:confirmation-receipt:' + nonce, {
      record,
      state: 'ready',
      expiresAt: new Date(Date.now() + 10 * 60000).toISOString(),
    } satisfies ConfirmationReceipt);
    return {
      inline_keyboard: [
        [
          { text: 'Onayla', callback_data: 'yes:' + nonce },
          { text: 'Vazgeç', callback_data: 'no:' + nonce },
        ],
      ],
    };
  }
  async processIncoming(signal?: AbortSignal) {
    const job = await this.store.claim(['telegram_incoming']);
    if (!job) return false;
    try {
      const u = telegramUpdate.parse(job.payload.telegram?.update);
      if (!this.owned(u)) throw new AppError(403, 'Telegram kimliği doğrulanamadı.');
      const target = u.message?.chat.id ?? u.callback_query?.message?.chat.id;
      await this.replyChat.run(target!, () =>
        this.handle(u, AbortSignal.any([AbortSignal.timeout(8 * 60000), ...(signal ? [signal] : [])])),
      );
      job.status = 'succeeded';
    } catch (e) {
      job.status = 'failed';
      job.error = e instanceof AppError ? e.message : 'Telegram komutu tamamlanamadı.';
      await this.reply('error:' + job.id, job.error);
    }
    job.finishedAt = new Date().toISOString();
    await this.store.finish(job);
    return true;
  }
  private async handle(u: Update, signal?: AbortSignal) {
    const key = 'telegram:' + u.update_id;
    if (u.callback_query) {
      const q = u.callback_query;
      // An expired Telegram toast must not discard an otherwise valid owner approval.
      await this.api
        .call('answerCallbackQuery', { callback_query_id: q.id, text: 'İsteğini aldım.' }, signal)
        .catch(() => {});
      const match = /^(yes|no):([A-Za-z0-9_-]{24})$/.exec(q.data ?? '');
      if (!match) throw new AppError(400, 'Geçersiz onay.');
      const receiptKey = 'tg:confirmation-receipt:' + match[2];
      let receipt = await this.store.get<ConfirmationReceipt>(receiptKey);
      if (!receipt) {
        // Previously sent keyboards remain usable during the upgrade.
        const old = await this.store.takeTransient<Confirmation>('tg:confirmation:' + match[2]);
        if (old)
          receipt = {
            record: old,
            state: 'ready',
            expiresAt: new Date(Date.now() + 10 * 60000).toISOString(),
          };
      }
      if (!receipt) throw new AppError(409, 'Onay bulunamadı veya süresi doldu. İsteğini yeniden gönder.');
      if (receipt.state === 'done' || (receipt.choice && receipt.choice !== match[1])) {
        if (receipt.record.type === 'approval') {
          const operation = await this.store.operation(receipt.record.operationId);
          if (operation) {
            const prefs = await this.store.get<{ timeZone: string; language?: string }>('preferences');
            receipt.message = operationMessage(operation, prefs?.timeZone, prefs?.language ?? 'en');
          }
        }
        await this.reply(key, receipt.message ?? 'Bu isteği daha önce aldım; tekrar uygulamıyorum.');
        return;
      }
      if (Date.parse(receipt.expiresAt) < Date.now())
        throw new AppError(409, 'Onayın süresi doldu. İsteğini yeniden gönder.');
      receipt.choice = match[1] as 'yes' | 'no';
      receipt.state = 'processing';
      await this.store.set(receiptKey, receipt);
      const record = receipt.record;
      try {
        if (match[1] === 'no') {
          if (record.type === 'approval') await this.operations.cancel(record.operationId);
          receipt.message = 'İsteği iptal ettim.';
        } else if (record.type === 'voice') {
          await this.reply(key + ':accepted', 'Sesli isteğini işliyorum.');
          receipt.message = await this.interpret(record.text, record.requestKey, signal);
        } else {
          let operation = await this.store.operation(record.operationId);
          if (!operation || operation.hash !== record.hash) throw new AppError(409, 'Onay içeriği değişmiş.');
          if (operation.status === 'awaiting_approval')
            operation = await this.operations.approve(record.operationId, record.hash);
          if (operation.status === 'queued') {
            try {
              await this.operations.execute(operation.id);
            } catch {
              /* Read persisted outcome below. */
            }
            operation = (await this.store.operation(operation.id)) ?? operation;
          }
          const prefs = await this.store.get<{ timeZone: string; language?: string }>('preferences');
          receipt.message = operationMessage(operation, prefs?.timeZone, prefs?.language ?? 'en');
        }
        receipt.state = 'done';
        await this.store.set(receiptKey, receipt);
        if (record.type === 'approval' && match[1] === 'yes') {
          const outcome = await this.store.operation(record.operationId);
          if (outcome && ['succeeded', 'failed', 'unknown'].includes(outcome.status))
            await this.enqueueFormatted('tg:op:' + record.operationId, receipt.message!);
          else await this.reply(key, receipt.message!);
        } else if (record.type !== 'voice' || match[1] === 'no') await this.reply(key, receipt.message!);
      } catch (error) {
        receipt.state = 'failed';
        await this.store.set(receiptKey, receipt);
        throw error;
      }
      return;
    }
    const m = u.message!;
    if (Date.now() / 1000 - m.date > 15 * 60)
      throw new AppError(
        409,
        'Bu mesaj eski olduğu için otomatik işlenmedi. Güncel isteğinizi yeniden gönderin.',
      );
    const window = await this.store.get<{ at: number; count: number }>('telegram.inboundRate');
    const current = !window || Date.now() - window.at > 60000 ? { at: Date.now(), count: 0 } : window;
    if (current.count >= 12) throw new AppError(429, 'Çok fazla komut. Bir dakika sonra yeniden deneyin.');
    await this.store.set('telegram.inboundRate', { ...current, count: current.count + 1 });
    if (m.voice) {
      if (!this.config.STT_ENABLED)
        throw new AppError(
          503,
          'Sesli mesaj çözümleme henüz kurulmadı. Şimdilik yazılı komut gönderebilirsiniz.',
        );
      const audio = await this.api.download(m.voice.file_id, signal);
      const text = await this.speech.transcribe(audio, signal);
      await this.interpret(text, key, signal);
      return;
    }
    const text = m.text?.trim().replace(/^(\/[a-z]+)@[A-Za-z0-9_]+(?=\s|$)/, '$1');
    if (!text) throw new AppError(400, 'Yazılı komut veya sesli mesaj gönderin.');
    if (/^\/(start|yardim|help)(?:\s|$)/.test(text)) {
      await this.reply(
        key,
        'C.O.R. bağlantısı hazır.\n/rutinler — rutinlerini göster\n/durum — bağlantıları kontrol et\n\nTakvim, görev veya rutin isteğini yazabilir, sesli mesaj gönderebilirsin. Anlaşılan sesli komutları doğrudan işlerim; riskli işlemlerde ayrıca onay isterim. Sabit bildirimler LLM kullanmaz.',
      );
      return;
    }
    if (text === '/durum') {
      await this.reply(
        key,
        `Telegram bağlı.\nSes çözümleme: ${this.config.STT_ENABLED ? 'yerel model etkin, doğrudan işlenir' : 'kurulum bekliyor'}\nAGY: ${this.config.AGY_ENABLED ? 'etkin' : 'doğrulama bekliyor'}\nSabit mesajlar ve görev hatırlatmaları LLM kullanmaz. AI raporları AGY kullanır.`,
      );
      return;
    }
    if (text === '/rutinler') {
      const routines = await this.store.routines();
      await this.reply(
        key,
        routines.length
          ? routines
              .map(
                (r) =>
                  `${r.name} — ${r.enabled ? 'etkin' : 'duraklatıldı'}\n${r.cron} · ${r.timeZone}\n${r.kind.startsWith('ai_') ? 'AGY raporu' : 'LLM kullanmaz'}`,
              )
              .join('\n\n')
          : 'Henüz rutin yok.',
      );
      return;
    }
    if (text === '/gorevler') {
      const page = await this.store.memories({ query: '', kind: 'task', archived: false, limit: 20 });
      await this.reply(
        key,
        page.items.length
          ? page.items.map((r) => '• ' + r.title).join('\n') +
              (page.next ? '\nİlk 20 görevi gösterdim. Ayrıntıları Kayıtlarım ekranında görebilirsin.' : '')
          : 'Açık görevin yok.',
      );
      return;
    }
    if (text === '/hatirlatmalar' || text === '/hatırlatmalar') {
      const reminders = (await this.store.reminders()).filter((r) => r.state === 'scheduled');
      const zone =
        (await this.store.get<{ timeZone: string; language?: string }>('preferences'))?.timeZone ??
        'Europe/Istanbul';
      await this.reply(
        key,
        reminders.length
          ? reminders
              .slice(0, 30)
              .map(
                (r) =>
                  `${r.title} — ${r.enabled ? 'planlandı' : 'duraklatıldı'}\n${r.remindAt ? new Intl.DateTimeFormat('tr-TR', { timeZone: zone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(r.remindAt)) : 'Sonraki etkinlik bekleniyor'}`,
              )
              .join('\n\n') + (reminders.length > 30 ? '\nİlk 30 hatırlatmayı gösterdim.' : '')
          : 'Bekleyen hatırlatman yok.',
      );
      return;
    }
    await this.interpret(text, key, signal);
  }
  private async interpret(text: string, key: string, signal?: AbortSignal) {
    const result = (await this.assistant.chat(
      text,
      key,
      signal,
      'telegram:' + String(this.replyChat.getStore() ?? 'private'),
    )) as {
      message: string;
      operation?: Operation;
    };
    let keyboard: Keyboard | undefined;
    if (result.operation && this.replyChat.getStore())
      await this.store.set('telegram.operation-chat:' + result.operation.id, this.replyChat.getStore());
    if (result.operation?.status === 'awaiting_approval')
      keyboard = await this.confirm({
        type: 'approval',
        operationId: result.operation.id,
        hash: result.operation.hash,
      });
    const message =
      result.message +
      (result.operation?.status === 'awaiting_approval'
        ? '\n\nİşlem ayrıntıları:\n```json\n' + JSON.stringify(result.operation.action, null, 2) + '\n```'
        : '');
    if (result.operation?.id && ['succeeded', 'failed', 'unknown'].includes(result.operation.status))
      await this.enqueueFormatted('tg:op:' + result.operation.id, message, keyboard);
    else await this.reply(key, message, keyboard);
    return result.message;
  }
  async collectNotifications() {
    const since = await this.store.get<string>('telegram.startedAt');
    if (!since) return;
    const pending = await this.store.pendingNotifications(since);
    for (const j of pending.jobs) {
      if (j.payload.reminder && j.status !== 'succeeded') continue;
      if ((j.result as { skipped?: boolean })?.skipped) {
        await this.store.enqueue(newJob('telegram_outgoing', 'tg:job:' + j.id, { telegram: { text: '' } }));
        continue;
      }
      const r = j.payload.routine;
      const data = (j.result ?? {}) as {
        type?: string;
        title?: string;
        message?: string;
        events?: { summary: string; start: { dateTime?: string; date?: string } }[];
        conflicts?: { first: string; second: string }[];
      };
      const text =
        j.status !== 'succeeded'
          ? `Rutin tamamlanamadı: ${r?.name ?? 'Rutin'}\n${j.error ?? 'Sonuç belirsiz; işlem geçmişini kontrol edin.'}`
          : data.type === 'task_reminder' || (data.type === 'reminder' && j.payload.reminder)
            ? `Hatırlatma: ${data.title}\n${data.message}`
            : r?.kind === 'reminder'
              ? `${r.name}\n${data.message}`
              : r?.name +
                '\n' +
                (data.message ?? '') +
                '\n' +
                (data.events
                  ?.map(
                    (e) =>
                      (e.start.dateTime
                        ? new Intl.DateTimeFormat('tr-TR', {
                            timeZone: r?.timeZone ?? 'Europe/Istanbul',
                            day: 'numeric',
                            month: 'short',
                            hour: '2-digit',
                            minute: '2-digit',
                          }).format(new Date(e.start.dateTime))
                        : e.start.date + ' (tüm gün)') +
                      ' — ' +
                      e.summary,
                  )
                  .join('\n') ??
                  data.conflicts?.map((c) => c.first + ' / ' + c.second).join('\n') ??
                  '');
      await this.enqueueFormatted(
        'tg:job:' + j.id,
        text,
        undefined,
        j.payload.taskReminder,
        j.payload.reminder,
      );
    }
    const preferences = await this.store.get<{ timeZone: string; language?: string }>('preferences');
    for (const o of pending.operations) {
      const target = await this.store.get<number>('telegram.operation-chat:' + o.id);
      if (target)
        await this.replyChat.run(target, () =>
          this.enqueueFormatted(
            'tg:op:' + o.id,
            operationMessage(o, preferences?.timeZone, preferences?.language ?? 'en'),
          ),
        );
      else
        await this.enqueueFormatted(
          'tg:op:' + o.id,
          operationMessage(o, preferences?.timeZone, preferences?.language ?? 'en'),
        );
    }
  }
  async dispatch(signal?: AbortSignal) {
    const job = await this.store.claim(['telegram_outgoing']);
    if (!job) return false;
    let sendStarted = false;
    try {
      const reminder = job.payload.taskReminder;
      const task = reminder ? await this.store.memory(reminder.memoryId) : undefined;
      const canceled =
        reminder &&
        (!task || task.archived || task.taskState === 'done' || task.remindAt !== reminder.remindAt);
      const standalone = job.payload.reminder;
      const current = standalone ? await this.operations.reminders.current(standalone) : undefined;
      if (job.payload.telegram?.text && !canceled && (!standalone || current)) {
        const destination =
          job.payload.telegram.chatId ?? this.config.TELEGRAM_CHAT_ID ?? this.config.TELEGRAM_OWNER_ID;
        if (
          !destination ||
          !this.allowedChat({ id: destination, type: destination < 0 ? 'group' : 'private' })
        )
          throw new AppError(403, 'Bildirim hedefi artık izinli değil.');
        sendStarted = true;
        await this.api.call(
          'sendMessage',
          {
            chat_id: destination,
            text: job.payload.telegram.text,
            ...(job.payload.telegram.entities ? { entities: job.payload.telegram.entities } : {}),
            ...(job.payload.telegram.keyboard ? { reply_markup: job.payload.telegram.keyboard } : {}),
            link_preview_options: { is_disabled: true },
          },
          signal,
        );
        if (standalone) await this.operations.reminders.delivered(standalone, current?.repeating);
      }
      job.status = 'succeeded';
    } catch (e) {
      const attempts = job.payload.telegram?.attempts ?? 0;
      if (job.payload.reminder && !sendStarted) {
        job.status = 'queued';
        job.scheduledAt = new Date(Date.now() + 60000).toISOString();
      } else if (e instanceof TelegramApiError && e.retryAfter && attempts < 3) {
        job.status = 'queued';
        job.scheduledAt = new Date(Date.now() + e.retryAfter * 1000).toISOString();
        job.payload.telegram!.attempts = attempts + 1;
      } else {
        job.status =
          (e instanceof AppError && e.uncertain) || (sendStarted && !(e instanceof TelegramApiError))
            ? 'unknown'
            : 'failed';
        job.error = e instanceof AppError ? e.message : 'Telegram gönderimi başarısız.';
        if (job.payload.reminder) {
          const record = await this.store.reminder(job.payload.reminder.id);
          if (record?.version === job.payload.reminder.version)
            await this.store
              .saveReminder(
                {
                  ...record,
                  lastError:
                    job.status === 'unknown'
                      ? 'Telegram gönderiminin sonucu belirsiz. Tekrar göndermeden sohbeti kontrol et.'
                      : job.error,
                },
                record.version,
              )
              .catch(() => {});
        }
      }
    }
    if (job.status !== 'queued') job.finishedAt = new Date().toISOString();
    await this.store.finish(job);
    await this.store.set('telegram.delivery', {
      state: job.status,
      error: job.error,
      updatedAt: new Date().toISOString(),
    });
    return true;
  }
}
export function startTelegram(service: TelegramService, store: Store) {
  const stop = new AbortController();
  const run = async (task: () => Promise<unknown>, pause: number) => {
    while (!stop.signal.aborted) {
      let wait = pause;
      try {
        await task();
      } catch (error) {
        wait = error instanceof TelegramApiError && error.retryAfter ? error.retryAfter * 1000 : 5000;
        if (!stop.signal.aborted)
          await store
            .set('telegram.status', {
              state: 'error',
              message: 'Telegram bağlantısını ve bot yapılandırmasını kontrol edin.',
              updatedAt: new Date().toISOString(),
            })
            .catch(() => {});
      }
      try {
        await delay(wait, undefined, { signal: stop.signal });
      } catch {
        break;
      }
    }
  };
  let loops: Promise<unknown>[] = [];
  const ready = (async () => {
    try {
      await service.initialize(stop.signal);
      loops = [
        run(() => service.poll(stop.signal), 1000),
        run(() => service.processIncoming(stop.signal), 1000),
        run(async () => {
          await service.collectNotifications();
          await service.dispatch(stop.signal);
        }, 1000),
      ];
      await Promise.all(loops);
    } catch {
      await store
        .set('telegram.status', {
          state: 'error',
          message: 'Telegram başlatılamadı. Bot anahtarını ve webhook ayarını kontrol edin.',
          updatedAt: new Date().toISOString(),
        })
        .catch(() => {});
    }
  })();
  return async () => {
    stop.abort();
    await ready;
  };
}
