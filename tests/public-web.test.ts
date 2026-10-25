import { describe, it, expect, vi, beforeEach } from 'vitest';
import { EventEmitter } from 'node:events';
import { Readable } from 'node:stream';
const { dns, request } = vi.hoisted(() => ({ dns: vi.fn(), request: vi.fn() }));
vi.mock('node:dns/promises', () => ({ lookup: dns }));
vi.mock('node:https', () => ({ request }));
import { readPublicWeb } from '../server/public-web.js';

beforeEach(() => {
  dns.mockReset();
  request.mockReset();
});
describe('public web connection boundary', () => {
  it('pins a verified DNS result to the connection and checks every redirect', async () => {
    dns
      .mockResolvedValueOnce([{ address: '8.8.8.8', family: 4 }])
      .mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }]);
    request.mockImplementation((_url, options, callback) => {
      options.lookup('public.example', { all: false }, (error: unknown, address: string, family: number) => {
        expect(error).toBeNull();
        expect(address).toBe('8.8.8.8');
        expect(family).toBe(4);
      });
      const emitter = new EventEmitter() as EventEmitter & { end: () => void };
      emitter.end = () =>
        callback(
          Object.assign(Readable.from([]), {
            statusCode: 302,
            headers: { location: 'https://internal.example/' },
          }),
        );
      return emitter;
    });
    await expect(readPublicWeb('https://public.example/')).rejects.toMatchObject({ status: 400 });
    expect(request).toHaveBeenCalledTimes(1);
    expect(dns).toHaveBeenCalledTimes(2);
  });
  it('rejects mixed public/private DNS answers before opening a socket', async () => {
    dns.mockResolvedValue([
      { address: '8.8.8.8', family: 4 },
      { address: '192.168.1.1', family: 4 },
    ]);
    await expect(readPublicWeb('https://mixed.example/')).rejects.toMatchObject({ status: 400 });
    expect(request).not.toHaveBeenCalled();
  });
});
