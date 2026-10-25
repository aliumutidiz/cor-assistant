import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';
import { createHash } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { createApp } from '../server/app.js';
import { loadConfig } from '../server/config.js';
import { MemoryStore } from '../server/repositories.js';
import { DemoCalendar } from '../server/google.js';
let app: FastifyInstance;
let pair: Awaited<ReturnType<typeof generateKeyPair>>;
beforeAll(async () => {
  pair = await generateKeyPair('RS256');
});
afterEach(async () => {
  await app?.close();
  vi.unstubAllGlobals();
});
const environment = {
  NODE_ENV: 'production',
  AUTH_MODE: 'google',
  DEMO_MODE: 'false',
  DATABASE_URL: 'postgresql://unused/test',
  SESSION_SECRET: 's'.repeat(64),
  ENCRYPTION_KEY: Buffer.alloc(32, 7).toString('base64'),
  OWNER_EMAIL: 'owner@gmail.com',
  APP_ORIGIN: 'https://cor.example.org',
  GOOGLE_CLIENT_ID: 'cor-google-client',
  GOOGLE_CLIENT_SECRET: 'test-client-secret',
  GOOGLE_REDIRECT_URI: 'https://cor.example.org/api/oauth/callback',
};
async function setup(
  claims: Record<string, unknown> = {},
  options: {
    issuer?: string;
    audience?: string;
    expired?: boolean;
    badSignature?: boolean;
    tokenError?: boolean;
  } = {},
) {
  const store = new MemoryStore();
  app = (await createApp(loadConfig(environment), store, { calendar: new DemoCalendar() })).app;
  const begin = await app.inject('/api/auth/login');
  const url = new URL(begin.headers.location!);
  const cookie = begin.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
  const jwk = await exportJWK(pair.publicKey);
  const signingKey = options.badSignature ? (await generateKeyPair('RS256')).privateKey : pair.privateKey;
  const token = await new SignJWT({
    email: 'owner@gmail.com',
    email_verified: true,
    nonce: url.searchParams.get('nonce'),
    ...claims,
  })
    .setProtectedHeader({ alg: 'RS256', kid: 'login-key' })
    .setSubject(String(claims.sub ?? 'owner-subject'))
    .setIssuer(options.issuer ?? 'https://accounts.google.com')
    .setAudience(options.audience ?? environment.GOOGLE_CLIENT_ID)
    .setIssuedAt()
    .setExpirationTime(options.expired ? '-1h' : '1h')
    .sign(signingKey);
  const fetchMock = vi.fn(async (input: string | URL | Request) => {
    const target = String(input);
    if (target === 'https://oauth2.googleapis.com/token')
      return options.tokenError ? new Response('{}', { status: 400 }) : Response.json({ id_token: token });
    if (target === 'https://www.googleapis.com/oauth2/v3/certs')
      return Response.json({ keys: [{ ...jwk, kid: 'login-key', alg: 'RS256', use: 'sig' }] });
    throw Error('Unexpected external call');
  });
  vi.stubGlobal('fetch', fetchMock);
  const callback = '/api/oauth/callback?state=' + url.searchParams.get('state') + '&code=authorization-code';
  return { store, begin, url, cookie, callback, fetchMock };
}
describe('owner-only Google application login', () => {
  it('requires configured Google authentication with an exact same-origin callback', () => {
    expect(() => loadConfig(environment)).not.toThrow();
    for (const patch of [
      { GOOGLE_CLIENT_SECRET: '' },
      { GOOGLE_REDIRECT_URI: 'https://evil.test/api/oauth/callback' },
      { GOOGLE_REDIRECT_URI: 'https://cor.example.org/other' },
    ])
      expect(() => loadConfig({ ...environment, ...patch })).toThrow();
  });
  it('does not mint anonymous API sessions or accept forged proxy identity', async () => {
    await setup();
    for (const path of ['/api/session', '/api/events', '/api/routines', '/api/history', '/api/progress']) {
      const response = await app.inject({
        url: path,
        headers: {
          'cf-access-authenticated-user-email': 'owner@gmail.com',
          'cf-access-jwt-assertion': 'forged',
        },
      });
      expect(response.statusCode).toBe(401);
      expect(response.cookies).toHaveLength(0);
    }
  });
  it('uses PKCE, nonce, limited scopes and a host-only secure browser binding', async () => {
    const { begin, url } = await setup();
    expect(begin.statusCode).toBe(302);
    expect(url.searchParams.get('scope')).toBe('openid email');
    expect(url.searchParams.get('code_challenge_method')).toBe('S256');
    expect(url.searchParams.get('nonce')).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(begin.cookies[0]).toMatchObject({
      name: '__Host-cor_login',
      httpOnly: true,
      secure: true,
      path: '/',
      sameSite: 'Lax',
    });
    expect(begin.cookies[0].domain).toBeUndefined();
    expect(begin.headers['cache-control']).toBe('no-store');
  });
  it('authenticates only after signature validation and rotates into an owner session', async () => {
    const { callback, cookie, fetchMock } = await setup();
    const result = await app.inject({ url: callback, headers: { cookie } });
    expect(result.statusCode).toBe(302);
    expect(result.headers.location).toBe('/');
    const owner = result.cookies.find((c) => c.name === '__Host-cor_owner')!;
    expect(owner).toMatchObject({ httpOnly: true, secure: true, maxAge: 2592000, path: '/' });
    const session = await app.inject({
      url: '/api/session',
      headers: { cookie: `${owner.name}=${owner.value}` },
    });
    expect(session.statusCode).toBe(200);
    expect(session.json().owner).toBe('owner@gmail.com');
    const body = fetchMock.mock.calls.find((call) => String(call[0]).endsWith('/token'));
    expect(body).toBeDefined();
  });
  it.each([
    { email: 'other@gmail.com' },
    { email_verified: false },
    { nonce: 'wrong' },
    { azp: 'other-client' },
  ])('rejects unauthorized or mismatched claims: %j', async (claims) => {
    const { callback, cookie } = await setup(claims);
    expect((await app.inject({ url: callback, headers: { cookie } })).statusCode).toBe(403);
  });
  it.each([
    { issuer: 'https://evil.test' },
    { audience: 'other-client' },
    { expired: true },
    { badSignature: true },
  ])('rejects invalid token verification: %j', async (options) => {
    const { callback, cookie } = await setup({}, options);
    expect((await app.inject({ url: callback, headers: { cookie } })).statusCode).toBe(403);
  });
  it('rejects a changed Google subject even with the allowed email', async () => {
    const { callback, cookie, store } = await setup();
    await store.set('auth.owner-subject', 'previous-owner-subject');
    expect((await app.inject({ url: callback, headers: { cookie } })).statusCode).toBe(403);
  });
  it('rejects absent browser binding, a replayed state and provider failures', async () => {
    const { callback, cookie } = await setup();
    expect((await app.inject(callback)).statusCode).toBe(400);
    expect((await app.inject({ url: callback, headers: { cookie } })).statusCode).toBe(302);
    expect((await app.inject({ url: callback, headers: { cookie } })).statusCode).toBe(400);
  });
  it('rejects a state copied into another browser', async () => {
    const { callback } = await setup();
    const second = await app.inject('/api/auth/login');
    const cookie = second.cookies.map((c) => `${c.name}=${c.value}`).join('; ');
    expect((await app.inject({ url: callback, headers: { cookie } })).statusCode).toBe(400);
  });
  it('fails closed on token exchange failure', async () => {
    const { callback, cookie } = await setup({}, { tokenError: true });
    expect((await app.inject({ url: callback, headers: { cookie } })).statusCode).toBe(401);
  });
  it('rejects expired and forged owner cookies, including legacy anonymous sessions', async () => {
    const { callback, cookie, store } = await setup();
    const login = await app.inject({ url: callback, headers: { cookie } });
    const owner = login.cookies.find((c) => c.name === '__Host-cor_owner')!;
    const raw = app.unsignCookie(decodeURIComponent(owner.value));
    expect(raw.valid).toBe(true);
    const key = 'owner-session:' + createHash('sha256').update(raw.value!).digest('base64url');
    const record = await store.get<Record<string, unknown>>(key);
    await store.set(key, { ...record, expires: Date.now() - 1 });
    expect(
      (await app.inject({ url: '/api/session', headers: { cookie: `${owner.name}=${owner.value}` } }))
        .statusCode,
    ).toBe(401);
    expect(
      (
        await app.inject({
          url: '/api/session',
          headers: { cookie: '__Host-cor_owner=forged; cor_session=legacy' },
        })
      ).statusCode,
    ).toBe(401);
  });
  it('expires login transactions and rate-limits repeated login starts', async () => {
    const { callback, cookie, store, url } = await setup();
    const state = url.searchParams.get('state')!;
    const record = await store.takeTransient('login:' + state);
    await store.putTransient('login:' + state, record, new Date(Date.now() - 1).toISOString());
    expect((await app.inject({ url: callback, headers: { cookie } })).statusCode).toBe(400);
    let response;
    for (let i = 0; i < 11; i++) response = await app.inject('/api/auth/login');
    expect(response!.statusCode).toBe(429);
  });
  it('requires CSRF for logout and revokes copied cookies on the server', async () => {
    const { callback, cookie } = await setup();
    const login = await app.inject({ url: callback, headers: { cookie } });
    const owner = login.cookies.find((c) => c.name === '__Host-cor_owner')!;
    const ownerCookie = `${owner.name}=${owner.value}`;
    const session = await app.inject({ url: '/api/session', headers: { cookie: ownerCookie } });
    const apiCookie = session.cookies.find((c) => c.name === 'cor_session')!;
    const headers = {
      cookie: `${ownerCookie}; ${apiCookie.name}=${apiCookie.value}`,
      origin: environment.APP_ORIGIN,
    };
    expect(
      (await app.inject({ method: 'POST', url: '/api/auth/logout', headers, payload: {} })).statusCode,
    ).toBe(403);
    expect(
      (
        await app.inject({
          method: 'POST',
          url: '/api/auth/logout',
          headers: { ...headers, 'x-cor-csrf': session.json().csrf },
          payload: {},
        })
      ).statusCode,
    ).toBe(200);
    expect((await app.inject({ url: '/api/session', headers })).statusCode).toBe(401);
  });
});
