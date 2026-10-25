import { setTimeout as pause } from 'node:timers/promises';
import { z } from 'zod';
import type { ModelProvider } from './provider.js';
import { AppError } from './errors.js';

// Only pure model generation is retried. No calendar or operation service is
// reachable from this helper. A single shared budget bounds recovery per chat.
export async function generateValidated<T>(
  provider: ModelProvider,
  prompt: string,
  schema: Record<string, unknown>,
  validate: (output: unknown) => T,
  recovery: { used: boolean },
  signal?: AbortSignal,
  conversationKey?: string,
) {
  let correction = '';
  for (;;) {
    try {
      if (signal?.aborted) throw new AppError(499, 'İstek iptal edildi.');
      const result = await provider.generate(
        prompt + correction,
        schema,
        signal,
        conversationKey ? { conversationKey } : undefined,
      );
      try {
        return { ...result, output: validate(result.output) };
      } catch (error) {
        if (error instanceof z.ZodError || (error instanceof AppError && error.status === 502))
          throw new AppError(
            502,
            'AGY yanıt biçimi doğrulanamadı. Herhangi bir değişiklik uygulanmadı.',
            false,
            'AGY_OUTPUT',
          );
        throw error;
      }
    } catch (error) {
      if (
        recovery.used ||
        signal?.aborted ||
        !(error instanceof AppError) ||
        !['AGY_OUTPUT', 'AGY_TRANSIENT', 'AGY_TIMEOUT'].includes(error.code ?? '')
      )
        throw error;
      recovery.used = true;
      if (error.code === 'AGY_OUTPUT')
        correction =
          '\nFORMAT_RECOVERY: Return exactly one JSON object matching the supplied schema. Do not invoke CLI, planning, filesystem, browser or shell tools. Only return the response envelope; the application runs validated actions. No prose outside the object, no code fences, no JSON encoded inside message. No tool or application action has been performed by this generation.';
      try {
        await pause(350, undefined, { signal });
      } catch {
        throw new AppError(499, 'İstek iptal edildi.');
      }
    }
  }
}
