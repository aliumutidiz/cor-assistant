import { describe, it, expect, vi } from 'vitest';
import { VoiceOutput } from '../server/voice-output.js';
import { MemoryStore } from '../server/repositories.js';
import { loadConfig } from '../server/config.js';

function wav() {
  const value = Buffer.alloc(48);
  value.write('RIFF', 0);
  value.writeUInt32LE(40, 4);
  value.write('WAVE', 8);
  return value;
}
const settings = { enabled: true, freeTierConfirmed: true, voice: 'Sulafat', dailyLimit: 2 };
const apiKey = 'test-secret-for-voice-unit-fixtures';
function setup() {
  const store = new MemoryStore(),
    request = vi.fn<typeof fetch>();
  return { store, request, voice: new VoiceOutput(loadConfig({ NODE_ENV: 'test' }), store, request) };
}
describe('private Google voice output', () => {
  it('delivers the first PCM before completion and reuses a complete WAV without a second request', async () => {
    const h = setup();
    await h.voice.configure({ settings: { ...settings, voice: 'Charon' }, apiKey });
    const pcm = Buffer.from([0, 0, 255, 127]);
    let complete: () => void = () => {};
    const received: string[] = [];
    h.request.mockImplementation(
      async () =>
        new Response(
          new ReadableStream({
            start(controller) {
              const send = (event: unknown) =>
                controller.enqueue(new TextEncoder().encode('data: ' + JSON.stringify(event) + '\r\n\r\n'));
              send({
                event_type: 'step.delta',
                delta: { type: 'audio', mime_type: 'audio/l16', data: pcm.toString('base64') },
              });
              complete = () => {
                send({ event_type: 'interaction.completed', interaction: { status: 'completed' } });
                controller.close();
              };
            },
          }),
          { headers: { 'content-type': 'text/event-stream' } },
        ),
    );
    const audio = await h.voice.speak({ text: 'deneme' }, undefined, (frame) => {
      received.push(frame.format);
      expect(frame.format).toBe('pcm');
      complete();
    });
    expect(received).toEqual(['pcm']);
    expect(audio.toString('ascii', 0, 4)).toBe('RIFF');
    expect(audio.subarray(44)).toEqual(pcm);
    expect(audio.readUInt32LE(24)).toBe(24000);
    await h.voice.speak({ text: 'deneme' }, undefined, (frame) => {
      received.push(frame.format);
    });
    expect(received).toEqual(['pcm', 'wav']);
    expect(h.request).toHaveBeenCalledTimes(1);
    expect((await h.voice.status()).used).toBe(1);
    const body = JSON.parse(String(h.request.mock.calls[0][1]?.body));
    expect(body).toMatchObject({
      stream: true,
      store: false,
      generation_config: { speech_config: [{ voice: 'Charon' }] },
      response_format: { mime_type: 'audio/l16' },
    });
  });
  it.each(['truncated', 'error', 'wrong-format'])(
    'rejects %s streams without caching partial audio',
    async (failure) => {
      const h = setup();
      await h.voice.configure({ settings, apiKey });
      const delta = {
        event_type: 'step.delta',
        delta: {
          type: 'audio',
          mime_type: failure === 'wrong-format' ? 'audio/mp3' : 'audio/l16',
          data: 'AAAAAA==',
        },
      };
      const data =
        'data: ' +
        JSON.stringify(delta) +
        '\n\n' +
        (failure === 'error' ? 'data: {"event_type":"error"}\n\n' : '');
      h.request.mockImplementation(
        async () => new Response(data, { headers: { 'content-type': 'text/event-stream' } }),
      );
      await expect(h.voice.speak({ text: 'deneme' }, undefined, () => {})).rejects.toMatchObject({
        status: 502,
      });
      await expect(h.voice.speak({ text: 'deneme' }, undefined, () => {})).rejects.toMatchObject({
        status: 502,
      });
      expect(h.request).toHaveBeenCalledTimes(2);
    },
  );
  it('forwards cancellation to generation and does not cache an aborted request', async () => {
    const h = setup();
    await h.voice.configure({ settings, apiKey });
    const controller = new AbortController();
    let began: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      began = resolve;
    });
    h.request.mockImplementation(
      async (_url, options) =>
        new Promise<Response>((_resolve, reject) => {
          options!.signal!.addEventListener(
            'abort',
            () => reject(new DOMException('aborted', 'AbortError')),
            { once: true },
          );
          began();
        }),
    );
    const result = expect(h.voice.speak({ text: 'deneme' }, controller.signal)).rejects.toMatchObject({
      status: 499,
    });
    await started;
    controller.abort();
    await result;
    expect(h.request).toHaveBeenCalledTimes(1);
  });
  it('keeps keys encrypted and never returns them in status', async () => {
    const h = setup();
    const result = await h.voice.configure({ settings, apiKey });
    expect(JSON.stringify(result)).not.toContain(apiKey);
    expect(await h.store.get('voice.credentials')).not.toContain(apiKey);
    expect(result.configured).toBe(true);
  });
  it('requires an enabled, confirmed free-tier setup before making requests', async () => {
    const h = setup();
    await expect(h.voice.speak({ text: 'deneme' })).rejects.toMatchObject({ status: 503 });
    await expect(
      h.voice.configure({ settings: { ...settings, freeTierConfirmed: false }, apiKey }),
    ).rejects.toMatchObject({ status: 400 });
    expect(h.request).not.toHaveBeenCalled();
  });
  it('deduplicates concurrent requests and caches successful audio without spending quota twice', async () => {
    const h = setup();
    await h.voice.configure({ settings, apiKey });
    h.request.mockImplementation(async () =>
      Response.json({
        steps: [{ type: 'model_output', content: [{ type: 'audio', data: wav().toString('base64') }] }],
      }),
    );
    const responses = await Promise.all([
      h.voice.speak({ text: '**deneme**' }),
      h.voice.speak({ text: '**deneme**' }),
    ]);
    expect(responses[0]).toEqual(wav());
    await h.voice.speak({ text: '**deneme**' });
    expect(h.request).toHaveBeenCalledTimes(1);
    expect((await h.voice.status()).used).toBe(1);
    const request = JSON.parse(String(h.request.mock.calls[0][1]?.body));
    expect(request).toMatchObject({ model: 'gemini-3.8-flash-lite-tts', store: false });
    expect(request.input[0].content[0].text).toBe('deneme');
    expect(h.request.mock.calls[0][0]).not.toContain(apiKey);
  });
  it('reports quota failures without retries or paid fallback', async () => {
    const h = setup();
    await h.voice.configure({ settings, apiKey });
    h.request.mockResolvedValue(new Response('{}', { status: 429 }));
    await expect(h.voice.speak({ text: 'deneme' })).rejects.toMatchObject({ status: 429 });
    expect(h.request).toHaveBeenCalledTimes(1);
  });
  it('enforces the durable daily quota and validates audio', async () => {
    const h = setup();
    await h.voice.configure({ settings: { ...settings, dailyLimit: 1 }, apiKey });
    h.request.mockResolvedValue(
      Response.json({
        steps: [
          {
            type: 'model_output',
            content: [{ type: 'audio', data: Buffer.from('not audio').toString('base64') }],
          },
        ],
      }),
    );
    await expect(h.voice.speak({ text: 'deneme' })).rejects.toMatchObject({ status: 502 });
    await expect(h.voice.speak({ text: 'ikinci' })).rejects.toMatchObject({ status: 429 });
    expect(h.request).toHaveBeenCalledTimes(1);
  });
});
