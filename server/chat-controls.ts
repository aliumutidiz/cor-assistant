import {AppError} from './errors.js';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Store } from './repositories.js';
import type { AssistantService } from './provider.js';
import { readConversationState } from './chat-state.js';
export function chatControlRoutes(app: FastifyInstance, store: Store, assistant: AssistantService) {
  app.get('/api/chat/context', () => readConversationState(store));
  app.get('/api/chat/snapshot',async()=>{
    for(let attempt=0;attempt<3;attempt++){
      const context=await readConversationState(store);
      const messages=await store.conversation(50,undefined,context.visibleAfter);
      if((await readConversationState(store)).version===context.version)return {context,messages};
    }
    throw new AppError(409,'Conversation changed while loading. Retry the history request.');
  });
  app.post('/api/chat/context', async (req) => {
    const input = z
      .object({
        expectedVersion: z.number().int().positive(),
        mode: z.enum(['new', 'reset', 'forget', 'delete']),
        messageId: z
          .string()
          .regex(/^[1-9]\d{0,18}$/)
          .refine((v) => BigInt(v) <= 9223372036854775807n)
          .optional(),
      })
      .strict()
      .refine((v) => v.mode !== 'forget' || !!v.messageId)
      .parse(req.body);
    return assistant.changeConversation(input);
  });
  app.get('/api/chat/export', async () => {
    const messages = await store.conversation(500);
    return {
      formatVersion: 1,
      exportedAt: new Date().toISOString(),
      scope: 'Latest 500 local messages; saved personal memory is separate.',
      possiblyTruncated: messages.length === 500,
      messages,
    };
  });
}
