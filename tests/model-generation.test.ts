import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import { generateValidated } from '../server/model-generation.js';
import { AppError } from '../server/errors.js';
import { ChatQueue } from '../server/chat-queue.js';

describe('bounded pure model recovery', () => {
  const schema = z.object({ message: z.string() }).strict();
  it('repairs malformed output once and validates the replacement', async () => {
    const provider = {
      generate: vi
        .fn()
        .mockResolvedValueOnce({ output: { unexpected: true } })
        .mockResolvedValueOnce({ output: { message: 'Geçerli yanıt' } }),
    };
    const result = await generateValidated(provider, 'request', {}, (value) => schema.parse(value), {
      used: false,
    });
    expect(result.output.message).toBe('Geçerli yanıt');
    expect(provider.generate).toHaveBeenCalledTimes(2);
    expect(provider.generate.mock.calls[1][0]).toContain('FORMAT_RECOVERY');
  });
  it('shares one recovery budget across routing and execution', async () => {
    const budget = { used: false };
    const provider = {
      generate: vi
        .fn()
        .mockRejectedValueOnce(new AppError(503, 'temporary', false, 'AGY_TRANSIENT'))
        .mockResolvedValueOnce({ output: { message: 'ok' } })
        .mockResolvedValueOnce({ output: null }),
    };
    await generateValidated(provider, 'route', {}, (v) => schema.parse(v), budget);
    await expect(
      generateValidated(provider, 'execute', {}, (v) => schema.parse(v), budget),
    ).rejects.toMatchObject({ status: 502 });
    expect(provider.generate).toHaveBeenCalledTimes(3);
  });
  it.each([new AppError(429, 'quota'), new AppError(503, 'auth'), new AppError(403, 'policy')])(
    'never retries quota, auth or policy errors',
    async (error) => {
      const provider = { generate: vi.fn().mockRejectedValue(error) };
      await expect(generateValidated(provider, 'x', {}, (v) => v, { used: false })).rejects.toBe(error);
      expect(provider.generate).toHaveBeenCalledTimes(1);
    },
  );
  it('cancels backoff without starting another generation', async () => {
    const signal = new AbortController();
    const provider = {
      generate: vi.fn().mockImplementation(async () => {
        signal.abort();
        throw new AppError(503, 'temporary', false, 'AGY_TRANSIENT');
      }),
    };
    await expect(
      generateValidated(provider, 'x', {}, (v) => v, { used: false }, signal.signal),
    ).rejects.toBeInstanceOf(AppError);
    expect(provider.generate).toHaveBeenCalledTimes(1);
  });
});

describe('shared chat queue', () => {
  it('runs channels in order and removes aborted waiters', async () => {
    const queue = new ChatQueue();
    const first = await queue.acquire();
    const abort = new AbortController();
    const cancelled = expect(queue.acquire(abort.signal)).rejects.toMatchObject({ status: 499 });
    const order: number[] = [];
    const second = queue.acquire().then((release) => {
      order.push(2);
      release();
    });
    const third = queue.acquire().then((release) => {
      order.push(3);
      release();
    });
    abort.abort();
    await cancelled;
    expect(order).toEqual([]);
    first();
    first();
    await Promise.all([second, third]);
    expect(order).toEqual([2, 3]);
  });
  it('bounds wait time and capacity without leaking a reservation', async () => {
    const queue = new ChatQueue(1, 15);
    const release = await queue.acquire();
    const waiting = expect(queue.acquire()).rejects.toMatchObject({ status: 429 });
    await expect(queue.acquire()).rejects.toMatchObject({ status: 429 });
    await waiting;
    release();
    (await queue.acquire())();
  });
});
