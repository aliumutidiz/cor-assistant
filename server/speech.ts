import { spawn } from 'node:child_process';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';
import type { Config } from './config.js';
import { AppError } from './errors.js';
export interface SpeechTranscriber {
  transcribe(audio: Uint8Array, signal?: AbortSignal): Promise<string>;
}
export class LocalSpeechTranscriber implements SpeechTranscriber {
  constructor(private config: Config) {}
  async transcribe(audio: Uint8Array, signal?: AbortSignal) {
    if (!this.config.STT_ENABLED)
      throw new AppError(
        503,
        'Sesli mesaj çözümleme henüz kurulmadı. Şimdilik yazılı mesaj gönderebilirsiniz.',
      );
    if (audio.byteLength > 8 * 1024 * 1024) throw new AppError(413, 'Ses kaydı en fazla 8 MB olabilir.');
    const dir = await mkdtemp(join(tmpdir(), 'cor-voice-'));
    const path = join(dir, 'voice.ogg');
    try {
      await writeFile(path, audio, { mode: 0o600 });
      return await new Promise<string>((resolve, reject) => {
        const env: NodeJS.ProcessEnv = {};
        for (const key of [
          'PATH',
          'Path',
          'SYSTEMROOT',
          'SystemRoot',
          'HOME',
          'USERPROFILE',
          'TEMP',
          'TMP',
          'LD_LIBRARY_PATH',
        ])
          if (process.env[key]) env[key] = process.env[key];
        env.HF_HUB_OFFLINE = '1';
        env.HF_HUB_DISABLE_TELEMETRY = '1';
        const child = spawn(
          this.config.STT_PYTHON,
          [
            fileURLToPath(new URL('../scripts/transcribe.py', import.meta.url)),
            path,
            this.config.STT_MODEL_PATH,
          ],
          { env, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] },
        );
        let output = '',
          settled = false;
        const end = (error: Error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          signal?.removeEventListener('abort', abort);
          child.kill();
          reject(error);
        };
        const abort = () => end(new AppError(499, 'Ses çözümleme iptal edildi.'));
        const timer = setTimeout(
          () => end(new AppError(504, 'Ses çözümleme zaman aşımına uğradı. Daha kısa bir kayıt gönderin.')),
          90000,
        );
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) abort();
        child.stdout.on('data', (d) => {
          output += d.toString();
          if (output.length > 32000) end(new AppError(413, 'Çözümlenen kayıt çok uzun.'));
        });
        child.stderr.resume();
        child.on('error', () => end(new AppError(503, 'Yerel ses çözümleyici başlatılamadı.')));
        child.on('close', (code) => {
          if (settled) return;
          if (code !== 0)
            return end(new AppError(503, 'Ses çözümlenemedi. Yerel model kurulumunu kontrol edin.'));
          try {
            const value = JSON.parse(output);
            if (value?.error === 'audio_too_long')
              return end(new AppError(413, 'Ses kaydı en fazla 2 dakika olabilir.'));
            if (value?.error === 'invalid_audio')
              return end(new AppError(422, 'Ses dosyası okunamadı. Yeniden kayıt alıp gönderebilirsin.'));
            const r = z
              .object({ text: z.string().trim().min(1).max(6000), reliable: z.literal(true) })
              .parse(value);
            settled = true;
            clearTimeout(timer);
            signal?.removeEventListener('abort', abort);
            resolve(r.text);
          } catch {
            end(
              new AppError(
                422,
                'Kaydı yeterince net anlayamadım. Daha kısa ve net bir sesli mesaj veya yazılı komut gönderin.',
              ),
            );
          }
        });
      });
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }
}
