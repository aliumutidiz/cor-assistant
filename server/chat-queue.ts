import { AppError } from './errors.js';

export class ChatQueue {
  private active = false;
  private waiting: (() => void)[] = [];
  constructor(
    private limit = 3,
    private timeout = 60000,
  ) {}
  async acquire(signal?: AbortSignal): Promise<() => void> {
    if (signal?.aborted) throw new AppError(499, 'İstek iptal edildi.');
    if (this.active) {
      if (this.waiting.length >= this.limit)
        throw new AppError(429, 'Sohbet sırası dolu. Biraz sonra tekrar deneyin.');
      await new Promise<void>((resolve, reject) => {
        const cleanup = () => {
          clearTimeout(timer);
          signal?.removeEventListener('abort', abort);
        };
        const leave = (error: AppError) => {
          const index = this.waiting.indexOf(ready);
          if (index < 0) return;
          this.waiting.splice(index, 1);
          cleanup();
          reject(error);
        };
        const ready = () => {
          cleanup();
          resolve();
        };
        const abort = () => leave(new AppError(499, 'İstek iptal edildi.'));
        const timer = setTimeout(
          () => leave(new AppError(429, 'Önceki sohbet hâlâ işleniyor. Biraz sonra tekrar deneyin.')),
          this.timeout,
        );
        this.waiting.push(ready);
        signal?.addEventListener('abort', abort, { once: true });
      });
    } else this.active = true;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const next = this.waiting.shift();
      if (next) next();
      else this.active = false;
    };
  }
}
