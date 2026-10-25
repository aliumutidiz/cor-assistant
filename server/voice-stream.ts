import type { VoiceFrame } from '../shared/voice.js';

export const VOICE_STYLE =
  'Read the transcript verbatim in its original language, with a warm, resonant, confident character and a brisk but unhurried conversational pace. Avoid long dramatic pauses and announcer-style delivery. Do not translate or add words.';

export function pcmWav(pcm: Buffer) {
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(24000, 24);
  header.writeUInt32LE(48000, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

// Only bounded, validated audio deltas leave this parser. Provider diagnostics stay private.
export async function streamedVoice(
  body: ReadableStream<Uint8Array>,
  emit: (frame: VoiceFrame) => Promise<void> | void,
  signal: AbortSignal,
) {
  let pending = '',
    bytes = 0,
    audioBytes = 0,
    completed = false;
  const pcm: Buffer[] = [],
    decoder = new TextDecoder();
  const reader = body.getReader();
  const consume = async (line: string) => {
    if (!line.startsWith('data:')) return;
    const raw = line.slice(5).trim();
    if (!raw || raw === '[DONE]') return;
    const event = JSON.parse(raw);
    if (event.event_type === 'error' || event.event_type === 'interaction.failed')
      throw Error('Voice stream failed');
    if (event.event_type === 'interaction.complete' || event.event_type === 'interaction.completed') {
      if (event.interaction?.status && event.interaction.status !== 'completed')
        throw Error('Incomplete voice');
      completed = true;
    }
    if (event.event_type !== 'step.delta' || event.delta?.type !== 'audio') return;
    if (completed) throw Error('Audio after completion');
    if (event.delta.mime_type && !/^audio\/l16(?:;|$)/i.test(event.delta.mime_type))
      throw Error('Unexpected audio encoding');
    const data = event.delta.data;
    if (typeof data !== 'string' || data.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(data))
      throw Error('Invalid audio');
    const chunk = Buffer.from(data, 'base64');
    audioBytes += chunk.length;
    if (audioBytes > 8 * 1024 * 1024 || chunk.length % 2) throw Error('Invalid PCM size');
    if (!chunk.length) return;
    pcm.push(chunk);
    await emit({ type: 'audio', format: 'pcm', data });
  };
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > 12 * 1024 * 1024) throw Error('Voice response too large');
      pending += decoder.decode(value, { stream: true });
      let i: number;
      while ((i = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, i).replace(/\r$/, '');
        pending = pending.slice(i + 1);
        await consume(line);
      }
      if (pending.length > 2 * 1024 * 1024) throw Error('Voice frame too large');
    }
    pending += decoder.decode();
    if (pending.trim()) await consume(pending.trim());
    signal.throwIfAborted();
    if (!completed || !audioBytes) throw Error('Incomplete voice stream');
    return pcmWav(Buffer.concat(pcm));
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
