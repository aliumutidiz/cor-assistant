export type Session = {
  asyncChat?: boolean;
  csrf: string;
  demo: boolean;
  owner: string;
  canLogout?: boolean;
  googleConnected: boolean;
  agyEnabled: boolean;
  telegram?: {
    delivery?: { state: string; error?: string; updatedAt: string };
    enabled: boolean;
    voiceEnabled: boolean;
    status: { state: string; message?: string; updatedAt?: string };
  };
  onboardingRequired?: boolean;
  preferences: {
    timeZone: string;
    language: 'en' | 'tr';
    displayName?: string;
    communicationStyle?: 'concise' | 'balanced' | 'detailed';
    onboarded?: boolean;
  };
};
let csrf = '';
export async function sendChat<T>(
  message: string,
  key: string,
  signal: AbortSignal,
  asyncEnabled = false,
): Promise<T> {
  if (!asyncEnabled) return api<T>('/chat', { message }, 'POST', key, signal);
  try {
    await api('/chat/requests', { message }, 'POST', key, signal);
  } catch (error) {
    if (!(error instanceof ApiError) || error.status < 500) throw error;
    // A lost acknowledgement must not submit a second mutation under a new key.
    try {
      await api('/chat/requests/' + key, undefined, 'GET', undefined, signal);
    } catch {
      throw error;
    }
  }
  return waitForChat<T>(key, signal);
}
// Resume only polls the original persisted request; it never re-submits a write.
export async function waitForChat<T>(key: string, signal: AbortSignal): Promise<T> {
  for (let attempt = 0; attempt < 360; attempt++) {
    signal.throwIfAborted();
    const state = await api<{ status: string; result?: T; error?: string }>(
      '/chat/requests/' + key,
      undefined,
      'GET',
      undefined,
      signal,
    );
    if (state.status === 'succeeded') return state.result!;
    if (state.status === 'failed')
      throw new ApiError(state.error ?? 'The conversation could not be completed.', 422);
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        reject(signal.reason ?? new DOMException('Stopped waiting.', 'AbortError'));
      };
      const timer = setTimeout(() => {
        signal.removeEventListener('abort', abort);
        resolve();
      }, 1500);
      signal.addEventListener('abort', abort, { once: true });
      if (signal.aborted) abort();
    });
  }
  throw new ApiError(
    'The reply is still pending. The request is saved; check history before sending again.',
    504,
  );
}
export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public loginRequired = false,
  ) {
    super(message);
  }
}
async function fetchApi(url: string, options: RequestInit) {
  for (let attempt = 0; ; attempt++) {
    let response: Response | undefined;
    try {
      response = await fetch(url, options);
    } catch (error) {
      if (options.signal?.aborted) throw error;
      if (options.method !== 'GET' || attempt > 0)
        throw new ApiError('Connection lost. Check activity before submitting the action again.', 503);
    }
    const retry =
      options.method === 'GET' && attempt === 0 && (!response || [502, 503, 504].includes(response.status));
    if (!retry) return response!;
    await response?.body?.cancel().catch(() => {});
    await new Promise((resolve) => setTimeout(resolve, 250));
    options.signal?.throwIfAborted();
  }
}
export async function api<T>(
  path: string,
  body?: unknown,
  method = 'POST',
  key?: string,
  signal?: AbortSignal,
): Promise<T> {
  const r = await fetchApi('/api' + path, {
    method: body === undefined ? 'GET' : method,
    headers:
      body === undefined
        ? {}
        : {
            'Content-Type': 'application/json',
            'X-Cor-Csrf': csrf,
            ...(key ? { 'Idempotency-Key': key } : {}),
          },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  let data;
  try {
    data = JSON.parse(await r.text());
  } catch {
    throw new ApiError(
      r.ok
        ? 'No valid response was received. Please retry.'
        : 'The server is temporarily unavailable. Retry when the connection is restored.',
      r.status,
    );
  }
  if (!data || typeof data !== 'object')
    throw new ApiError('Could not validate the server response.', r.status);
  if (r.status === 401 && data.loginRequired === true) window.dispatchEvent(new Event('cor:login-required'));
  if (!r.ok)
    throw new ApiError(
      (typeof data.error === 'string' ? data.error : 'The request could not be completed.') +
        (Array.isArray(data.details)
          ? ' ' +
            data.details.map((x: { path: string; message: string }) => `${x.path}: ${x.message}`).join('; ')
          : ''),
      r.status,
      data.loginRequired === true,
    );
  return data;
}
export async function session() {
  const s = await api<Session>('/session');
  if (csrf && csrf !== s.csrf) window.dispatchEvent(new Event('cor:session-changed'));
  csrf = s.csrf;
  return s;
}
export async function apiAudio(text: string, signal?: AbortSignal) {
  const response = await fetchApi('/api/speak', {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json', 'X-Cor-Csrf': csrf },
    body: JSON.stringify({ text }),
  });
  if (!response.ok) {
    let message = 'Could not prepare spoken reply.';
    try {
      const error = await response.json();
      if (typeof error.error === 'string') message = error.error;
      if (response.status === 401 && error.loginRequired === true)
        window.dispatchEvent(new Event('cor:login-required'));
    } catch {
      /* Proxy responses may not be JSON. */
    }
    throw new ApiError(message, response.status);
  }
  if (!response.headers.get('content-type')?.startsWith('audio/wav'))
    throw new ApiError('No valid audio response received.', 502);
  return response.blob();
}

export async function apiAudioStream(
  text: string,
  signal: AbortSignal,
  onAudio: (frame: import('../shared/voice').VoiceFrame) => Promise<void> | void,
) {
  const response = await fetch('/api/speak/stream', {
    method: 'POST',
    credentials: 'same-origin',
    signal,
    headers: { 'Content-Type': 'application/json', 'X-Cor-Csrf': csrf },
    body: JSON.stringify({ text }),
  });
  if (!response.ok) {
    let message = 'Could not prepare spoken reply.';
    try {
      const error = await response.json();
      if (typeof error.error === 'string') message = error.error;
      if (response.status === 401 && error.loginRequired)
        window.dispatchEvent(new Event('cor:login-required'));
    } catch {
      /* Do not expose proxy error pages. */
    }
    throw new ApiError(message, response.status);
  }
  if (!response.body || !response.headers.get('content-type')?.includes('application/x-ndjson'))
    throw new ApiError('No valid audio stream received.', 502);
  const reader = response.body.getReader(),
    decoder = new TextDecoder();
  let pending = '',
    bytes = 0,
    done = false,
    heard = false;
  const consume = async (line: string) => {
    if (!line.trim()) return;
    const frame = JSON.parse(line);
    if (frame.type === 'error')
      throw new ApiError(
        typeof frame.message === 'string' ? frame.message : 'Speech generation interrupted.',
        frame.status ?? 503,
      );
    if (frame.type === 'done') {
      done = true;
      return;
    }
    if (frame.type === 'audio') {
      if (
        done ||
        !['pcm', 'wav'].includes(frame.format) ||
        typeof frame.data !== 'string' ||
        !/^[A-Za-z0-9+/]*={0,2}$/.test(frame.data)
      )
        throw new ApiError('Invalid audio segment.', 502);
      heard = true;
      await onAudio(frame);
    }
  };
  try {
    while (true) {
      signal.throwIfAborted();
      const chunk = await reader.read();
      if (chunk.done) break;
      bytes += chunk.value.byteLength;
      if (bytes > 12 * 1024 * 1024) throw new ApiError('Audio size limit exceeded.', 502);
      pending += decoder.decode(chunk.value, { stream: true });
      let i: number;
      while ((i = pending.indexOf('\n')) >= 0) {
        const line = pending.slice(0, i);
        pending = pending.slice(i + 1);
        await consume(line);
      }
    }
    pending += decoder.decode();
    if (pending.trim()) await consume(pending);
    if (!done || !heard) throw new ApiError('Audio stream ended prematurely.', 502);
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
export function dateKey(date: Date, timeZone: string) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}
export function dateTimeInput(date: Date, timeZone: string) {
  const p = new Intl.DateTimeFormat('sv-SE', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).format(date);
  return p.replace(' ', 'T');
}
export function zonedISO(local: string, timeZone: string) {
  const parsed = Date.parse(local + 'Z');
  let guess = parsed;
  for (let i = 0; i < 3; i++) {
    const shown = Date.parse(dateTimeInput(new Date(guess), timeZone) + 'Z');
    guess += parsed - shown;
  }
  if (dateTimeInput(new Date(guess), timeZone) !== local.slice(0, 16))
    throw new Error('This local time does not exist in the selected time zone.');
  const earlier = guess - 3600000,
    later = guess + 3600000;
  if (
    dateTimeInput(new Date(earlier), timeZone) === local.slice(0, 16) ||
    dateTimeInput(new Date(later), timeZone) === local.slice(0, 16)
  )
    throw new Error('This local time occurs twice. Choose an unambiguous time.');
  return new Date(guess).toISOString();
}
export const formatDate = (value: string, zone = 'Europe/Istanbul') =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: zone,
    day: 'numeric',
    month: 'long',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(value));
