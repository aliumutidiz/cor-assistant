import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { describe, it, expect, beforeAll, afterEach, vi } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { loadConfig } from '../server/config.js';
import { createApp } from '../server/app.js';
import { MemoryStore } from '../server/repositories.js';
import { DemoCalendar } from '../server/google.js';
let pair: Awaited<ReturnType<typeof generateKeyPair>>, app: FastifyInstance;
beforeAll(async () => {
  pair = await generateKeyPair('RS256');
});
afterEach(async () => {
  await app?.close();
  vi.unstubAllGlobals();
});
async function setup() {
  const jwk = await exportJWK(pair.publicKey);
  vi.stubGlobal(
    'fetch',
    vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ keys: [{ ...jwk, kid: 'test-key', alg: 'RS256', use: 'sig' }] }), {
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
  );
  const config = loadConfig({
    NODE_ENV: 'production',
    DEMO_MODE: 'false',
    DATABASE_URL: 'postgresql://unused/test',
    SESSION_SECRET: 'a'.repeat(64),
    ENCRYPTION_KEY: Buffer.alloc(32, 8).toString('base64'),
    OWNER_EMAIL: 'owner@example.org',
    CF_ACCESS_TEAM: 'cor-test',
    CF_ACCESS_AUD: 'cor-app',
    APP_ORIGIN: 'https://cor.example.org',
  });
  app = (await createApp(config, new MemoryStore(), { calendar: new DemoCalendar() })).app;
}
async function jwt(email = 'owner@example.org', aud = 'cor-app', expires = '2h') {
  return await new SignJWT({ email })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-key' })
    .setIssuer('https://cor-test.cloudflareaccess.com')
    .setAudience(aud)
    .setIssuedAt()
    .setExpirationTime(expires)
    .sign(pair.privateKey);
}
describe('production Access verification', () => {
  it('rejects absent identity even when origin is reachable', async () => {
    await setup();
    expect((await app.inject({ url: '/api/session' })).statusCode).toBe(401);
  });
  it('accepts a signed Access JWT for the configured owner only', async () => {
    await setup();
    const response = await app.inject({
      url: '/api/session',
      headers: { 'cf-access-jwt-assertion': await jwt() },
    });
    expect(response.statusCode).toBe(200);
    expect(response.cookies[0]).toMatchObject({ httpOnly: true, secure: true });
  });
  it('rejects a different signed owner identity', async () => {
    await setup();
    expect(
      (
        await app.inject({
          url: '/api/session',
          headers: { 'cf-access-jwt-assertion': await jwt('other@example.org') },
        })
      ).statusCode,
    ).toBe(403);
  });
  it('rejects audience mismatch and expired JWTs', async () => {
    await setup();
    for (const token of [
      await jwt('owner@example.org', 'another-app'),
      await jwt('owner@example.org', 'cor-app', '-1h'),
    ])
      expect(
        (await app.inject({ url: '/api/session', headers: { 'cf-access-jwt-assertion': token } })).statusCode,
      ).toBe(403);
  });
  it('rejects unsigned or forged header identities', async () => {
    await setup();
    expect(
      (
        await app.inject({
          url: '/api/session',
          headers: {
            'cf-access-jwt-assertion': 'forged',
            'cf-access-authenticated-user-email': 'owner@example.org',
          },
        })
      ).statusCode,
    ).toBe(403);
  });
});
