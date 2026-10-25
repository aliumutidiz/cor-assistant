import { z } from 'zod';
import type { Config } from './config.js';
import type { Store } from './repositories.js';
import { seal, unseal, digest } from './crypto.js';
import { voiceSettings } from '../shared/voice.js';
import { AppError } from './errors.js';
import { dateKey } from '../shared/time.js';
import { telegramMarkdown } from './telegram-markdown.js';
import type { VoiceFrame } from '../shared/voice.js';
import { streamedVoice, VOICE_STYLE } from './voice-stream.js';

const MODEL = 'gemini-3.8-flash-lite-tts';
const MAX_RESPONSE = 12 * 1024 * 1024;
export class VoiceOutput {
  private cache = new Map<string, Buffer>();
  private pending = new Map<string, Promise<Buffer>>();
  private active = 0;
  constructor(
    private config: Config,
    private store: Store,
    private request: typeof fetch = fetch,
  ) {}
  async status() {
    const settings = voiceSettings.parse((await this.store.get('voice.settings')) ?? {});
    const prefs = await this.store.get<{ timeZone: string }>('preferences');
    const day = dateKey(new Date(), prefs?.timeZone ?? 'Europe/Istanbul');
    return {
      ...settings,
      day,
      used: (await this.store.get<number>('voice.usage:' + day)) ?? 0,
      configured: !!(await this.store.get('voice.credentials')),
      speechInput: this.config.STT_ENABLED,
    };
  }
  async configure(input: unknown) {
    const value = z
      .object({ settings: voiceSettings, apiKey: z.string().trim().min(20).max(300).optional() })
      .strict()
      .parse(input);
    if (value.settings.enabled && !value.settings.freeTierConfirmed)
      throw new AppError(400, 'Ücretsiz proje doğrulaması olmadan ses üretimi açılamaz.');
    if (value.apiKey)
      await this.store.set('voice.credentials', seal({ apiKey: value.apiKey }, this.config.ENCRYPTION_KEY));
    if (value.settings.enabled && !(await this.store.get('voice.credentials')))
      throw new AppError(400, 'Google AI Studio anahtarını önce ekle.');
    await this.store.set('voice.settings', value.settings);
    this.cache.clear();
    return this.status();
  }
  async speak(input: unknown, signal?: AbortSignal, emit?: (frame: VoiceFrame) => Promise<void> | void) {
    const { text } = z
      .object({ text: z.string().trim().min(1).max(1200) })
      .strict()
      .parse(input);
    const settings = await this.status();
    if (!settings.enabled || !settings.freeTierConfirmed || !settings.configured)
      throw new AppError(503, 'Sesli yanıt Ayarlar’dan etkinleştirilmeli.');
    if (signal?.aborted) throw new AppError(499, 'Ses isteği iptal edildi.');
    const stored = await this.store.get<string>('voice.credentials');
    const { apiKey } = unseal<{ apiKey: string }>(stored!, this.config.ENCRYPTION_KEY);
    const plain = telegramMarkdown(text)
      .map((c) => c.text)
      .join('')
      .replace(/<[^>]*>/g, '')
      .trim();
    if (!plain) throw new AppError(400, 'Okunabilecek bir metin yok.');
    const key = digest({
      text: plain,
      voice: settings.voice,
      style: VOICE_STYLE,
      credential: digest(apiKey),
    });
    const cached = this.cache.get(key);
    if (cached) {
      await emit?.({ type: 'audio', format: 'wav', data: cached.toString('base64') });
      return cached;
    }
    if (this.pending.has(key)) {
      const audio = await this.pending.get(key)!;
      if (signal?.aborted) throw new AppError(499, 'Ses isteği iptal edildi.');
      await emit?.({ type: 'audio', format: 'wav', data: audio.toString('base64') });
      return audio;
    }
    if (this.active >= 1) throw new AppError(429, 'Bir sesli yanıt hazırlanıyor. Tamamlanınca yeniden dene.');
    this.active++;
    const task = this.generate(plain, settings, apiKey, signal, emit)
      .then((audio) => {
        this.cache.set(key, audio);
        while (
          this.cache.size > 8 ||
          [...this.cache.values()].reduce((sum, b) => sum + b.byteLength, 0) > 12 * 1024 * 1024
        )
          this.cache.delete(this.cache.keys().next().value!);
        return audio;
      })
      .finally(() => {
        this.pending.delete(key);
        this.active--;
      });
    this.pending.set(key, task);
    return task;
  }
  private async generate(
    text: string,
    settings: Awaited<ReturnType<VoiceOutput['status']>>,
    apiKey: string,
    signal?: AbortSignal,
    emit?: (frame: VoiceFrame) => Promise<void> | void,
  ) {
    if (!(await this.store.reserveVoice(settings.day, settings.dailyLimit)))
      throw new AppError(429, 'C.O.R. için belirlediğin günlük ses sınırına ulaşıldı.');
    let response: Response;
    const requestSignal = AbortSignal.any([AbortSignal.timeout(45000), ...(signal ? [signal] : [])]);
    try {
      response = await this.request('https://generativelanguage.googleapis.com/v1beta/interactions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        signal: requestSignal,
        body: JSON.stringify({
          model: MODEL,
          store: false,
          ...(emit ? { stream: true } : {}),
          input: [
            {
              type: 'user_input',
              content: [
                {
                  type: 'text',
                  text,
                  annotations: [
                    {
                      type: 'speech_metadata',
                      style: VOICE_STYLE,
                    },
                  ],
                },
              ],
            },
          ],
          response_format: { type: 'audio', mime_type: emit ? 'audio/l16' : 'audio/wav', sample_rate: 24000 },
          generation_config: { speech_config: [{ voice: settings.voice }] },
        }),
      });
    } catch {
      throw new AppError(
        signal?.aborted ? 499 : 503,
        'Ses servisine ulaşılamadı. Metin yanıtını kullanabilirsin.',
      );
    }
    if (!response.ok) {
      await response.body?.cancel();
      throw new AppError(
        response.status === 429 ? 429 : 503,
        response.status === 429
          ? 'Google ses kotasına ulaşıldı. Otomatik ücretli geçiş yapılmayacak.'
          : response.status === 401 || response.status === 403
            ? 'Google ses anahtarının erişim izinlerini kontrol et.'
            : 'Google ses üretimini tamamlayamadı.',
      );
    }
    const parts: Buffer[] = [];
    let size = 0;
    try {
      if (!response.body) throw Error();
      if (emit) {
        if (!response.headers.get('content-type')?.includes('text/event-stream')) throw Error();
        return await streamedVoice(response.body, emit, requestSignal);
      }
      for await (const chunk of response.body as unknown as AsyncIterable<Uint8Array>) {
        size += chunk.byteLength;
        if (size > MAX_RESPONSE) throw Error();
        parts.push(Buffer.from(chunk));
      }
      const value = JSON.parse(Buffer.concat(parts).toString('utf8'));
      const audio = z
        .object({
          steps: z.array(
            z
              .object({
                type: z.string(),
                content: z
                  .array(z.object({ type: z.string(), data: z.string().optional() }).passthrough())
                  .optional(),
              })
              .passthrough(),
          ),
        })
        .passthrough()
        .parse(value)
        .steps.filter((s) => s.type === 'model_output')
        .flatMap((s) => s.content ?? [])
        .filter((c) => c.type === 'audio' && c.data)
        .at(-1);
      if (!audio?.data || !/^[A-Za-z0-9+/=\s]+$/.test(audio.data)) throw Error();
      const wav = Buffer.from(audio.data, 'base64');
      if (
        wav.length < 44 ||
        wav.length > 8 * 1024 * 1024 ||
        wav.toString('ascii', 0, 4) !== 'RIFF' ||
        wav.toString('ascii', 8, 12) !== 'WAVE'
      )
        throw Error();
      return wav;
    } catch {
      throw new AppError(
        502,
        'Google geçerli bir ses dosyası üretmedi. Ücretli veya başka bir modele geçilmeyecek.',
      );
    }
  }
}
