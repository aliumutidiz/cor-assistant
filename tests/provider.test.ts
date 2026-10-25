import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: spawnMock }));
import { AgyProvider } from '../server/provider.js';
import { loadConfig } from '../server/config.js';
const config = loadConfig({
  NODE_ENV: 'test',
  AGY_ENABLED: 'true',
  AGY_APPROVAL_EVIDENCE: 'fixture-only',
  AGY_LINUX_VERIFIED: 'true',
  AGY_ISOLATION_VERIFIED: 'true',
  AGY_WORKDIR: 'isolated-test-workdir',
  AGY_MODEL: 'fixture-model',
  AGY_TIMEOUT_MS: '1000',
});
let child: EventEmitter & { stdout: PassThrough; stderr: PassThrough; kill: ReturnType<typeof vi.fn> };
beforeEach(() => {
  vi.useFakeTimers();
  child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
  });
  spawnMock.mockReturnValue(child);
});
afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});
describe('AGY process adapter', () => {
  it('parses official structured output and keeps secrets out of child environment', async () => {
    vi.stubEnv('GOOGLE_CLIENT_SECRET', 'never-inherit');
    const promise = new AgyProvider(config).generate('test', { type: 'object' });
    child.stdout.write(
      JSON.stringify({ status: 'SUCCESS', structured_output: { ok: true }, usage: { total_tokens: 17 } }),
    );
    child.emit('close', 0);
    expect(await promise).toEqual({ output: { ok: true }, usage: { total_tokens: 17 } });
    const args = spawnMock.mock.calls[0];
    expect(args[1]).not.toContain('--dangerously-skip-permissions');
    expect(args[1]).toContain('--sandbox');
    expect(args[1]).toContain('--disable-slash-commands');
    expect(args[1]).toContain('1000ms');
    expect(args[2].shell).toBe(false);
    expect(args[2].env).not.toHaveProperty('GOOGLE_CLIENT_SECRET');
    vi.unstubAllEnvs();
  });
  it('terminates a timed-out child', async () => {
    const promise = new AgyProvider(config).generate('test', {});
    const assertion = expect(promise).rejects.toMatchObject({ status: 504 });
    await vi.advanceTimersByTimeAsync(1001);
    await assertion;
    expect(child.kill).toHaveBeenCalledOnce();
  });
  it('does not launch a request canceled before execution', async () => {
    const abort = new AbortController();
    abort.abort();
    await expect(new AgyProvider(config).generate('test', {}, abort.signal)).rejects.toMatchObject({
      status: 499,
    });
    expect(spawnMock).not.toHaveBeenCalled();
  });
  it('rejects concurrent requests and releases its slot after completion', async () => {
    const provider = new AgyProvider(config);
    const first = provider.generate('first', {});
    await expect(provider.generate('second', {})).rejects.toMatchObject({ status: 429 });
    expect(spawnMock).toHaveBeenCalledTimes(1);
    child.stdout.write(JSON.stringify({ status: 'SUCCESS', structured_output: { ok: true } }));
    child.emit('close', 0);
    await first;
    child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      kill: vi.fn(),
    });
    spawnMock.mockReturnValue(child);
    const next = provider.generate('third', {});
    child.stdout.write(JSON.stringify({ status: 'SUCCESS', structured_output: { ok: true } }));
    child.emit('close', 0);
    await next;
    expect(spawnMock).toHaveBeenCalledTimes(2);
  });
  it('supports cancellation', async () => {
    const abort = new AbortController();
    const promise = new AgyProvider(config).generate('test', {}, abort.signal);
    abort.abort();
    await expect(promise).rejects.toMatchObject({ status: 499 });
    expect(child.kill).toHaveBeenCalled();
  });
  it('reports quota and authentication without leaking raw diagnostics', async () => {
    for (const [diagnostic, message] of [
      ['quota exhausted PRIVATE', 'kullanım sınırına'],
      ['authentication required PRIVATE', 'oturumu açılmalı'],
    ]) {
      const promise = new AgyProvider(config).generate('test', {});
      child.stderr.write(diagnostic);
      child.emit('close', 1);
      await expect(promise).rejects.toThrow(message);
      child = Object.assign(new EventEmitter(), {
        stdout: new PassThrough(),
        stderr: new PassThrough(),
        kill: vi.fn(),
      });
      spawnMock.mockReturnValue(child);
    }
  });
  it('rejects malformed success output', async () => {
    const promise = new AgyProvider(config).generate('test', {});
    child.stdout.write('not json');
    child.emit('close', 0);
    await expect(promise).rejects.toMatchObject({ status: 502 });
  });
});
