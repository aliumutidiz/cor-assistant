import { createServer, type Server, type Socket } from 'node:net';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { AgySocketProvider } from '../server/agy-socket.js';
import { loadConfig } from '../server/config.js';

let server: Server | undefined;
const sockets = new Set<Socket>();
afterEach(async () => {
  for (const socket of sockets) socket.destroy();
  sockets.clear();
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
});
async function setup(handle: (socket: Socket, request: string) => void) {
  const path =
    process.platform === 'win32'
      ? `\\\\.\\pipe\\cor-agy-${randomUUID()}`
      : join(tmpdir(), `cor-agy-${randomUUID()}.sock`);
  server = createServer((socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    let input = '';
    socket.on('data', (data) => {
      input += data.toString();
      if (input.includes('\n')) handle(socket, input);
    });
  });
  await new Promise<void>((resolve, reject) => {
    server!.once('error', reject);
    server!.listen(path, resolve);
  });
  return new AgySocketProvider({
    ...loadConfig({ NODE_ENV: 'test' }),
    AGY_ENABLED: true,
    AGY_SOCKET: path as '/run/cor-agy/model.sock',
    AGY_TIMEOUT_MS: 1000,
  });
}
describe('isolated AGY socket transport', () => {
  it('sends only prompt/schema and decodes a split UTF-8 response', async () => {
    const provider = await setup((socket, request) => {
      expect(JSON.parse(request)).toEqual({ prompt: 'Merhaba', schema: { type: 'object' } });
      const bytes = Buffer.from(
        JSON.stringify({ output: { message: 'Günaydın' }, usage: { input_tokens: 12 } }) + '\n',
      );
      const split = bytes.indexOf(Buffer.from('ü')) + 1;
      socket.write(bytes.subarray(0, split));
      setTimeout(() => socket.end(bytes.subarray(split)), 5);
    });
    expect(await provider.generate('Merhaba', { type: 'object' })).toEqual({
      output: { message: 'Günaydın' },
      usage: { input_tokens: 12 },
    });
  });
  it('fails closed on an invalid broker response', async () => {
    const provider = await setup((socket) => socket.end('{"output":null}\n'));
    await expect(provider.generate('x', {})).rejects.toMatchObject({ status: 502 });
  });
  it('reports busy without retrying model work', async () => {
    const provider = await setup((socket) => socket.end('{"error":"busy"}\n'));
    await expect(provider.generate('x', {})).rejects.toMatchObject({ status: 429 });
  });
  it('does not send an oversized request', async () => {
    const provider = await setup(() => {
      throw Error('Should not receive a request');
    });
    await expect(provider.generate('x'.repeat(196609), {})).rejects.toMatchObject({ status: 413 });
  });
  it('reports a model quota error without retrying or exposing diagnostics', async () => {
    const provider = await setup((socket) => socket.end('{"error":"ModelQuotaError"}\n'));
    await expect(provider.generate('x', {})).rejects.toMatchObject({
      status: 429,
      message: expect.stringContaining('kotasına'),
    });
  });
  it('rejects overlapping requests and cancels the active connection', async () => {
    const provider = await setup(() => {});
    const controller = new AbortController();
    const pending = provider.generate('first', {}, controller.signal);
    const assertion = expect(pending).rejects.toMatchObject({ status: 499 });
    await expect(provider.generate('second', {})).rejects.toMatchObject({ status: 429 });
    controller.abort();
    await assertion;
  });
  it('rejects incomplete output after disconnect', async () => {
    const provider = await setup((socket) => socket.end('{"output":'));
    await expect(provider.generate('x', {})).rejects.toMatchObject({ status: 503 });
  });
  it('enforces the request timeout', async () => {
    const provider = await setup(() => {});
    await expect(provider.generate('x', {})).rejects.toMatchObject({ status: 504 });
  });
});
