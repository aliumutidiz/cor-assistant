import { useEffect, useId, useRef, useState } from 'react';
import { Microphone, Stop, SpeakerHigh } from '@phosphor-icons/react';
import { api, apiAudioStream } from './api';
import { VoicePlayer } from './voice-player';
import { voiceCache } from './voice-cache';
import type { VoiceFrame } from '../shared/voice';
import type { VoiceStatus, VoiceSettings } from '../shared/voice';

let playing: VoicePlayer | undefined, controller: AbortController | undefined;
let speakerId: string | undefined;
export function stopVoice() {
  controller?.abort();
  controller = undefined;
  playing?.stop();
  playing = undefined;
  speakerId = undefined;
  window.dispatchEvent(new CustomEvent('cor:voice-playback', { detail: { active: false } }));
}
export function stopAllVoice() {
  stopVoice();
  window.dispatchEvent(new Event('cor:stop-recording'));
}

export function VoiceButton({
  text,
  voice = 'Charon',
  label = 'Listen',
}: {
  text: string;
  voice?: string;
  label?: string;
}) {
  const id = useId();
  const [state, setState] = useState<'idle' | 'loading' | 'playing'>('idle'),
    [error, setError] = useState('');
  useEffect(() => {
    const listener = (event: Event) => {
      const detail = (event as CustomEvent).detail;
      if (!detail.active || detail.id !== id) setState('idle');
    };
    window.addEventListener('cor:voice-playback', listener);
    return () => {
      window.removeEventListener('cor:voice-playback', listener);
      if (speakerId === id) stopVoice();
    };
  }, [id]);
  return (
    <div className="voice-inline">
      <button
        type="button"
        className="text-button"
        aria-label={state === 'idle' ? label : 'Stop audio'}
        onClick={async () => {
          if (speakerId === id) {
            stopVoice();
            return;
          }
          stopVoice();
          speakerId = id;
          setState('loading');
          setError('');
          const cancel = new AbortController();
          controller = cancel;
          window.dispatchEvent(new CustomEvent('cor:voice-playback', { detail: { active: true, id } }));
          try {
            const spoken = text.length > 1150 ? text.slice(0, 1050) + '\nContinue reading on screen.' : text;
            const player = new VoicePlayer(() => {
              if (!cancel.signal.aborted) setState('playing');
            });
            playing = player;
            const key = JSON.stringify([voice, spoken]);
            const cached = voiceCache.get(key);
            if (cached) {
              for (const frame of cached) await player.append(frame);
            } else {
              const frames: VoiceFrame[] = [];
              await apiAudioStream(spoken, cancel.signal, async (frame) => {
                await player.append(frame);
                frames.push(frame);
              });
              if (!cancel.signal.aborted) voiceCache.put(key, frames);
            }
            await player.finish();
            if (speakerId === id) stopVoice();
          } catch (e) {
            if (!cancel.signal.aborted) setError((e as Error).message);
            if (speakerId === id) stopVoice();
          }
        }}
      >
        {state === 'idle' ? <SpeakerHigh size={15} /> : <Stop size={15} />}{' '}
        {state === 'loading' ? 'Preparing audio…' : state === 'playing' ? 'Durdur' : label}
      </button>
      {error && <small role="alert">{error}</small>}
    </div>
  );
}

export function VoiceSettingsPanel({ onChange }: { onChange: (status: VoiceStatus) => void }) {
  const [status, setStatus] = useState<VoiceStatus>(),
    [key, setKey] = useState(''),
    [error, setError] = useState(''),
    [note, setNote] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    api<VoiceStatus>('/voice/status')
      .then(setStatus)
      .catch((e) => setError(e.message));
  }, []);
  if (!status)
    return (
      <article className="setting-row">
        <div>
          <h3>Spoken reply</h3>
          <p>{error || 'Loading voice settings…'}</p>
        </div>
      </article>
    );
  return (
    <article className="setting-row voice-settings">
      <div>
        <h3>Natural voice</h3>
        <p>
          Speech is generated only when you press Listen. The transcript is sent to Google; replay uses a
          cached recording.
        </p>
        <form
          className="memory-form"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            setError('');
            try {
              const settings: VoiceSettings = {
                enabled: status.enabled,
                freeTierConfirmed: status.freeTierConfirmed,
                voice: status.voice,
                dailyLimit: status.dailyLimit,
              };
              const next = await api<VoiceStatus>('/voice/settings', {
                settings,
                ...(key ? { apiKey: key } : {}),
              });
              setStatus(next);
              onChange(next);
              window.dispatchEvent(new Event('cor:voice-settings-changed'));
              setKey('');
              setNote('Voice settings saved.');
            } catch (e) {
              setError((e as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          <label className="memory-check">
            <input
              type="checkbox"
              checked={status.enabled}
              onChange={(e) => setStatus({ ...status, enabled: e.target.checked })}
            />
            Enable read aloud
          </label>
          <label>
            Voice
            <select
              value={status.voice}
              onChange={(e) => setStatus({ ...status, voice: e.target.value as VoiceStatus['voice'] })}
            >
              <option value="Sulafat">Sulafat · warm</option>
              <option value="Kore">Kore · clear</option>
              <option value="Charon">Charon · resonant male</option>
              <option value="Aoede">Aoede · relaxed</option>
              <option value="Puck">Puck · lively</option>
            </select>
          </label>
          <label>
            Google AI Studio key
            <input
              type="password"
              autoComplete="off"
              placeholder={
                status.configured ? 'Key saved; enter a value to replace it' : 'Stored only on the server'
              }
              value={key}
              onChange={(e) => setKey(e.target.value)}
              maxLength={300}
            />
          </label>
          <label>
            Daily voice request limit
            <input
              type="number"
              min={1}
              max={200}
              value={status.dailyLimit}
              onChange={(e) => setStatus({ ...status, dailyLimit: Number(e.target.value) })}
            />
          </label>
          <label className="memory-check">
            <input
              type="checkbox"
              checked={status.freeTierConfirmed}
              onChange={(e) => setStatus({ ...status, freeTierConfirmed: e.target.checked })}
            />
            My Google project uses the free tier with billing disabled.
          </label>
          <small>
            Google's actual quota depends on your model and account. Requests used today: {status.used}. Quota
            errors never switch to a paid model.
          </small>
          <div className="memory-actions">
            <button className="button subtle" type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save voice settings'}
            </button>
            {status.configured && status.enabled && (
              <VoiceButton
                label="Preview voice"
                voice={status.voice}
                text="Hello. What would you like to plan or remember?"
              />
            )}
          </div>
        </form>
        {error && (
          <p role="alert" className="error-banner">
            {error}
          </p>
        )}
        {note && <p role="status">{note}</p>}
      </div>
    </article>
  );
}

// Tune these based on actual microphone noise; audio bars use measured RMS.
const SILENCE_MS = 900,
  SPEECH_THRESHOLD = 0.025,
  MAX_RECORDING_MS = 120000;
export function VoiceInput({
  compact = false,
  disabled,
  onTranscript,
}: {
  compact?: boolean;
  disabled: boolean;
  onTranscript: (text: string) => void;
}) {
  const [state, setState] = useState<'idle' | 'recording' | 'decoding'>('idle'),
    [level, setLevel] = useState(0),
    [note, setNote] = useState('');
  const cleanup = useRef<() => void>(() => {}),
    finish = useRef<(discard?: boolean) => void>(() => {});
  const request = useRef<AbortController | undefined>(undefined);
  const starting = useRef(false),
    generation = useRef(0);
  useEffect(() => {
    const stopRecording = () => {
      generation.current++;
      finish.current(true);
      cleanup.current();
      request.current?.abort();
    };
    const listener = (event: Event) => {
      if ((event as CustomEvent).detail.active) stopRecording();
    };
    window.addEventListener('cor:voice-playback', listener);
    window.addEventListener('cor:stop-recording', stopRecording);
    return () => {
      window.removeEventListener('cor:stop-recording', stopRecording);
      generation.current++;
      window.removeEventListener('cor:voice-playback', listener);
      finish.current(true);
      cleanup.current();
      request.current?.abort();
    };
  }, []);
  const start = async () => {
    if (state === 'recording') {
      finish.current();
      return;
    }
    if (state === 'decoding') {
      request.current?.abort();
      return;
    }
    if (starting.current) return;
    stopVoice();
    setNote('');
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      setNote('This browser cannot record audio. You can use Telegram voice messages.');
      return;
    }
    starting.current = true;
    const current = ++generation.current;
    let acquired: MediaStream | undefined, opened: AudioContext | undefined;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      acquired = stream;
      if (current !== generation.current) {
        stream.getTracks().forEach((track) => track.stop());
        return;
      }
      const context = new AudioContext(),
        analyser = context.createAnalyser();
      analyser.fftSize = 256;
      opened = context;
      context.createMediaStreamSource(stream).connect(analyser);
      const mime = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/mp4'].find((m) =>
        MediaRecorder.isTypeSupported(m),
      );
      const recorder = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined);
      const chunks: Blob[] = [];
      let bytes = 0,
        discard = false,
        done = false,
        heard = false,
        lastSpeech = Date.now();
      const began = Date.now();
      const samples = new Uint8Array(analyser.fftSize);
      const release = () => {
        clearInterval(timer);
        stream.getTracks().forEach((track) => track.stop());
        if (context.state !== 'closed') void context.close().catch(() => {});
        setLevel(0);
      };
      cleanup.current = release;
      finish.current = (drop = false) => {
        if (done) return;
        done = true;
        discard = drop;
        release();
        if (recorder.state !== 'inactive') recorder.stop();
      };
      recorder.ondataavailable = (e) => {
        if (e.data.size) {
          bytes += e.data.size;
          chunks.push(e.data);
          if (bytes > 8 * 1024 * 1024) {
            setNote('Recording exceeded the 8 MB limit.');
            finish.current(true);
          }
        }
      };
      recorder.onstop = async () => {
        if (discard) {
          setState('idle');
          return;
        }
        setState('decoding');
        const cancel = new AbortController();
        request.current = cancel;
        try {
          const blob = new Blob(chunks, { type: recorder.mimeType });
          const audio = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result).split(',')[1]);
            reader.onerror = () => reject(Error('Could not read the recording.'));
            reader.readAsDataURL(blob);
          });
          const result = await api<{ text: string }>('/listen', { audio }, 'POST', undefined, cancel.signal);
          if (current === generation.current) {
            onTranscript(result.text);
            setNote('Review the transcript; it runs when you select Send.');
          }
        } catch (e) {
          if (!cancel.signal.aborted) setNote((e as Error).message);
        } finally {
          setState('idle');
        }
      };
      recorder.onerror = () => {
        setNote('Could not finish microphone recording.');
        finish.current(true);
      };
      const timer = setInterval(() => {
        analyser.getByteTimeDomainData(samples);
        const rms = Math.sqrt(
          samples.reduce((sum, value) => sum + ((value - 128) / 128) ** 2, 0) / samples.length,
        );
        setLevel(Math.min(1, rms * 8));
        const now = Date.now();
        if (rms > SPEECH_THRESHOLD) {
          heard = true;
          lastSpeech = now;
        }
        if ((heard && now - lastSpeech > SILENCE_MS) || now - began >= MAX_RECORDING_MS) finish.current();
        else if (!heard && now - began > 15000) {
          setNote('No speech detected. Check your microphone and retry.');
          finish.current(true);
        }
      }, 60);
      recorder.start(250);
      setState('recording');
    } catch {
      acquired?.getTracks().forEach((track) => track.stop());
      if (opened && opened.state !== 'closed') void opened.close().catch(() => {});
      cleanup.current();
      setNote('Microphone unavailable. Check your browser permissions.');
      setState('idle');
    } finally {
      starting.current = false;
    }
  };
  return (
    <div className="voice-input">
      <button
        type="button"
        className="text-button"
        disabled={disabled}
        onClick={() => void start()}
        aria-label={state === 'idle' ? 'Record voice message' : 'Stop recording'}
      >
        {state === 'idle' ? <Microphone size={16} /> : <Stop size={16} />}{' '}
        <span className={compact && state === 'idle' ? 'sr-only' : undefined}>
          {state === 'recording' ? 'Listening…' : state === 'decoding' ? 'Transcribing…' : 'Dictate'}
        </span>
      </button>
      {state === 'recording' && <meter min={0} max={1} value={level} aria-label="Microphone level" />}
      {note && <small role="status">{note}</small>}
    </div>
  );
}
