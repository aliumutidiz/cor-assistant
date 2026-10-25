import { afterEach, describe, it, expect, vi } from 'vitest';
import { VoicePlayer } from '../src/voice-player';
import { VoiceCache } from '../src/voice-cache';
import type { VoiceFrame } from '../shared/voice';

const frame: VoiceFrame = { type: 'audio', format: 'pcm', data: Buffer.alloc(1920).toString('base64') };
class FakeContext {
  currentTime = 0;
  destination = {};
  sources: {
    buffer: any;
    onended?: () => void;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    connect: ReturnType<typeof vi.fn>;
  }[] = [];
  resume = vi.fn().mockResolvedValue(undefined);
  close = vi.fn().mockResolvedValue(undefined);
  createBuffer(_channels: number, samples: number, rate: number) {
    const data = new Float32Array(samples);
    return { duration: samples / rate, getChannelData: () => data };
  }
  createBufferSource() {
    const source = {
      buffer: undefined as any,
      onended: undefined as (() => void) | undefined,
      start: vi.fn(),
      stop: vi.fn(),
      disconnect: vi.fn(),
      connect: vi.fn(),
    };
    this.sources.push(source);
    return source;
  }
}
function setup() {
  vi.useFakeTimers();
  let context!: FakeContext;
  vi.stubGlobal(
    'AudioContext',
    class extends FakeContext {
      constructor() {
        super();
        context = this;
      }
    },
  );
  const onStart = vi.fn(),
    player = new VoicePlayer(onStart);
  return { context, onStart, player };
}
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});
describe('buffered voice playback', () => {
  it('coalesces tiny PCM packets and schedules blocks contiguously without per-packet gaps', async () => {
    const h = setup();
    for (let i = 0; i < 24; i++) await h.player.append(frame);
    expect(h.context.sources).toHaveLength(0);
    await h.player.append(frame);
    expect(h.context.sources).toHaveLength(1);
    h.context.currentTime = 0.2;
    for (let i = 0; i < 10; i++) await h.player.append(frame);
    expect(h.context.sources).toHaveLength(2);
    expect(h.context.sources[0].buffer.duration).toBe(1);
    expect(h.context.sources[0].start).toHaveBeenCalledWith(0.05);
    expect(h.context.sources[1].start).toHaveBeenCalledWith(1.05);
    expect(h.onStart).toHaveBeenCalledOnce();
    h.player.stop();
  });
  it('re-buffers after an underrun instead of playing each tiny late packet', async () => {
    const h = setup();
    for (let i = 0; i < 25; i++) await h.player.append(frame);
    h.context.currentTime = 2;
    for (let i = 0; i < 24; i++) await h.player.append(frame);
    expect(h.context.sources).toHaveLength(1);
    await h.player.append(frame);
    expect(h.context.sources).toHaveLength(2);
    expect(h.context.sources[1].start).toHaveBeenCalledWith(2.05);
    h.player.stop();
  });
  it('drains short replies and trailing fragments, and stop releases pending completion', async () => {
    const h = setup();
    await h.player.append(frame);
    const done = h.player.finish();
    await Promise.resolve();
    expect(h.context.sources[0].buffer.duration).toBe(0.04);
    h.player.stop();
    await done;
    expect(h.context.close).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(1000);
    expect(h.context.sources).toHaveLength(1);
  });
});
describe('short-lived private audio cache', () => {
  it('expires completed clips, enforces memory bounds and clears on demand', () => {
    vi.useFakeTimers();
    const cache = new VoiceCache(1000, 2 * frame.data.length);
    cache.put('voice-a:message', [frame]);
    expect(cache.get('voice-a:message')).toEqual([frame]);
    expect(cache.get('voice-b:message')).toBeUndefined();
    cache.put('voice-a:other', [frame]);
    expect(cache.get('voice-a:message')).toBeUndefined();
    vi.advanceTimersByTime(1001);
    expect(cache.get('voice-a:other')).toBeUndefined();
    cache.put('last', [frame]);
    cache.clear();
    expect(cache.get('last')).toBeUndefined();
  });
});
