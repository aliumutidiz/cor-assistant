import type { VoiceFrame } from '../shared/voice';

/** Private, RAM-only, completed clips. Never persists speech to browser storage. */
export class VoiceCache {
  private clips = new Map<
    string,
    { frames: VoiceFrame[]; bytes: number; expires: number; timer: ReturnType<typeof setTimeout> }
  >();
  constructor(
    private ttl = 10 * 60000,
    private maxBytes = 24 * 1024 * 1024,
  ) {}
  get(key: string) {
    const clip = this.clips.get(key);
    if (!clip) return;
    if (clip.expires <= Date.now()) {
      this.remove(key);
      return;
    }
    this.clips.delete(key);
    this.clips.set(key, clip);
    return clip.frames;
  }
  put(key: string, frames: VoiceFrame[]) {
    this.remove(key);
    const bytes = frames.reduce((sum, frame) => sum + frame.data.length * 2, 0);
    if (!frames.length || bytes > this.maxBytes) return;
    this.clips.set(key, {
      frames: frames.map((frame) => ({ ...frame })),
      bytes,
      expires: Date.now() + this.ttl,
      timer: setTimeout(() => this.remove(key), this.ttl),
    });
    while (
      this.clips.size > 8 ||
      [...this.clips.values()].reduce((sum, clip) => sum + clip.bytes, 0) > this.maxBytes
    )
      this.remove(this.clips.keys().next().value!);
  }
  private remove(key: string) {
    const clip = this.clips.get(key);
    if (clip) clearTimeout(clip.timer);
    this.clips.delete(key);
  }
  clear() {
    for (const key of this.clips.keys()) this.remove(key);
  }
}
export const voiceCache = new VoiceCache();
if (typeof window !== 'undefined') {
  for (const name of ['cor:login-required', 'cor:session-changed', 'cor:voice-settings-changed'])
    window.addEventListener(name, () => voiceCache.clear());
}
