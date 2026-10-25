import { createConnection } from 'node:net';
import type { ModelProvider } from './provider.js';
import type { Config } from './config.js';
import { AppError } from './errors.js';

export class AgySocketProvider implements ModelProvider {
  private running = false;
  constructor(private config: Config) {}
  async generate(
    prompt: string,
    schema: Record<string, unknown>,
    signal?: AbortSignal,
    options?: { conversationKey: string },
  ) {
    if (!this.config.AGY_ENABLED || !this.config.AGY_SOCKET)
      throw new AppError(503, 'AGY bağlantısı kapalı.');
    if (signal?.aborted) throw new AppError(499, 'İstek iptal edildi.');
    if (this.running) throw new AppError(429, 'Asistan başka bir isteği işliyor.');
    if (options && !/^[a-f0-9]{64}$/.test(options.conversationKey))
      throw new AppError(400, 'Invalid conversation scope.');
    const request =
      JSON.stringify({ prompt, schema, ...(options ? { conversation_key: options.conversationKey } : {}) }) +
      '\n';
    if (Buffer.byteLength(request) > 196608) throw new AppError(413, 'Asistan bağlamı çok uzun.');
    this.running = true;
    try {
      return await new Promise<{ output: unknown; usage?: unknown }>((resolve, reject) => {
        const connection = createConnection({ path: this.config.AGY_SOCKET });
        let bytes = Buffer.alloc(0),
          settled = false;
        const finish = (error?: Error, result?: { output: unknown; usage?: unknown }) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          signal?.removeEventListener('abort', abort);
          connection.destroy();
          if (error) reject(error);
          else resolve(result!);
        };
        const abort = () => finish(new AppError(499, 'İstek iptal edildi.'));
        const timer = setTimeout(
          () => finish(new AppError(504, 'AGY yanıt süresi doldu.', false, 'AGY_TIMEOUT')),
          this.config.AGY_TIMEOUT_MS,
        );
        signal?.addEventListener('abort', abort, { once: true });
        if (signal?.aborted) {
          abort();
          return;
        }
        connection.once('connect', () => connection.write(request));
        connection.on('data', (part: Buffer) => {
          bytes = Buffer.concat([bytes, part]);
          if (bytes.length > 1048576) {
            finish(new AppError(502, 'AGY çıktı sınırı aşıldı.'));
            return;
          }
          const end = bytes.indexOf(10);
          if (end < 0) return;
          try {
            const value = JSON.parse(bytes.subarray(0, end).toString('utf8'));
            if (value.error) {
              if (value.error === 'ModelQuotaError') {
                finish(
                  new AppError(429, 'AGY kullanım kotasına ulaşıldı. Kota yenilendiğinde tekrar deneyin.'),
                );
                return;
              }
              if (value.error === 'ModelAuthError') {
                finish(
                  new AppError(
                    503,
                    'AGY hesabının oturumu yenilenmeli. Takvim bağlantınız bundan etkilenmez.',
                  ),
                );
                return;
              }
              const transient: Record<string, [number, string, string]> = {
                ModelToolPolicyError: [
                  502,
                  'The model attempted an unsupported tool. No application action was executed.',
                  'AGY_OUTPUT',
                ],
                ModelOutputError: [
                  502,
                  'AGY yanıt biçimi doğrulanamadı. Lütfen tekrar deneyin.',
                  'AGY_OUTPUT',
                ],
                ModelUnavailableError: [
                  503,
                  'AGY geçici olarak yanıt veremedi. Lütfen biraz sonra tekrar deneyin.',
                  'AGY_TRANSIENT',
                ],
                TimeoutError: [504, 'AGY yanıt süresi doldu. Lütfen tekrar deneyin.', 'AGY_TIMEOUT'],
              };
              if (transient[value.error]) {
                const [status, message, code] = transient[value.error];
                finish(new AppError(status, message, false, code));
                return;
              }
              finish(
                new AppError(
                  value.error === 'busy' || value.error === 'ModelBusyError' ? 429 : 503,
                  value.error === 'ModelBusyError'
                    ? 'AGY konsolu açık veya model meşgul. Konsolu kapattıktan sonra yeniden deneyin.'
                    : value.error === 'busy'
                      ? 'Asistan başka bir isteği işliyor.'
                      : 'AGY isteği tamamlanamadı. Oturum veya kota durumunu kontrol edin.',
                ),
              );
            } else if (!value.output || typeof value.output !== 'object' || Array.isArray(value.output)) {
              finish(new AppError(502, 'AGY geçerli yapılandırılmış çıktı döndürmedi.', false, 'AGY_OUTPUT'));
            } else finish(undefined, { output: value.output, usage: value.usage });
          } catch {
            finish(new AppError(502, 'AGY yanıtı okunamadı.', false, 'AGY_OUTPUT'));
          }
        });
        connection.once('error', () =>
          finish(new AppError(503, 'AGY bağlantı servisine ulaşılamadı.', false, 'AGY_TRANSIENT')),
        );
        connection.once('close', () =>
          finish(new AppError(503, 'AGY bağlantısı tamamlanmadan kapandı.', false, 'AGY_TRANSIENT')),
        );
      });
    } finally {
      this.running = false;
    }
  }
}
