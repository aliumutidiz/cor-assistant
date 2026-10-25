import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import type { Config } from './config.js';
import type { Store } from './repositories.js';
import { seal, unseal } from './crypto.js';
import { telegramSettings, type TelegramSettings, type TelegramSettingsView } from '../shared/connections.js';
import { AppError } from './errors.js';
import { TelegramApi } from './telegram.js';

type StoredConnection = Omit<TelegramSettings, 'token'> & { encryptedToken: string; revision: string };
export class Connections {
  constructor(
    private config: Config,
    private store: Store,
  ) {}
  async read(): Promise<TelegramSettingsView> {
    const saved = await this.store.get<StoredConnection>('connections.telegram');
    return saved
      ? {
          enabled: saved.enabled,
          ownerId: saved.ownerId,
          chatIds: saved.chatIds,
          notificationChatId: saved.notificationChatId,
          tokenConfigured: !!saved.encryptedToken,
          revision: saved.revision,
        }
      : {
          enabled: this.config.TELEGRAM_ENABLED,
          ownerId: this.config.TELEGRAM_OWNER_ID ?? null,
          chatIds: this.config.TELEGRAM_ALLOWED_CHAT_IDS.length
            ? this.config.TELEGRAM_ALLOWED_CHAT_IDS
            : this.config.TELEGRAM_CHAT_ID
              ? [this.config.TELEGRAM_CHAT_ID]
              : [],
          notificationChatId: this.config.TELEGRAM_CHAT_ID ?? null,
          tokenConfigured: !!this.config.TELEGRAM_BOT_TOKEN,
          revision: 'environment',
        };
  }
  async save(input: unknown) {
    const value = telegramSettings.parse(input);
    if (this.config.DEMO_MODE) throw new AppError(409, 'Gerçek bağlantıları kalıcı kurulumda ayarla.');
    const old = await this.store.get<StoredConnection>('connections.telegram');
    const token =
      value.token ||
      (old?.encryptedToken
        ? unseal<string>(old.encryptedToken, this.config.ENCRYPTION_KEY)
        : this.config.TELEGRAM_BOT_TOKEN);
    if (value.enabled && !token) throw new AppError(400, 'Bot anahtarı gerekli.');
    // Long-lived notification/approval IDs belong to one bot. Token rotation is
    // supported, but switching bot identities needs a separate queue migration.
    const oldToken = old?.encryptedToken
      ? unseal<string>(old.encryptedToken, this.config.ENCRYPTION_KEY)
      : this.config.TELEGRAM_BOT_TOKEN;
    if (oldToken && token.split(':')[0] !== oldToken.split(':')[0])
      throw new AppError(
        409,
        'Farklı bota geçmeden önce mevcut bildirim kuyruğunun taşınması gerekli. Aynı botun yenilenmiş anahtarını kullanabilirsin.',
      );
    const { token: _token, ...settings } = value;
    await this.store.set('connections.telegram', {
      ...settings,
      encryptedToken: token ? seal(token, this.config.ENCRYPTION_KEY) : '',
      revision: randomUUID(),
    } satisfies StoredConnection);
    return this.read();
  }
  async apply() {
    const saved = await this.store.get<StoredConnection>('connections.telegram');
    if (!saved) return;
    this.config.TELEGRAM_ENABLED = saved.enabled;
    this.config.TELEGRAM_OWNER_ID = saved.ownerId ?? undefined;
    this.config.TELEGRAM_CHAT_ID = saved.notificationChatId ?? undefined;
    this.config.TELEGRAM_ALLOWED_CHAT_IDS = [...saved.chatIds];
    this.config.TELEGRAM_BOT_TOKEN = saved.encryptedToken
      ? unseal<string>(saved.encryptedToken, this.config.ENCRYPTION_KEY)
      : '';
  }
  async check() {
    const saved = await this.store.get<StoredConnection>('connections.telegram');
    const token = saved?.encryptedToken
      ? unseal<string>(saved.encryptedToken, this.config.ENCRYPTION_KEY)
      : this.config.TELEGRAM_BOT_TOKEN;
    if (!token) throw new AppError(409, 'Önce bot anahtarını kaydet.');
    const bot = await new TelegramApi(token).call<{ id: number; username?: string }>('getMe', {});
    return { ok: true, botId: bot.id, username: bot.username };
  }
}
export function connectionRoutes(app: FastifyInstance, service: Connections) {
  app.get('/api/settings/telegram', () => service.read());
  app.put('/api/settings/telegram', (req) => service.save(req.body));
  app.post('/api/settings/telegram/check', () => service.check());
}
