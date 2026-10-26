import { readConversationState } from './chat-state.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AssistantService } from './provider.js';
import type { Store } from './repositories.js';
import { newJob } from './repositories.js';
import { requestKey } from './security.js';
import { digest } from './crypto.js';
import { AppError } from './errors.js';
import { containsCredential } from './sensitive.js';
type RequestState = {
  hash: string;
  contextId?: string;
  status: 'queued' | 'running' | 'succeeded' | 'failed';
  result?: unknown;
  error?: string;
};

/** Durable generation keeps HTTP connections short without bypassing guarded operations. */
export class ChatRequests {
  private active?: Promise<void>;
  private stopSignal = new AbortController();
  constructor(
    private store: Store,
    private assistant: AssistantService,
  ) {}
  async submit(id: string, message: string, expectedContext?: string) {
    const context = await readConversationState(this.store);
    if (expectedContext && expectedContext !== context.contextId)
      throw new AppError(409, 'Conversation context changed. Reload the conversation before sending.');
    if (containsCredential(message))
      throw new AppError(400, 'Bağlantı anahtarlarını sohbete yazma. Ayarlar alanını kullan.');
    const state = await this.store.setIfAbsent<RequestState>('assistant.request:' + id, {
      hash: digest(message),
      contextId: context.contextId,
      status: 'queued',
    });
    if (state.hash !== digest(message))
      throw new AppError(409, 'İstek anahtarı başka bir mesajla kullanılmış.');
    if (state.status === 'queued')
      await this.store.enqueue(newJob('assistant', 'assistant:' + id, { chatRequest: { id, message } }));
    return { id, status: state.status };
  }
  async inspect(id: string) {
    const state = await this.store.get<RequestState>('assistant.request:' + id);
    if (!state) throw new AppError(404, 'Sohbet isteği bulunamadı.');
    return { status: state.status, result: state.result, error: state.error };
  }
  async tick() {
    if (this.active || this.stopSignal.signal.aborted) return;
    const task = this.run();
    this.active = task;
    try {
      await task;
    } finally {
      this.active = undefined;
    }
  }
  private async run() {
    const job = await this.store.claim(['assistant']);
    if (!job) return;
    if (!job.payload.chatRequest) {
      job.status = 'failed';
      job.error = 'The saved assistant job is missing its request payload.';
      job.finishedAt = new Date().toISOString();
      await this.store.finish(job);
      return;
    }
    const { id, message } = job.payload.chatRequest;
    const key = 'assistant.request:' + id;
    const state = await this.store.get<RequestState>(key);
    if (!state || ['succeeded', 'failed'].includes(state.status)) {
      job.status = state?.status === 'succeeded' ? 'succeeded' : 'failed';
      if (job.status === 'failed')
        job.error =
          state?.error ?? 'The saved chat request is unavailable. Check Activity before resubmitting.';
      job.finishedAt = new Date().toISOString();
      await this.store.finish(job);
      return;
    }
    try {
      await this.store.set(key, { ...state, status: 'running' });
      const result = await this.assistant.chat(
        message,
        'web:' + id,
        AbortSignal.any([this.stopSignal.signal, AbortSignal.timeout(8 * 60000)]),
        'web',
        state.contextId,
      );
      await this.store.set(key, { ...state, status: 'succeeded', result });
      job.status = 'succeeded';
    } catch (e) {
      if (this.stopSignal.signal.aborted) {
        await this.store.set(key, { ...state, status: 'queued' });
        job.status = 'queued';
        job.scheduledAt = new Date().toISOString();
        await this.store.finish(job);
        return;
      }
      const error =
        e instanceof AppError ? e.message : 'Sohbet tamamlanamadı. İşlem geçmişinden durumu kontrol et.';
      const context = await readConversationState(this.store);
      if (!containsCredential(message) && (!state.contextId || state.contextId === context.contextId))
        await this.store.appendConversation('chat:web:' + id, message, error);
      await this.store.set(key, { ...state, status: 'failed', error });
      job.status = 'failed';
      job.error = error;
    }
    job.finishedAt = new Date().toISOString();
    await this.store.finish(job);
  }
  async stop() {
    this.stopSignal.abort();
    await this.active?.catch(() => {});
  }
}
export function chatRequestRoutes(app: FastifyInstance, service: ChatRequests) {
  app.post(
    '/api/chat/requests',
    { config: { rateLimit: { max: 12, timeWindow: 60000 } } },
    async (req, reply) => {
      const id = z.uuid().parse(requestKey(req));
      const { message, contextId } = z
        .object({ message: z.string().trim().min(1).max(6000), contextId: z.string().max(80).optional() })
        .strict()
        .parse(req.body);
      return reply.code(202).send(await service.submit(id, message, contextId));
    },
  );
  app.get('/api/chat/requests/:id', async (req) =>
    service.inspect(z.object({ id: z.uuid() }).parse(req.params).id),
  );
}
