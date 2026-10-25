import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { Store } from './repositories.js';
import type { Config } from './config.js';
import { VoiceOutput } from './voice-output.js';
import { LocalSpeechTranscriber } from './speech.js';
import { AppError } from './errors.js';
import { PassThrough } from 'node:stream';
import { once } from 'node:events';

export function voiceRoutes(app: FastifyInstance, store: Store, config: Config) {
  const output = new VoiceOutput(config, store);
  const transcriber = new LocalSpeechTranscriber(config);
  let listening = false;
  app.get('/api/voice/status', () => output.status());
  app.post('/api/voice/settings', (req) => output.configure(req.body));
  app.post(
    '/api/speak/stream',
    { config: { rateLimit: { max: 6, timeWindow: 60000 } } },
    async (req, reply) => {
      const cancel = new AbortController(),
        stream = new PassThrough();
      req.raw.once('aborted', () => cancel.abort());
      reply.raw.once('close', () => {
        if (!reply.raw.writableEnded) {
          cancel.abort();
          stream.destroy();
        }
      });
      const send = async (frame: unknown) => {
        cancel.signal.throwIfAborted();
        if (!stream.write(JSON.stringify(frame) + '\n'))
          await once(stream, 'drain', { signal: cancel.signal });
      };
      // A terminal frame distinguishes provider failure from a completed recording.
      void (async () => {
        try {
          await send({ type: 'start', sampleRate: 24000 });
          await output.speak(req.body, cancel.signal, send);
          await send({ type: 'done' });
        } catch (error) {
          if (!cancel.signal.aborted && !stream.destroyed) {
            const safe = error instanceof AppError ? error : new AppError(503, 'Ses üretimi tamamlanamadı.');
            stream.write(
              JSON.stringify({ type: 'error', message: safe.message, status: safe.status }) + '\n',
            );
          }
        } finally {
          stream.end();
        }
      })();
      return reply
        .type('application/x-ndjson')
        .header('Cache-Control', 'no-store, no-transform')
        .header('X-Accel-Buffering', 'no')
        .send(stream);
    },
  );
  app.post('/api/speak', { config: { rateLimit: { max: 6, timeWindow: 60000 } } }, async (req, reply) => {
    const cancel = new AbortController();
    req.raw.once('aborted', () => cancel.abort());
    reply.raw.once('close', () => {
      if (!reply.raw.writableEnded) cancel.abort();
    });
    const audio = await output.speak(req.body, cancel.signal);
    return reply.type('audio/wav').header('Cache-Control', 'no-store').send(audio);
  });
  app.post(
    '/api/listen',
    { bodyLimit: 12 * 1024 * 1024, config: { rateLimit: { max: 6, timeWindow: 60000 } } },
    async (req, reply) => {
      const { audio } = z
        .object({
          audio: z
            .string()
            .min(4)
            .max(11200000)
            .regex(/^[A-Za-z0-9+/]*={0,2}$/)
            .refine((value) => value.length % 4 === 0, 'Geçersiz ses kodlaması.'),
        })
        .strict()
        .parse(req.body);
      if (listening) throw new AppError(429, 'Önceki ses kaydı çözümleniyor.');
      const bytes = Buffer.from(audio, 'base64');
      if (bytes.length > 8 * 1024 * 1024) throw new AppError(413, 'Ses kaydı en fazla 8 MB olabilir.');
      listening = true;
      const cancel = new AbortController();
      req.raw.once('aborted', () => cancel.abort());
      reply.raw.once('close', () => {
        if (!reply.raw.writableEnded) cancel.abort();
      });
      try {
        return { text: await transcriber.transcribe(bytes, cancel.signal), requiresConfirmation: true };
      } finally {
        listening = false;
      }
    },
  );
}
