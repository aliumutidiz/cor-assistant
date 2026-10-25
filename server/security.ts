import { createRemoteJWKSet, jwtVerify } from 'jose';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { Config } from './config.js';
import type { Store } from './repositories.js';
import { AppError } from './errors.js';
import { OwnerAuth, isLoginCallback } from './login.js';
declare module 'fastify' {
  interface FastifyRequest {
    ownerSession: { id: string; csrf: string };
  }
}
export async function security(app: FastifyInstance, config: Config, store: Store, auth?: OwnerAuth) {
  const prod = config.NODE_ENV === 'production';
  const issuer = `https://${config.CF_ACCESS_TEAM}.cloudflareaccess.com`;
  const jwks =
    prod && config.AUTH_MODE === 'cloudflare'
      ? createRemoteJWKSet(new URL(issuer + '/cdn-cgi/access/certs'))
      : undefined;
  app.addHook('onRequest', async (req, reply) => {
    if (req.url === '/healthz') return;
    const path = new URL(req.url, 'http://localhost').pathname;
    if (prod && config.AUTH_MODE === 'google') {
      if (req.method === 'GET' && (path === '/api/auth/login' || isLoginCallback(req.url))) return;
      if (path.startsWith('/api/') && !(await auth?.identity(req, reply)))
        return reply.code(401).send({ error: 'C.O.R. için giriş yapın.', loginRequired: true });
    } else if (prod) {
      const assertion = req.headers['cf-access-jwt-assertion'];
      if (typeof assertion !== 'string') throw new AppError(401, 'Giriş gerekli.');
      try {
        const { payload } = await jwtVerify(assertion, jwks!, { issuer, audience: config.CF_ACCESS_AUD });
        if (String(payload.email).toLowerCase() !== config.OWNER_EMAIL.toLowerCase()) throw Error();
      } catch {
        throw new AppError(403, 'Erişim reddedildi.');
      }
    } else {
      const host = req.headers.host?.split(':')[0];
      if (!['localhost', '127.0.0.1'].includes(host ?? ''))
        throw new AppError(403, 'Geliştirme yalnızca yerel bilgisayardan kullanılabilir.');
    }
    if (!req.url.startsWith('/api/')) return;
    const cookie = req.cookies.cor_session;
    const unsigned = cookie ? req.unsignCookie(cookie) : undefined;
    let session = unsigned?.valid
      ? await store.get<{ id: string; csrf: string; expires: number }>('session:' + unsigned.value)
      : undefined;
    if (!session || session.expires < Date.now()) {
      if (req.method !== 'GET' || !req.url.startsWith('/api/session'))
        throw new AppError(401, 'Oturum süresi doldu. Sayfayı yenileyin.');
      session = {
        id: randomBytes(32).toString('base64url'),
        csrf: randomBytes(32).toString('base64url'),
        expires: Date.now() + 12 * 3600000,
      };
      await store.set('session:' + session.id, session);
      reply.setCookie('cor_session', session.id, {
        path: '/',
        httpOnly: true,
        secure: prod,
        sameSite: 'lax',
        signed: true,
        maxAge: 12 * 3600,
      });
    }
    req.ownerSession = { id: session.id, csrf: session.csrf };
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
      const origin = req.headers.origin;
      if (origin !== new URL(config.APP_ORIGIN).origin) throw new AppError(403, 'İstek kaynağı reddedildi.');
      const csrf = req.headers['x-cor-csrf'];
      if (
        typeof csrf !== 'string' ||
        !/^[A-Za-z0-9_-]{43}$/.test(csrf) ||
        !timingSafeEqual(Buffer.from(csrf), Buffer.from(session.csrf))
      )
        throw new AppError(403, 'İstek doğrulanamadı.');
    }
  });
}
export function requestKey(req: FastifyRequest) {
  const value = req.headers['idempotency-key'];
  if (typeof value !== 'string' || !/^[a-zA-Z0-9:_-]{8,160}$/.test(value))
    throw new AppError(400, 'Geçerli bir işlem anahtarı gerekli.');
  return value;
}
