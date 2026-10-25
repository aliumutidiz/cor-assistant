import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { existsSync } from 'node:fs';
import { afterEach, beforeEach, describe, it, expect, vi } from 'vitest';
const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));
vi.mock('node:child_process', () => ({ spawn: spawnMock }));
import { LocalSpeechTranscriber } from '../server/speech';
import { loadConfig } from '../server/config';
const config = loadConfig({ NODE_ENV: 'test', STT_ENABLED: 'true', STT_MODEL_PATH: 'fixture-model' });
let child: EventEmitter & { stdout: PassThrough; stderr: PassThrough; kill: ReturnType<typeof vi.fn> };
beforeEach(() => {
  child = Object.assign(new EventEmitter(), {
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill: vi.fn(),
  });
  spawnMock.mockImplementation(() => {
    queueMicrotask(() => {
      child.stdout.write(JSON.stringify({ text: 'Yarın saat 10 için toplantı oluştur.', reliable: true }));
      child.emit('close', 0);
    });
    return child;
  });
});
afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});
describe('offline speech adapter', () => {
  it('rejects recordings whose decoded duration exceeds the limit', async () => {
    spawnMock.mockImplementation(() => {
      queueMicrotask(() => {
        child.stdout.write(JSON.stringify({ error: 'audio_too_long' }));
        child.emit('close', 0);
      });
      return child;
    });
    await expect(new LocalSpeechTranscriber(config).transcribe(new Uint8Array([1]))).rejects.toMatchObject({
      status: 413,
    });
  });
  it('returns Turkish text, runs offline without a shell, excludes credentials and removes audio', async () => {
    vi.stubEnv('TELEGRAM_BOT_TOKEN', 'do-not-inherit');
    expect(await new LocalSpeechTranscriber(config).transcribe(new Uint8Array([1, 2, 3]))).toContain('Yarın');
    const [command, args, options] = spawnMock.mock.calls[0];
    expect(command).toBe('python');
    expect(options.shell).toBe(false);
    expect(options.env).not.toHaveProperty('TELEGRAM_BOT_TOKEN');
    expect(options.env.HF_HUB_OFFLINE).toBe('1');
    expect(existsSync(args[1])).toBe(false);
  });
  it('does not start a process before speech is configured', async () => {
    await expect(
      new LocalSpeechTranscriber(loadConfig({ NODE_ENV: 'test' })).transcribe(new Uint8Array([1])),
    ).rejects.toMatchObject({ status: 503 });
    expect(spawnMock).not.toHaveBeenCalled();
  });
  it('rejects uncertain transcripts instead of guessing an action', async () => {
    spawnMock.mockImplementation(() => {
      queueMicrotask(() => {
        child.stdout.write(JSON.stringify({ text: '...', reliable: false }));
        child.emit('close', 0);
      });
      return child;
    });
    await expect(new LocalSpeechTranscriber(config).transcribe(new Uint8Array([1]))).rejects.toMatchObject({
      status: 422,
    });
    expect(existsSync(spawnMock.mock.calls[0][1][1])).toBe(false);
  });
  it('rejects oversized input before process execution', async () => {
    await expect(
      new LocalSpeechTranscriber(config).transcribe(new Uint8Array(8 * 1024 * 1024 + 1)),
    ).rejects.toMatchObject({ status: 413 });
    expect(spawnMock).not.toHaveBeenCalled();
  });
});
