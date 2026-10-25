import type { VoiceFrame } from '../shared/voice';

const RATE = 24000,
  PREBUFFER = RATE,
  BLOCK = RATE * 0.4;
/** Aggregate tiny deltas; schedule adjacent buffers on the audio clock, not arrival time. */
export class VoicePlayer {
  private context = new AudioContext();
  private ready = this.context.resume();
  private sources = new Map<AudioBufferSourceNode, () => void>();
  private ended: Promise<void>[] = [];
  private queued: Float32Array[] = [];
  private samples = 0;
  private next = 0;
  private bytes = 0;
  private stopped = false;
  private started = false;
  private format?: VoiceFrame['format'];
  private idleTimer?: ReturnType<typeof setTimeout>;
  constructor(private onStart: () => void) {
    void this.ready.catch(() => {});
  }
  async append(frame: VoiceFrame) {
    await this.ready;
    if (this.stopped) return;
    if (this.format && this.format !== frame.format) throw Error('Audio format changed during streaming.');
    this.format = frame.format;
    const raw = atob(frame.data),
      bytes = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
    this.bytes += bytes.length;
    if (this.bytes > 8 * 1024 * 1024) throw Error('Audio size limit exceeded.');
    if (frame.format === 'wav') {
      const buffer = await this.context.decodeAudioData(bytes.buffer);
      if (!this.stopped) this.schedule(buffer);
      return;
    }
    if (!bytes.length || bytes.length % 2) throw Error('Invalid audio segment.');
    const samples = new Float32Array(bytes.length / 2),
      view = new DataView(bytes.buffer);
    for (let i = 0; i < samples.length; i++) samples[i] = view.getInt16(i * 2, true) / 32768;
    this.queued.push(samples);
    this.samples += samples.length;
    this.flush(false);
    clearTimeout(this.idleTimer);
    // Drain a short final phrase even if provider completion metadata is delayed.
    this.idleTimer = setTimeout(() => this.flush(true), 700);
  }
  private flush(final: boolean) {
    if (this.stopped || !this.samples) return;
    const underrun = !this.next || this.next < this.context.currentTime + 0.025;
    if (!final && this.samples < (underrun ? PREBUFFER : BLOCK)) return;
    const buffer = this.context.createBuffer(1, this.samples, RATE),
      channel = buffer.getChannelData(0);
    let offset = 0;
    for (const chunk of this.queued) {
      channel.set(chunk, offset);
      offset += chunk.length;
    }
    this.queued = [];
    this.samples = 0;
    this.schedule(buffer);
  }
  private schedule(buffer: AudioBuffer) {
    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.context.destination);
    this.ended.push(
      new Promise<void>((resolve) => {
        this.sources.set(source, resolve);
        source.onended = () => {
          this.sources.delete(source);
          source.disconnect();
          resolve();
        };
      }),
    );
    const at = this.next > this.context.currentTime + 0.025 ? this.next : this.context.currentTime + 0.05;
    this.next = at + buffer.duration;
    source.start(at);
    if (!this.started) {
      this.started = true;
      this.onStart();
    }
  }
  async finish() {
    await this.ready;
    clearTimeout(this.idleTimer);
    this.flush(true);
    await Promise.all(this.ended);
  }
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    clearTimeout(this.idleTimer);
    this.queued = [];
    this.samples = 0;
    for (const [source, resolve] of this.sources) {
      try {
        source.stop();
        source.disconnect();
      } catch {
        /* Already ended. */
      }
      resolve();
    }
    this.sources.clear();
    void this.context.close().catch(() => {});
  }
}
