import { randomBytes } from 'node:crypto';
import { z } from 'zod';
const bool = z.enum(['true', 'false']).transform((v) => v === 'true');
export function loadConfig(env: NodeJS.ProcessEnv = process.env) {
  const c = z
    .object({
      NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
      APP_ORIGIN: z.url().default('http://localhost:5173'),
      LISTEN_HOST: z.enum(['127.0.0.1', '0.0.0.0']).default('127.0.0.1'),
      PORT: z.coerce.number().int().min(1).max(65535).default(3001),
      HTTP_SOCKET: z.enum(['', '/run/cor/http.sock']).default(''),
      DEMO_MODE: bool.default(true),
      DATABASE_URL: z.string().optional(),
      SESSION_SECRET: z.string().default(''),
      ENCRYPTION_KEY: z.string().default(''),
      OWNER_EMAIL: z.string().default(''),
      CF_ACCESS_TEAM: z.string().default(''),
      CF_ACCESS_AUD: z.string().default(''),
      AUTH_MODE: z.enum(['cloudflare', 'google']).default('cloudflare'),
      GOOGLE_CLIENT_ID: z.string().default(''),
      GOOGLE_CLIENT_SECRET: z.string().default(''),
      GOOGLE_REDIRECT_URI: z.string().default('http://localhost:5173/api/oauth/callback'),
      AGY_ENABLED: bool.default(false),
      AGY_APPROVAL_EVIDENCE: z.string().default(''),
      AGY_LINUX_VERIFIED: bool.default(false),
      AGY_ISOLATION_VERIFIED: bool.default(false),
      AGY_COMMAND: z.string().default('agy'),
      AGY_SOCKET: z.enum(['', '/run/cor-agy/model.sock']).default(''),
      AGY_WORKDIR: z.string().default(''),
      AGY_MODEL: z.string().default(''),
      AGY_TIMEOUT_MS: z.coerce.number().int().min(1000).max(180000).default(90000),
      TELEGRAM_ENABLED: bool.default(false),
      TELEGRAM_BOT_TOKEN: z.string().default(''),
      TELEGRAM_ALLOWED_CHAT_IDS: z
        .string()
        .default('')
        .transform((value) =>
          value
            ? value.split(',').map((id) => z.coerce.number().int().negative().safe().parse(id.trim()))
            : [],
        ),
      TELEGRAM_CHAT_ID: z.preprocess(
        (v) => (v === '' ? undefined : v),
        z.coerce.number().int().negative().optional(),
      ),
      TELEGRAM_OWNER_ID: z.preprocess(
        (v) => (v === '' ? undefined : v),
        z.coerce.number().int().positive().optional(),
      ),
      STT_ENABLED: bool.default(false),
      STT_PYTHON: z.string().default('python'),
      STT_MODEL_PATH: z.string().default(''),
    })
    .parse(env);
  if (c.TELEGRAM_ENABLED && (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(c.TELEGRAM_BOT_TOKEN) || !c.TELEGRAM_OWNER_ID))
    throw new Error('Telegram requires a bot token and numeric owner id');
  if (c.TELEGRAM_ENABLED && c.DEMO_MODE)
    throw new Error('Telegram requires persistent live mode; do not send real commands to a volatile demo');
  if (c.STT_ENABLED && !c.STT_MODEL_PATH) throw new Error('Local speech recognition requires STT_MODEL_PATH');
  if (c.NODE_ENV === 'production') {
    if (
      c.DEMO_MODE ||
      !c.DATABASE_URL ||
      c.SESSION_SECRET.length < 32 ||
      Buffer.from(c.ENCRYPTION_KEY, 'base64').length !== 32 ||
      !z.email().safeParse(c.OWNER_EMAIL).success ||
      (c.AUTH_MODE === 'cloudflare' && (!/^[a-z0-9-]+$/.test(c.CF_ACCESS_TEAM) || !c.CF_ACCESS_AUD)) ||
      (c.AUTH_MODE === 'google' &&
        (!c.GOOGLE_CLIENT_ID ||
          !c.GOOGLE_CLIENT_SECRET ||
          new URL(c.GOOGLE_REDIRECT_URI).origin !== new URL(c.APP_ORIGIN).origin ||
          new URL(c.GOOGLE_REDIRECT_URI).pathname !== '/api/oauth/callback')) ||
      new URL(c.APP_ORIGIN).protocol !== 'https:'
    )
      throw new Error(
        'Production requires PostgreSQL, independent secrets, owner identity, HTTPS and configured authentication',
      );
  }
  if (!c.DEMO_MODE && (!c.DATABASE_URL || Buffer.from(c.ENCRYPTION_KEY, 'base64').length !== 32))
    throw new Error('Live mode requires DATABASE_URL and a base64 32-byte ENCRYPTION_KEY');
  if (
    c.AGY_ENABLED &&
    (!c.AGY_APPROVAL_EVIDENCE ||
      !c.AGY_LINUX_VERIFIED ||
      !c.AGY_ISOLATION_VERIFIED ||
      !c.AGY_WORKDIR ||
      !c.AGY_MODEL)
  )
    throw new Error(
      'AGY requires approval evidence, Linux and isolation verification, a dedicated workdir and a tested model',
    );
  return {
    ...c,
    SESSION_SECRET: c.SESSION_SECRET || randomBytes(32).toString('hex'),
    ENCRYPTION_KEY: c.ENCRYPTION_KEY || randomBytes(32).toString('base64'),
  };
}
export type Config = ReturnType<typeof loadConfig>;
