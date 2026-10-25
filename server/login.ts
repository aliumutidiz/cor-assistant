import { createHash, randomBytes } from 'node:crypto';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { Config } from './config.js';
import type { Store } from './repositories.js';
import { AppError } from './errors.js';

const opaque = () => randomBytes(32).toString('base64url');
const digest = (value: string) => createHash('sha256').update(value).digest('base64url');
const duration = 30 * 86400000;
export type OwnerLogin = { subject: string; email: string; expires: number; createdAt?: number };
export const ownerCookie = (config: Config) =>
  config.NODE_ENV === 'production' ? '__Host-cor_owner' : 'cor_owner';
export const flowCookie = (config: Config) =>
  config.NODE_ENV === 'production' ? '__Host-cor_login' : 'cor_login';
export function isLoginCallback(url: string) {
  const parsed = new URL(url, 'http://localhost');
  return (
    parsed.pathname === '/api/oauth/callback' &&
    /^login\.[A-Za-z0-9_-]{43}$/.test(parsed.searchParams.get('state') ?? '')
  );
}

export class OwnerAuth {
  private keys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
  constructor(
    private config: Config,
    private store: Store,
  ) {}
  private options() {
    return {
      path: '/',
      httpOnly: true,
      secure: this.config.NODE_ENV === 'production',
      sameSite: 'lax' as const,
      signed: true,
    };
  }
  private readCookie(req: FastifyRequest, name: string) {
    const raw = req.cookies[name];
    const decoded = raw ? req.unsignCookie(raw) : undefined;
    return decoded?.valid ? decoded.value : undefined;
  }
  async identity(req: FastifyRequest, reply?: FastifyReply) {
    const id = this.readCookie(req, ownerCookie(this.config));
    if (!id || !/^[A-Za-z0-9_-]{43}$/.test(id)) return;
    const session = await this.store.get<OwnerLogin | null>('owner-session:' + digest(id));
    if (!session || session.expires <= Date.now() || session.email !== this.config.OWNER_EMAIL.toLowerCase())
      return;
    const subject = await this.store.get<string>('auth.owner-subject');
    if (!subject || subject !== session.subject) return;
    // Explicit owner preference: remember this browser for 30 days, not indefinitely.
    // Upgrade only a still-valid legacy session; expired/revoked sessions never revive.
    if (reply && !session.createdAt) {
      await this.store.set('owner-session:' + digest(id), {
        ...session,
        createdAt: Date.now(),
        expires: Date.now() + duration,
      });
      reply.setCookie(ownerCookie(this.config), id, { ...this.options(), maxAge: duration / 1000 });
    }
    return session;
  }
  start = async (req: FastifyRequest, reply: FastifyReply) => {
    if (!this.config.GOOGLE_CLIENT_ID || !this.config.GOOGLE_CLIENT_SECRET)
      throw new AppError(503, 'Google ile giriş henüz yapılandırılmadı.');
    const state = 'login.' + opaque(),
      browser = opaque(),
      nonce = opaque(),
      verifier = opaque();
    await this.store.putTransient(
      'login:' + state,
      { binding: digest(browser), nonce, verifier },
      new Date(Date.now() + 600000).toISOString(),
    );
    reply.setCookie(flowCookie(this.config), browser, { ...this.options(), maxAge: 600 });
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({
      client_id: this.config.GOOGLE_CLIENT_ID,
      redirect_uri: this.config.GOOGLE_REDIRECT_URI,
      response_type: 'code',
      scope: 'openid email',
      prompt: 'select_account',
      state,
      nonce,
      code_challenge: digest(verifier),
      code_challenge_method: 'S256',
    }).toString();
    return reply.header('Cache-Control', 'no-store').redirect(url.toString());
  };
  callback = async (req: FastifyRequest, reply: FastifyReply) => {
    const query = req.query as Record<string, unknown>;
    const state = query.state;
    const browser = this.readCookie(req, flowCookie(this.config));
    reply.clearCookie(flowCookie(this.config), this.options());
    if (typeof state !== 'string' || !/^login\.[A-Za-z0-9_-]{43}$/.test(state) || !browser)
      throw new AppError(400, 'Giriş doğrulanamadı. Yeniden deneyin.');
    const record = await this.store.takeTransient<{ binding: string; nonce: string; verifier: string }>(
      'login:' + state,
    );
    if (
      !record ||
      record.binding !== digest(browser) ||
      typeof query.code !== 'string' ||
      query.code.length > 4096
    )
      throw new AppError(400, 'Giriş isteği geçersiz veya süresi dolmuş. Yeniden deneyin.');
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      signal: AbortSignal.timeout(20000),
      body: new URLSearchParams({
        code: query.code,
        code_verifier: record.verifier,
        grant_type: 'authorization_code',
        redirect_uri: this.config.GOOGLE_REDIRECT_URI,
        client_id: this.config.GOOGLE_CLIENT_ID,
        client_secret: this.config.GOOGLE_CLIENT_SECRET,
      }),
    });
    if (!response.ok) throw new AppError(401, 'Google ile giriş tamamlanamadı. Yeniden deneyin.');
    const tokens = (await response.json()) as { id_token?: unknown };
    let payload;
    try {
      if (typeof tokens.id_token !== 'string') throw Error();
      payload = (
        await jwtVerify(tokens.id_token, this.keys, {
          algorithms: ['RS256'],
          issuer: ['https://accounts.google.com', 'accounts.google.com'],
          audience: this.config.GOOGLE_CLIENT_ID,
          requiredClaims: ['exp', 'iat', 'sub', 'nonce'],
        })
      ).payload;
      if (
        payload.nonce !== record.nonce ||
        payload.email_verified !== true ||
        typeof payload.email !== 'string' ||
        payload.email.toLowerCase() !== this.config.OWNER_EMAIL.toLowerCase() ||
        !payload.sub ||
        (payload.azp !== undefined && payload.azp !== this.config.GOOGLE_CLIENT_ID)
      )
        throw Error();
      const subject = await this.store.get<string>('auth.owner-subject');
      if (subject && subject !== payload.sub) throw Error();
    } catch {
      throw new AppError(403, 'Bu hesap C.O.R. için yetkili değil.');
    }
    await this.store.set('auth.owner-subject', payload.sub);
    // Rotate both authentication and CSRF sessions after successful login.
    await this.revoke(req);
    const id = opaque();
    await this.store.set('owner-session:' + digest(id), {
      subject: payload.sub,
      email: this.config.OWNER_EMAIL.toLowerCase(),
      expires: Date.now() + duration,
      createdAt: Date.now(),
    });
    reply.setCookie(ownerCookie(this.config), id, { ...this.options(), maxAge: duration / 1000 });
    reply.clearCookie('cor_session', this.options());
    return reply.header('Cache-Control', 'no-store').redirect('/');
  };
  private async revoke(req: FastifyRequest) {
    const owner = this.readCookie(req, ownerCookie(this.config));
    if (owner) await this.store.set('owner-session:' + digest(owner), null);
    const api = this.readCookie(req, 'cor_session');
    if (api) await this.store.set('session:' + api, null);
  }
  logout = async (req: FastifyRequest, reply: FastifyReply) => {
    await this.revoke(req);
    reply.clearCookie(ownerCookie(this.config), this.options());
    reply.clearCookie('cor_session', this.options());
    return reply.send({ ok: true });
  };
}
