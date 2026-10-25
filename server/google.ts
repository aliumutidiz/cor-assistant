import { createHash, randomBytes } from 'node:crypto';
import { jwtVerify, createRemoteJWKSet } from 'jose';
import { z } from 'zod';
import type { Config } from './config.js';
import type { Store } from './repositories.js';
import { seal, unseal } from './crypto.js';
import { AppError } from './errors.js';
import type { Action, Calendar, CalendarEvent } from '../shared/contracts.js';
const part = encodeURIComponent;
type Tokens = { access_token: string; refresh_token?: string; expires_at: number };
const googleKeys = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'));
export interface CalendarGateway {
  calendars(): Promise<Calendar[]>;
  events(calendarId: string, from: string, to: string): Promise<CalendarEvent[]>;
  sharing(calendarId: string): Promise<unknown>;
  freebusy(calendarId: string, from: string, to: string): Promise<unknown>;
  inspect(
    kind: 'event' | 'calendar' | 'instances' | 'settings' | 'colors',
    calendarId: string,
    eventId?: string,
  ): Promise<unknown>;
  execute(action: Action, operationId: string): Promise<unknown>;
  sync(calendarId: string): Promise<void>;
  connected(): Promise<boolean>;
}
export class GoogleCalendar implements CalendarGateway {
  private refreshing?: Promise<Tokens>;
  constructor(
    private store: Store,
    private config: Config,
  ) {}
  async connected() {
    return Boolean(await this.store.get('google.tokens'));
  }
  async authorization(sessionId: string) {
    if (!this.config.GOOGLE_CLIENT_ID || !this.config.GOOGLE_CLIENT_SECRET)
      throw new AppError(503, 'Google OAuth henüz yapılandırılmadı.');
    const state = randomBytes(32).toString('base64url'),
      verifier = randomBytes(48).toString('base64url');
    await this.store.putTransient(
      'oauth:' + state,
      { sessionId, verifier },
      new Date(Date.now() + 600000).toISOString(),
    );
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.search = new URLSearchParams({
      client_id: this.config.GOOGLE_CLIENT_ID,
      redirect_uri: this.config.GOOGLE_REDIRECT_URI,
      response_type: 'code',
      scope: 'openid email https://www.googleapis.com/auth/calendar',
      access_type: 'offline',
      prompt: 'consent',
      state,
      code_challenge: createHash('sha256').update(verifier).digest('base64url'),
      code_challenge_method: 'S256',
    }).toString();
    return url.toString();
  }
  async callback(state: string, code: string, sessionId: string) {
    const record = await this.store.takeTransient<{ sessionId: string; verifier: string }>('oauth:' + state);
    if (!record || record.sessionId !== sessionId)
      throw new AppError(400, 'OAuth doğrulaması başarısız. Yeniden bağlanın.');
    const raw = await this.exchange({
      code,
      code_verifier: record.verifier,
      grant_type: 'authorization_code',
      redirect_uri: this.config.GOOGLE_REDIRECT_URI,
    });
    if (typeof raw.id_token !== 'string') throw new AppError(401, 'Google kimliği doğrulanamadı.');
    const { payload } = await jwtVerify(raw.id_token, googleKeys, {
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      audience: this.config.GOOGLE_CLIENT_ID,
    });
    if (
      payload.email_verified !== true ||
      String(payload.email).toLowerCase() !== this.config.OWNER_EMAIL.toLowerCase()
    )
      throw new AppError(403, 'Yalnızca uygulama sahibi bağlanabilir.');
    if (typeof raw.refresh_token !== 'string')
      throw new AppError(400, 'Çevrimdışı izin alınamadı. Google bağlantısını yeniden yetkilendirin.');
    await this.save({
      access_token: String(raw.access_token),
      refresh_token: raw.refresh_token,
      expires_at: Date.now() + Number(raw.expires_in) * 1000,
    });
  }
  private async exchange(params: Record<string, string>) {
    const r = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      signal: AbortSignal.timeout(20000),
      body: new URLSearchParams({
        ...params,
        client_id: this.config.GOOGLE_CLIENT_ID,
        client_secret: this.config.GOOGLE_CLIENT_SECRET,
      }),
    });
    if (!r.ok) throw new AppError(401, 'Google oturumu yenilenemedi. Yeniden bağlanın.');
    return z
      .object({
        access_token: z.string().min(1),
        expires_in: z.coerce.number().positive().max(86400),
        refresh_token: z.string().min(1).optional(),
        id_token: z.string().min(1).optional(),
      })
      .parse(await r.json());
  }
  private async save(t: Tokens) {
    await this.store.set('google.tokens', seal(t, this.config.ENCRYPTION_KEY));
  }
  private async token() {
    const encrypted = await this.store.get<string>('google.tokens');
    if (!encrypted) throw new AppError(409, 'Önce Google Takvim hesabınızı bağlayın.');
    const t = unseal<Tokens>(encrypted, this.config.ENCRYPTION_KEY);
    if (t.expires_at > Date.now() + 60000) return t.access_token;
    this.refreshing ??= (async () => {
      if (!t.refresh_token) throw new AppError(401, 'Google hesabını yeniden bağlayın.');
      const raw = await this.exchange({ grant_type: 'refresh_token', refresh_token: t.refresh_token });
      const next = {
        access_token: String(raw.access_token),
        refresh_token: t.refresh_token,
        expires_at: Date.now() + Number(raw.expires_in) * 1000,
      };
      await this.save(next);
      return next;
    })();
    try {
      return (await this.refreshing).access_token;
    } finally {
      this.refreshing = undefined;
    }
  }
  async request<T>(path: string, method = 'GET', body?: unknown, etag?: string): Promise<T> {
    const token = await this.token();
    let r: Response;
    try {
      r = await fetch('https://www.googleapis.com/calendar/v3/' + path, {
        method,
        headers: {
          Authorization: 'Bearer ' + token,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
          ...(etag ? { 'If-Match': etag } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(25000),
      });
    } catch {
      throw new AppError(
        502,
        method === 'GET'
          ? 'Google bağlantısı kurulamadı.'
          : 'Google işleminin sonucu belirsiz. Takvimi kontrol edin.',
        method !== 'GET',
      );
    }
    if (!r.ok) {
      if (r.status === 401) throw new AppError(401, 'Google oturumu geçersiz. Yeniden bağlanın.');
      if (r.status === 412) throw new AppError(409, 'Takvim kaydı değişmiş. Yenileyip yeniden deneyin.');
      if (r.status === 410) throw new AppError(410, 'Senkronizasyon belirteci geçersiz.');
      throw new AppError(
        r.status === 429 ? 429 : r.status === 403 ? 403 : 502,
        'Google işlemi reddetti (' + r.status + ').',
        method !== 'GET' && r.status >= 500,
      );
    }
    if (r.status === 204) return {} as T;
    return (await r.json()) as T;
  }
  private async pages<T>(path: string) {
    const all: T[] = [];
    let page: string | undefined;
    do {
      const data = await this.request<{ items?: T[]; nextPageToken?: string }>(
        path + (page ? '&pageToken=' + part(page) : ''),
      );
      all.push(...(data.items ?? []));
      page = data.nextPageToken;
      if (all.length > 50000) throw new AppError(413, 'Sonuç çok büyük.');
    } while (page);
    return all;
  }
  async calendars() {
    return this.pages<Calendar>('users/me/calendarList?maxResults=250');
  }
  async events(calendarId: string, from: string, to: string) {
    const items = await this.pages<CalendarEvent>(
      'calendars/' +
        part(calendarId) +
        '/events?' +
        new URLSearchParams({
          timeMin: from,
          timeMax: to,
          singleEvents: 'true',
          orderBy: 'startTime',
          maxResults: '2500',
        }),
    );
    return items.map((e) => ({ ...e, calendarId }));
  }
  async sharing(calendarId: string) {
    return this.pages('calendars/' + part(calendarId) + '/acl?maxResults=250');
  }
  async inspect(
    kind: 'event' | 'calendar' | 'instances' | 'settings' | 'colors',
    calendarId: string,
    eventId?: string,
  ) {
    const base = 'calendars/' + part(calendarId);
    if (kind === 'calendar') return this.request(base);
    if (kind === 'settings') return this.pages('users/me/settings?maxResults=250');
    if (kind === 'colors') return this.request('colors');
    if (!eventId) throw new AppError(400, 'Etkinlik kimliği gerekli.');
    if (kind === 'instances')
      return this.pages(
        base +
          '/events/' +
          part(eventId) +
          '/instances?maxResults=2500&timeMin=' +
          part(new Date().toISOString()) +
          '&timeMax=' +
          part(new Date(Date.now() + 93 * 86400000).toISOString()),
      );
    return { ...(await this.request<CalendarEvent>(base + '/events/' + part(eventId))), calendarId };
  }
  async freebusy(calendarId: string, from: string, to: string) {
    return this.request('freeBusy', 'POST', { timeMin: from, timeMax: to, items: [{ id: calendarId }] });
  }
  async sync(calendarId: string): Promise<void> {
    const cache = await this.store.cache(calendarId);
    const merged = new Map((cache?.events ?? []).map((e) => [e.id, e]));
    let page: string | undefined, token: string | undefined;
    try {
      do {
        const query = new URLSearchParams({ maxResults: '2500', showDeleted: 'true' });
        if (cache?.token) query.set('syncToken', cache.token);
        if (page) query.set('pageToken', page);
        const data = await this.request<{
          items?: CalendarEvent[];
          nextPageToken?: string;
          nextSyncToken?: string;
        }>('calendars/' + part(calendarId) + '/events?' + query);
        for (const e of data.items ?? []) {
          if (e.status === 'cancelled') merged.delete(e.id);
          else merged.set(e.id, { ...e, calendarId });
        }
        page = data.nextPageToken;
        token = data.nextSyncToken;
      } while (page);
    } catch (e) {
      if (e instanceof AppError && e.status === 410 && cache?.token) {
        await this.store.saveCache(calendarId, '', []);
        return this.sync(calendarId);
      }
      throw e;
    }
    if (!token) throw new AppError(502, 'Google senkronizasyonu tamamlanmadı.');
    await this.store.saveCache(calendarId, token, [...merged.values()]);
  }
  async execute(a: Action, operationId: string): Promise<unknown> {
    if (a.kind.startsWith('event.') && 'calendarId' in a) {
      const x = a as Extract<Action, { eventId?: string }>;
      const base = 'calendars/' + part(x.calendarId) + '/events';
      let target = x.eventId;
      if (x.scope === 'following') return this.following(x, operationId);
      if (x.scope === 'series' && target) {
        const item = await this.request<CalendarEvent>(base + '/' + part(target));
        if (item.recurringEventId) target = item.recurringEventId;
      }
      const url = base + (target ? '/' + part(target) : '');
      const query =
        '?sendUpdates=' + (x.notify ? 'all' : 'none') + (x.conference ? '&conferenceDataVersion=1' : '');
      if (x.kind === 'event.create') {
        const stableId = operationId.replaceAll('-', '');
        try {
          return await this.request(base + query, 'POST', {
            ...x.event,
            id: stableId,
            ...(x.conference ? { conferenceData: { createRequest: { requestId: operationId } } } : {}),
          });
        } catch (e) {
          throw e;
        }
      }
      if (!target) throw new AppError(400, 'Etkinlik kimliği gerekli.');
      const current = await this.request<CalendarEvent>(url);
      if (!x.etag || current.etag !== x.etag) throw new AppError(409, 'Etkinliğin güncel sürümünü seçin.');
      if (x.kind === 'event.update') return this.request(url + query, 'PATCH', x.event, x.etag);
      if (x.kind === 'event.delete') return this.request(url + query, 'DELETE', undefined, x.etag);
      if (x.kind === 'event.move')
        return this.request(
          url + '/move' + query + '&destination=' + part(x.destination!),
          'POST',
          {},
          x.etag,
        );
      if (x.kind === 'event.respond') {
        const me = this.config.OWNER_EMAIL.toLowerCase();
        const attendees = current.attendees?.map((p) =>
          p.email.toLowerCase() === me ? { ...p, responseStatus: x.response } : p,
        );
        if (!attendees?.some((p) => p.email.toLowerCase() === me))
          throw new AppError(400, 'Bu etkinlikte davetli değilsiniz.');
        return this.request(url + query, 'PATCH', { attendees }, x.etag);
      }
    }
    if (a.kind.startsWith('calendar.')) {
      const x = a as Extract<Action, { summary?: string }>;
      const path = 'calendars/' + part(x.calendarId ?? '');
      const body = { summary: x.summary, description: x.description, timeZone: x.timeZone };
      switch (x.kind) {
        case 'calendar.create':
          return this.request('calendars', 'POST', body);
        case 'calendar.update':
          return this.request(path, 'PATCH', body, x.etag);
        case 'calendar.delete':
          return this.request(path, 'DELETE', undefined, x.etag);
        case 'calendar.clear':
          return this.request(path + '/clear', 'POST', {});
        case 'calendar.subscribe':
          return this.request('users/me/calendarList', 'POST', { id: x.calendarId });
        case 'calendar.unsubscribe':
          return this.request('users/me/calendarList/' + part(x.calendarId!), 'DELETE');
      }
    }
    if (a.kind === 'sharing.set') {
      const scope = {
        type: a.scopeType,
        ...(a.scopeType === 'domain'
          ? { value: a.domain }
          : a.scopeType === 'default'
            ? {}
            : { value: a.email }),
      };
      const base = 'calendars/' + part(a.calendarId) + '/acl';
      return this.request(
        base + (a.ruleId ? '/' + part(a.ruleId) : '') + '?sendNotifications=true',
        a.ruleId ? 'PUT' : 'POST',
        { scope, role: a.role },
        a.etag,
      );
    }
    if (a.kind === 'sharing.delete')
      return this.request(
        'calendars/' + part(a.calendarId) + '/acl/' + part(a.ruleId!),
        'DELETE',
        undefined,
        a.etag,
      );
    throw new AppError(400, 'Desteklenmeyen takvim işlemi.');
  }
  private async following(a: Extract<Action, { eventId?: string }>, operationId: string) {
    if (!a.eventId || !a.instanceStart || !a.etag)
      throw new AppError(400, 'Seri, örnek başlangıcı ve sürüm gerekli.');
    const base = 'calendars/' + part(a.calendarId) + '/events';
    const master = await this.request<CalendarEvent>(base + '/' + part(a.eventId));
    if (master.recurringEventId || master.etag !== a.etag || !master.recurrence?.length)
      throw new AppError(409, 'Güncel ana seriyi seçin.');
    if (!['event.update', 'event.delete'].includes(a.kind))
      throw new AppError(400, 'Bu işlem seriyi bölemez.');
    if (master.start.date)
      throw new AppError(
        400,
        'Tüm gün serilerinde bu tarihten sonrası yerine tek örnek veya tüm seriyi kullanın.',
      );
    if (
      master.recurrence.length !== 1 ||
      !master.recurrence[0].startsWith('RRULE:') ||
      /COUNT=/.test(master.recurrence[0])
    )
      throw new AppError(400, 'Bu karmaşık seri otomatik bölünemiyor. Google Takvim üzerinden düzenleyin.');
    const at = Date.parse(a.instanceStart);
    if (at <= Date.parse(master.start.dateTime!)) throw new AppError(400, 'İlk örnek için tüm seri seçin.');
    const instances = await this.request<{ items: CalendarEvent[] }>(
      base +
        '/' +
        part(a.eventId) +
        '/instances?' +
        new URLSearchParams({
          timeMin: new Date(at).toISOString(),
          timeMax: new Date(at + 1000).toISOString(),
          maxResults: '10',
        }),
    );
    if (
      !instances.items.some((i) => Date.parse(i.originalStartTime?.dateTime ?? i.start.dateTime ?? '') === at)
    )
      throw new AppError(400, 'Seri örneği doğrulanamadı.');
    const until = new Date(at - 1000).toISOString().replace(/[-:]/g, '').replace('.000', '');
    const rule = master.recurrence[0].replace(/;UNTIL=[^;]+/, '') + ';UNTIL=' + until;
    await this.request(
      base + '/' + part(master.id) + '?sendUpdates=' + (a.notify ? 'all' : 'none'),
      'PATCH',
      { recurrence: [rule] },
      a.etag,
    );
    if (a.kind === 'event.delete') return { trimmed: true };
    try {
      return await this.request(base + '?sendUpdates=' + (a.notify ? 'all' : 'none'), 'POST', {
        description: master.description,
        location: master.location,
        recurrence: master.recurrence,
        attendees: master.attendees?.map(({ email, responseStatus }) => ({ email, responseStatus })),
        reminders: master.reminders,
        visibility: master.visibility,
        transparency: master.transparency,
        ...a.event,
        id: operationId.replaceAll('-', ''),
      });
    } catch {
      throw new AppError(
        502,
        'Eski seri kısaltıldı; yeni seri oluşturulamadı veya sonucu belirsiz. Google Takvim üzerinde kontrol edin.',
        true,
      );
    }
  }
}

export class DemoCalendar implements CalendarGateway {
  private items = new Map<string, CalendarEvent>();
  private lists: Calendar[] = [
    {
      id: 'primary',
      summary: 'Personal calendar',
      primary: true,
      timeZone: 'Europe/Istanbul',
      accessRole: 'owner',
    },
  ];
  async connected() {
    return false;
  }
  async calendars() {
    return structuredClone(this.lists);
  }
  async events(calendarId: string, from: string, to: string) {
    return structuredClone(
      [...this.items.values()].filter(
        (e) =>
          e.calendarId === calendarId &&
          Date.parse(e.start.dateTime ?? e.start.date!) < Date.parse(to) &&
          Date.parse(e.end.dateTime ?? e.end.date!) > Date.parse(from),
      ),
    );
  }
  async sharing() {
    return [];
  }
  async freebusy(calendarId: string, from: string, to: string) {
    return {
      calendars: {
        [calendarId]: {
          busy: (await this.events(calendarId, from, to)).map((e) => ({ start: e.start, end: e.end })),
        },
      },
    };
  }
  async sync() {}
  async inspect(
    kind: 'event' | 'calendar' | 'instances' | 'settings' | 'colors',
    calendarId: string,
    eventId?: string,
  ) {
    if (kind === 'calendar') return this.lists.find((c) => c.id === calendarId);
    if (kind === 'event') return this.items.get(eventId!);
    return [];
  }
  async execute(a: Action, operationId: string) {
    if (a.kind === 'event.create') {
      const e = { ...a.event!, id: operationId, calendarId: a.calendarId, etag: '"1"' };
      this.items.set(e.id, e);
      return e;
    }
    if (
      a.kind === 'event.update' ||
      a.kind === 'event.delete' ||
      a.kind === 'event.respond' ||
      a.kind === 'event.move'
    ) {
      const e = this.items.get(a.eventId!);
      if (!e) throw new AppError(404, 'Etkinlik bulunamadı.');
      if (e.etag !== a.etag) throw new AppError(409, 'Etkinlik sürümü değişti.');
      if (a.kind === 'event.delete') {
        this.items.delete(e.id);
        return { deleted: true };
      }
      const next = {
        ...e,
        ...a.event,
        etag: '"' + (Number(e.etag?.replaceAll('"', '')) + 1) + '"',
        calendarId: a.kind === 'event.move' ? a.destination! : e.calendarId,
      };
      this.items.set(e.id, next);
      return next;
    }
    if (a.kind === 'calendar.create') {
      const c = { id: operationId, summary: a.summary! };
      this.lists.push(c);
      return c;
    }
    throw new AppError(400, 'Bu gelişmiş işlem yalnızca bağlı Google hesabında kullanılabilir.');
  }
}
