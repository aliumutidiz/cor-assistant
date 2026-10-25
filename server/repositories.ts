import {
  initialConversationState,
  type ConversationState,
  type ConversationChange,
} from '../shared/chat-controls.js';
import { randomUUID } from 'node:crypto';
import pg from 'pg';
import type { Job, Operation, Routine, CalendarEvent } from '../shared/contracts.js';
import { AppError } from './errors.js';
import type { MemoryRecord, MemorySearch, MemoryPage } from '../shared/memory.js';
import { foldMemoryText, resourceSearchText } from '../shared/memory.js';
import { memoryScore, memoryTerms } from '../shared/memory-retrieval.js';
import { localDateRange } from '../shared/time.js';
import type { Reminder } from '../shared/reminders.js';

function memoryBounds(record: MemoryRecord) {
  if (record.occurredAt)
    return { start: Date.parse(record.occurredAt), end: Date.parse(record.occurredAt), day: false };
  if (record.occurredOn) {
    const next = new Date(record.occurredOn + 'T12:00:00Z');
    next.setUTCDate(next.getUTCDate() + 1);
    const range = localDateRange(
      record.occurredOn,
      next.toISOString().slice(0, 10),
      record.timeZone ?? 'Europe/Istanbul',
    );
    return { start: Date.parse(range.from), end: Date.parse(range.to), day: true };
  }
  return { start: Date.parse(record.createdAt), end: Date.parse(record.createdAt), day: false };
}
export type ConversationMessage = {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  createdAt: string;
  channel?: 'web' | 'telegram' | 'legacy';
};
export interface Store {
  reminders(scheduledOnly?: boolean): Promise<Reminder[]>;
  reminder(id: string): Promise<Reminder | undefined>;
  saveReminder(record: Reminder, expected?: number): Promise<void>;
  dueTasks(now: string): Promise<MemoryRecord[]>;
  reserveVoice(day: string, limit: number): Promise<boolean>;
  memories(search: MemorySearch): Promise<MemoryPage>;
  recall(query: string): Promise<MemoryRecord[]>;
  memory(id: string): Promise<MemoryRecord | undefined>;
  memoryHistory(id: string): Promise<MemoryRecord[]>;
  saveMemory(record: MemoryRecord, expected: number | undefined, operationId: string): Promise<MemoryRecord>;
  conversation(limit?: number, before?: string, after?: string): Promise<ConversationMessage[]>;
  recallConversation(query: string, after?: string): Promise<ConversationMessage[]>;
  changeConversation(input: ConversationChange): Promise<ConversationState>;
  appendConversation(key: string, user: string, assistant: string): Promise<void>;
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  setIfAbsent<T>(key: string, value: T): Promise<T>;
  putTransient(key: string, value: unknown, expires: string): Promise<void>;
  takeTransient<T>(key: string): Promise<T | undefined>;
  routines(): Promise<Routine[]>;
  saveRoutine(r: Routine, expected?: number): Promise<void>;
  deleteRoutine(id: string, version: number): Promise<void>;
  operations(): Promise<Operation[]>;
  operation(id: string): Promise<Operation | undefined>;
  operationForKey(key: string): Promise<Operation | undefined>;
  queuedOperations(): Promise<Operation[]>;
  insertOperation(op: Operation): Promise<Operation>;
  transition(op: Operation, previous: Operation['status']): Promise<boolean>;
  enqueue(job: Job): Promise<void>;
  claim(kinds?: Job['kind'][]): Promise<Job | undefined>;
  pendingNotifications(since: string): Promise<{ jobs: Job[]; operations: Operation[] }>;
  finish(job: Job): Promise<void>;
  jobs(): Promise<Job[]>;
  recover(): Promise<void>;
  cache(id: string): Promise<{ token: string; events: CalendarEvent[]; syncedAt: string } | undefined>;
  saveCache(id: string, token: string, events: CalendarEvent[]): Promise<void>;
  close(): Promise<void>;
}
export function newJob(
  kind: Job['kind'],
  key: string,
  payload: Job['payload'],
  scheduledAt = new Date().toISOString(),
): Job {
  return { id: randomUUID(), kind, key, payload, status: 'queued', scheduledAt };
}
export class MemoryStore implements Store {
  async recall(query: string) {
    const terms = memoryTerms(query);
    return structuredClone(
      [...this.memoryRows.values()]
        .filter((row) => !row.archived && memoryScore(row, terms) > 0)
        .sort(
          (a, b) => memoryScore(b, terms) - memoryScore(a, terms) || b.updatedAt.localeCompare(a.updatedAt),
        )
        .slice(0, 50),
    );
  }
  async setIfAbsent<T>(key: string, value: T): Promise<T> {
    if (!this.kv.has(key)) this.kv.set(key, structuredClone(value));
    return structuredClone(this.kv.get(key) as T);
  }
  private reminderRows = new Map<string, Reminder>();
  async reminders(scheduledOnly = false) {
    return structuredClone(
      [...this.reminderRows.values()]
        .filter((r) => !scheduledOnly || r.state === 'scheduled')
        .sort((a, b) => (a.remindAt ?? '').localeCompare(b.remindAt ?? '')),
    );
  }
  async reminder(id: string) {
    return structuredClone(this.reminderRows.get(id));
  }
  async saveReminder(record: Reminder, expected?: number) {
    const old = this.reminderRows.get(record.id);
    if ((old && old.version !== expected) || (!old && expected !== undefined))
      throw new AppError(409, 'Hatırlatma değişmiş. Güncel sürümü yeniden yükle.');
    this.reminderRows.set(record.id, structuredClone(record));
  }
  async dueTasks(now: string) {
    const keys = new Set([...this.js.values()].map((j) => j.key));
    return structuredClone(
      [...this.memoryRows.values()]
        .filter(
          (r) =>
            r.kind === 'task' &&
            !r.archived &&
            r.taskState !== 'done' &&
            r.remindAt &&
            Date.parse(r.remindAt) <= Date.parse(now) &&
            !keys.has('task-reminder:' + r.id + ':' + r.remindAt),
        )
        .slice(0, 50),
    );
  }
  async reserveVoice(day: string, limit: number) {
    const used = (this.kv.get('voice.usage:' + day) as number | undefined) ?? 0;
    if (used >= limit) return false;
    this.kv.set('voice.usage:' + day, used + 1);
    return true;
  }
  private memoryRows = new Map<string, MemoryRecord>();
  private memoryVersions = new Map<string, MemoryRecord[]>();
  private memoryOperations = new Map<string, MemoryRecord>();
  async memory(id: string) {
    return structuredClone(this.memoryRows.get(id));
  }
  async memoryHistory(id: string) {
    return structuredClone((this.memoryVersions.get(id) ?? []).slice(-50).reverse());
  }
  async memories(search: MemorySearch): Promise<MemoryPage> {
    const terms = foldMemoryText(search.query).match(/[\p{L}\p{N}]+/gu) ?? [];
    const rows = [...this.memoryRows.values()]
      .filter(
        (r) =>
          r.archived === search.archived &&
          (!search.kind || r.kind === search.kind) &&
          (!search.before || BigInt(r.seq) < BigInt(search.before)) &&
          (!search.from ||
            (memoryBounds(r).day
              ? memoryBounds(r).end > Date.parse(search.from)
              : memoryBounds(r).start >= Date.parse(search.from))) &&
          (!search.to || memoryBounds(r).start < Date.parse(search.to)) &&
          (!terms.length ||
            terms.some((t) =>
              foldMemoryText(
                r.title +
                  ' ' +
                  r.body +
                  ' ' +
                  r.summary +
                  ' ' +
                  r.tags.join(' ') +
                  ' ' +
                  resourceSearchText(r),
              ).includes(t),
            )),
      )
      .sort((a, b) => Number(BigInt(b.seq) - BigInt(a.seq)));
    const items = rows.slice(0, search.limit);
    return structuredClone({ items, ...(rows.length > search.limit ? { next: items.at(-1)!.seq } : {}) });
  }
  async saveMemory(record: MemoryRecord, expected: number | undefined, operationId: string) {
    const replay = this.memoryOperations.get(operationId);
    if (replay) return structuredClone(replay);
    const old = this.memoryRows.get(record.id);
    if ((old && old.version !== expected) || (!old && expected !== undefined))
      throw new AppError(409, 'Kayıt değişmiş. Güncel sürümü yeniden yükle.');
    const saved = structuredClone({ ...record, seq: old?.seq ?? String(this.memoryRows.size + 1) });
    this.memoryRows.set(record.id, saved);
    this.memoryVersions.set(record.id, [...(this.memoryVersions.get(record.id) ?? []), saved]);
    this.memoryOperations.set(operationId, saved);
    return structuredClone(saved);
  }
  private conversationRows: ConversationMessage[] = [];
  private conversationSequence = 0;
  private conversationRequests = new Map<string, string>();
  async recallConversation(query: string, after = '0') {
    const terms = memoryTerms(query);
    return structuredClone(
      this.conversationRows
        .filter(
          (row) =>
            BigInt(row.id) > BigInt(after) && terms.some((term) => foldMemoryText(row.text).includes(term)),
        )
        .map((row) => ({
          row,
          score: terms.filter((term) => foldMemoryText(row.text).includes(term)).length,
        }))
        .sort((a, b) => b.score - a.score || b.row.createdAt.localeCompare(a.row.createdAt))
        .slice(0, 8)
        .map((hit) => hit.row),
    );
  }
  async changeConversation(input: ConversationChange): Promise<ConversationState> {
    const old =
      (this.kv.get('conversation.state') as ConversationState | undefined) ?? initialConversationState;
    if (old.version !== input.expectedVersion)
      throw new AppError(409, 'Conversation changed. Refresh before trying again.');
    if (
      [...this.js.values()].some(
        (j) =>
          ['assistant', 'telegram_incoming'].includes(j.kind) && ['queued', 'running'].includes(j.status),
      )
    )
      throw new AppError(409, 'Wait for pending messages to finish before changing conversation context.');
    const boundary = String(this.conversationSequence);
    const selected = input.messageId ? this.conversationRequests.get(input.messageId) : undefined;
    if (input.mode === 'forget' && !selected) throw new AppError(404, 'Message not found.');
    const next = {
      ...old,
      version: old.version + 1,
      contextId: randomUUID(),
      ...(input.mode !== 'forget' ? { contextAfter: boundary } : {}),
      ...(['new', 'delete'].includes(input.mode) ? { visibleAfter: boundary } : {}),
    };
    if (['forget', 'delete'].includes(input.mode)) {
      const removed = this.conversationRows.filter(
        (row) => input.mode === 'delete' || this.conversationRequests.get(row.id) === selected,
      );
      const keys = new Set(removed.map((row) => this.conversationRequests.get(row.id)));
      const removedIds = new Set(removed.map((row) => row.id));
      this.conversationRows = this.conversationRows.filter((row) => !removedIds.has(row.id));
      for (const row of removed) this.conversationRequests.delete(row.id);
      for (const [key, value] of this.kv) {
        if (key.startsWith('chat:') && (input.mode === 'delete' || keys.has(key)))
          this.kv.set(key, {
            ...(value as object),
            result: { message: 'This reply was removed from local chat history.', removed: true },
          });
        if (
          key.startsWith('assistant.request:') &&
          (input.mode === 'delete' || keys.has('chat:web:' + key.slice('assistant.request:'.length)))
        )
          this.kv.set(key, {
            ...(value as object),
            status: 'failed',
            result: undefined,
            error: 'This reply was removed from local chat history.',
          });
      }
      if (input.mode === 'delete') this.kv.set('assistant.history', []);
      for (const job of this.js.values())
        if (
          job.kind === 'assistant' &&
          job.payload.chatRequest &&
          (input.mode === 'delete' || keys.has('chat:web:' + job.payload.chatRequest.id))
        )
          job.payload.chatRequest.message = '[Removed from chat history]';
    }
    for (const key of this.kv.keys()) if (key.startsWith('assistant.clarification:')) this.kv.delete(key);
    this.kv.set('conversation.state', next);
    return structuredClone(next);
  }
  private conversationKeys = new Set<string>();
  async conversation(limit = 50, before?: string, after = '0') {
    return structuredClone(
      this.conversationRows
        .filter((m) => BigInt(m.id) > BigInt(after) && (!before || BigInt(m.id) < BigInt(before)))
        .slice(-Math.min(500, Math.max(1, limit))),
    );
  }
  async appendConversation(key: string, user: string, assistant: string) {
    if (this.conversationKeys.has(key)) return;
    this.conversationKeys.add(key);
    const start = this.conversationSequence;
    this.conversationRequests.set(String(start + 1), key);
    this.conversationRequests.set(String(start + 2), key);
    for (const [role, text] of [
      ['user', user],
      ['assistant', assistant],
    ] as const)
      this.conversationRows.push({
        id: String(++this.conversationSequence),
        role,
        text,
        createdAt: new Date().toISOString(),
        channel: key.includes('telegram:') ? 'telegram' : key.includes('web:') ? 'web' : 'legacy',
      });
  }
  private kv = new Map<string, unknown>();
  private transient = new Map<string, { value: unknown; expires: string }>();
  private rs = new Map<string, Routine>();
  private ops = new Map<string, Operation>();
  private js = new Map<string, Job>();
  private caches = new Map<string, { token: string; events: CalendarEvent[]; syncedAt: string }>();
  async get<T>(k: string) {
    return structuredClone(this.kv.get(k)) as T | undefined;
  }
  async set(k: string, v: unknown) {
    this.kv.set(k, structuredClone(v));
  }
  async putTransient(k: string, value: unknown, expires: string) {
    this.transient.set(k, { value, expires });
  }
  async takeTransient<T>(k: string) {
    const x = this.transient.get(k);
    this.transient.delete(k);
    return x && Date.parse(x.expires) > Date.now() ? (structuredClone(x.value) as T) : undefined;
  }
  async routines() {
    return structuredClone([...this.rs.values()]);
  }
  async saveRoutine(r: Routine, expected?: number) {
    const old = this.rs.get(r.id);
    if (expected !== undefined && old?.version !== expected)
      throw new AppError(409, 'Rutin başka bir işlemde değiştirildi.');
    this.rs.set(r.id, structuredClone(r));
  }
  async deleteRoutine(id: string, version: number) {
    if (this.rs.get(id)?.version !== version) throw new AppError(409, 'Rutin sürümü değişti.');
    this.rs.delete(id);
  }
  async operations() {
    return structuredClone([...this.ops.values()].reverse().slice(0, 100));
  }
  async operation(id: string) {
    return structuredClone(this.ops.get(id));
  }
  async operationForKey(key: string) {
    return structuredClone([...this.ops.values()].find((op) => op.key === key));
  }
  async queuedOperations() {
    return structuredClone([...this.ops.values()].filter((op) => op.status === 'queued'));
  }
  async insertOperation(op: Operation) {
    const old = [...this.ops.values()].find((x) => x.key === op.key);
    if (old) return structuredClone(old);
    this.ops.set(op.id, structuredClone(op));
    return structuredClone(op);
  }
  async transition(op: Operation, previous: Operation['status']) {
    if (this.ops.get(op.id)?.status !== previous) return false;
    this.ops.set(op.id, structuredClone(op));
    return true;
  }
  async enqueue(j: Job) {
    if (![...this.js.values()].some((x) => x.key === j.key)) this.js.set(j.id, structuredClone(j));
  }
  async claim(kinds: Job['kind'][] = ['routine', 'operation']) {
    const j = [...this.js.values()].find(
      (x) => kinds.includes(x.kind) && x.status === 'queued' && Date.parse(x.scheduledAt) <= Date.now(),
    );
    if (!j) return;
    j.status = 'running';
    j.startedAt = new Date().toISOString();
    return structuredClone(j);
  }
  async finish(j: Job) {
    this.js.set(j.id, structuredClone(j));
  }
  async jobs() {
    return structuredClone([...this.js.values()].reverse().slice(0, 100));
  }
  async recover() {}
  async pendingNotifications(since: string) {
    const keys = new Set([...this.js.values()].map((j) => j.key));
    return {
      jobs: structuredClone(
        [...this.js.values()]
          .filter(
            (j) =>
              ['routine', 'ai_report'].includes(j.kind) &&
              ['succeeded', 'failed', 'unknown'].includes(j.status) &&
              (Date.parse(j.finishedAt ?? j.startedAt ?? j.scheduledAt) >= Date.parse(since) ||
                !!j.payload.reminder) &&
              !keys.has('tg:job:' + j.id),
          )
          .slice(0, 100),
      ),
      operations: structuredClone(
        [...this.ops.values()]
          .filter(
            (o) =>
              o.key.startsWith('chat:telegram:') &&
              ['succeeded', 'failed', 'unknown'].includes(o.status) &&
              o.updatedAt >= since &&
              !keys.has('tg:op:' + o.id),
          )
          .slice(0, 100),
      ),
    };
  }
  async cache(id: string) {
    return structuredClone(this.caches.get(id));
  }
  async saveCache(id: string, token: string, events: CalendarEvent[]) {
    this.caches.set(id, { token, events: structuredClone(events), syncedAt: new Date().toISOString() });
  }
  async close() {}
}
export class PostgresStore implements Store {
  async recallConversation(query: string, after = '0') {
    const terms = memoryTerms(query)
      .map((term) => term + ':*')
      .join(' | ');
    if (!terms) return [];
    return (
      await this.pool.query(
        `SELECT id::text,role,text,created_at,request_key FROM conversation_messages
       WHERE id>$2::bigint AND cor_memory_vector_v1('',text,'','[]'::jsonb) @@ to_tsquery('pg_catalog.simple',$1)
       ORDER BY ts_rank_cd(cor_memory_vector_v1('',text,'','[]'::jsonb),to_tsquery('pg_catalog.simple',$1)) DESC,id DESC LIMIT 8`,
        [terms, after],
      )
    ).rows.map((row) => ({
      id: row.id,
      role: row.role,
      text: row.text,
      createdAt: new Date(row.created_at).toISOString(),
      channel: row.request_key.includes('telegram:')
        ? 'telegram'
        : row.request_key.includes('web:')
          ? 'web'
          : 'legacy',
    })) as ConversationMessage[];
  }
  async recall(query: string) {
    const terms = memoryTerms(query)
      .map((term) => term + ':*')
      .join(' | ');
    if (!terms) return [];
    return (
      await this.pool.query(
        `SELECT data || jsonb_build_object('seq',seq::text) AS data FROM memory_items
       WHERE archived=false AND cor_memory_vector_v1(title,body || ' ' || cor_resource_text(data),summary,data->'tags') @@ to_tsquery('pg_catalog.simple',$1)
       ORDER BY ts_rank_cd(cor_memory_vector_v1(title,body || ' ' || cor_resource_text(data),summary,data->'tags'),to_tsquery('pg_catalog.simple',$1)) DESC, seq DESC LIMIT 50`,
        [terms],
      )
    ).rows.map((row) => row.data as MemoryRecord);
  }
  async setIfAbsent<T>(key: string, value: T): Promise<T> {
    await this.pool.query('INSERT INTO kv(key,value) VALUES($1,$2) ON CONFLICT(key) DO NOTHING', [
      key,
      JSON.stringify(value),
    ]);
    return (await this.get<T>(key))!;
  }
  async reminders(scheduledOnly = false): Promise<Reminder[]> {
    return (
      await this.pool.query(
        scheduledOnly
          ? "SELECT data FROM reminders WHERE state='scheduled' ORDER BY remind_at NULLS LAST, id"
          : 'SELECT data FROM reminders ORDER BY remind_at NULLS LAST, id',
      )
    ).rows.map((r) => r.data);
  }
  async reminder(id: string): Promise<Reminder | undefined> {
    return (await this.pool.query('SELECT data FROM reminders WHERE id=$1', [id])).rows[0]?.data;
  }
  async saveReminder(record: Reminder, expected?: number) {
    const result =
      expected === undefined
        ? await this.pool.query(
            'INSERT INTO reminders(id,version,state,remind_at,data) VALUES($1,$2,$3,$4,$5) ON CONFLICT(id) DO NOTHING',
            [record.id, record.version, record.state, record.remindAt, record],
          )
        : await this.pool.query(
            'UPDATE reminders SET version=$2,state=$3,remind_at=$4,data=$5 WHERE id=$1 AND version=$6',
            [record.id, record.version, record.state, record.remindAt, record, expected],
          );
    if (!result.rowCount) throw new AppError(409, 'Hatırlatma değişmiş. Güncel sürümü yeniden yükle.');
  }
  async dueTasks(now: string): Promise<MemoryRecord[]> {
    return (
      await this.pool.query(
        `SELECT data || jsonb_build_object('seq',seq::text) AS data FROM memory_items m WHERE kind='task' AND archived=false AND COALESCE(data->>'taskState','open')='open' AND (data->>'remindAt')::timestamptz <= $1::timestamptz AND NOT EXISTS(SELECT 1 FROM jobs j WHERE j.job_key='task-reminder:'||m.id::text||':'||(m.data->>'remindAt')) ORDER BY (data->>'remindAt')::timestamptz LIMIT 50`,
        [now],
      )
    ).rows.map((r) => r.data);
  }
  async reserveVoice(day: string, limit: number) {
    return !!(
      await this.pool.query(
        `INSERT INTO kv(key,value) VALUES($1,'1'::jsonb)
      ON CONFLICT(key) DO UPDATE SET value=to_jsonb((kv.value::text)::integer+1)
      WHERE (kv.value::text)::integer<$2 RETURNING key`,
        ['voice.usage:' + day, limit],
      )
    ).rows.length;
  }
  async memory(id: string): Promise<MemoryRecord | undefined> {
    return (
      await this.pool.query(
        "SELECT data || jsonb_build_object('seq',seq::text) AS data FROM memory_items WHERE id=$1",
        [id],
      )
    ).rows[0]?.data;
  }
  async memoryHistory(id: string): Promise<MemoryRecord[]> {
    return (
      await this.pool.query(
        'SELECT data FROM memory_revisions WHERE memory_id=$1 ORDER BY version DESC LIMIT 50',
        [id],
      )
    ).rows.map((r) => r.data);
  }
  async memories(search: MemorySearch): Promise<MemoryPage> {
    const tokens = (search.query.toLocaleLowerCase('tr').match(/[\p{L}\p{N}]+/gu) ?? []).slice(0, 16);
    const alternatives = [
      ...new Set(tokens.flatMap((t) => [t, t.normalize('NFD').replace(/\p{M}/gu, '').replaceAll('ı', 'i')])),
    ];
    const prefix = alternatives.map((t) => t + ':*').join(' | ');
    const rows = (
      await this.pool.query(
        `SELECT data || jsonb_build_object('seq',seq::text) AS data FROM memory_items
      WHERE archived=$1 AND ($2::text IS NULL OR kind=$2) AND ($3::bigint IS NULL OR seq<$3)
      AND ($4::timestamptz IS NULL OR CASE WHEN occurred_at IS NULL AND occurred_on IS NOT NULL
        THEN ((occurred_on+1)::timestamp AT TIME ZONE COALESCE(data->>'timeZone','Europe/Istanbul'))>$4
        ELSE COALESCE(occurred_at,created_at)>=$4 END)
      AND ($5::timestamptz IS NULL OR COALESCE(occurred_at,occurred_on::timestamp AT TIME ZONE COALESCE(data->>'timeZone','Europe/Istanbul'),created_at)<$5)
      AND ($6='' OR cor_memory_vector_v1(title,body || ' ' || cor_resource_text(data),summary,data->'tags') @@ websearch_to_tsquery('pg_catalog.turkish',translate($6,'Iİ','ıi'))
        OR cor_memory_vector_v1(title,body || ' ' || cor_resource_text(data),summary,data->'tags') @@ to_tsquery('pg_catalog.simple',$7))
      ORDER BY seq DESC LIMIT $8`,
        [
          search.archived,
          search.kind ?? null,
          search.before ?? null,
          search.from ?? null,
          search.to ?? null,
          search.query,
          prefix,
          search.limit + 1,
        ],
      )
    ).rows;
    const items = rows.slice(0, search.limit).map((r) => r.data as MemoryRecord);
    return { items, ...(rows.length > search.limit ? { next: items.at(-1)!.seq } : {}) };
  }
  async saveMemory(
    record: MemoryRecord,
    expected: number | undefined,
    operationId: string,
  ): Promise<MemoryRecord> {
    const saved = await this.pool.query(
      `WITH changed AS (
      INSERT INTO memory_items(id,version,kind,title,body,summary,archived,occurred_at,created_at,data,occurred_on)
      SELECT $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$13 WHERE NOT EXISTS(SELECT 1 FROM memory_revisions WHERE operation_id=$12)
      AND ($11::integer IS NULL OR EXISTS(SELECT 1 FROM memory_items WHERE id=$1 AND version=$11))
      ON CONFLICT(id) DO UPDATE SET version=EXCLUDED.version,kind=EXCLUDED.kind,title=EXCLUDED.title,
        body=EXCLUDED.body,summary=EXCLUDED.summary,archived=EXCLUDED.archived,occurred_at=EXCLUDED.occurred_at,data=EXCLUDED.data,occurred_on=EXCLUDED.occurred_on
      WHERE memory_items.version=$11 AND NOT EXISTS(SELECT 1 FROM memory_revisions WHERE operation_id=$12)
      RETURNING seq,data
    ), revision AS (
      INSERT INTO memory_revisions(memory_id,version,operation_id,data)
      SELECT $1,$2,$12,data || jsonb_build_object('seq',seq::text) FROM changed RETURNING data
    ) SELECT data FROM revision UNION ALL SELECT data FROM memory_revisions WHERE operation_id=$12 LIMIT 1`,
      [
        record.id,
        record.version,
        record.kind,
        record.title,
        record.body,
        record.summary,
        record.archived,
        record.occurredAt,
        record.createdAt,
        record,
        expected ?? null,
        operationId,
        record.occurredOn,
      ],
    );
    if (!saved.rows[0]) throw new AppError(409, 'Kayıt değişmiş. Güncel sürümü yeniden yükle.');
    return saved.rows[0].data;
  }
  async changeConversation(input: ConversationChange): Promise<ConversationState> {
    await this.setIfAbsent('conversation.state', initialConversationState);
    const result = await this.pool.query(
      `
      WITH old AS (SELECT value FROM kv WHERE key='conversation.state' FOR UPDATE),
      boundary AS (SELECT COALESCE(max(id),0)::text AS id FROM conversation_messages),
      target AS (SELECT id,role,request_key,regexp_replace(request_key,':(user|assistant)$','') AS base FROM conversation_messages WHERE id=$3::bigint AND left(request_key,7)<>'legacy:'),
      changed AS (
        UPDATE kv SET value=old.value || jsonb_build_object('version',$1::integer+1,'contextId',$4::text)
          || CASE WHEN $2::text<>'forget' THEN jsonb_build_object('contextAfter',boundary.id) ELSE '{}'::jsonb END
          || CASE WHEN $2::text IN ('new','delete') THEN jsonb_build_object('visibleAfter',boundary.id) ELSE '{}'::jsonb END
        FROM old,boundary WHERE key='conversation.state' AND (old.value->>'version')::integer=$1
          AND ($2::text<>'forget' OR EXISTS(SELECT 1 FROM target))
          AND NOT EXISTS(SELECT 1 FROM jobs WHERE status IN ('queued','running') AND data->>'kind' IN ('assistant','telegram_incoming'))
        RETURNING kv.value
      ), removed AS (
        DELETE FROM conversation_messages USING changed WHERE $2::text='delete' OR ($2::text='forget' AND EXISTS(
          SELECT 1 FROM target t WHERE conversation_messages.request_key IN (t.base||':user',t.base||':assistant',t.request_key)
           OR (left(t.request_key,7)='legacy:' AND ((t.role='user' AND conversation_messages.id=t.id+1 AND conversation_messages.role='assistant') OR (t.role='assistant' AND conversation_messages.id=t.id-1 AND conversation_messages.role='user')))
        )) RETURNING request_key
      ), safe_replies AS (
        UPDATE kv SET value=value || jsonb_build_object('result',jsonb_build_object('message','This reply was removed from local chat history.','removed',true))
        WHERE left(key,5)='chat:' AND EXISTS(SELECT 1 FROM changed) AND ($2::text='delete' OR key IN(SELECT regexp_replace(request_key,':(user|assistant)$','') FROM removed)) RETURNING key
      ), safe_requests AS (
        UPDATE kv SET value=(value-'result') || jsonb_build_object('status','failed','error','This reply was removed from local chat history.')
        WHERE left(key,18)='assistant.request:' AND EXISTS(SELECT 1 FROM changed) AND ($2::text='delete' OR 'chat:web:'||substring(key FROM 19) IN(SELECT regexp_replace(request_key,':(user|assistant)$','') FROM removed)) RETURNING key
      ), legacy AS (
        DELETE FROM kv WHERE key='assistant.history' AND $2::text='delete' AND EXISTS(SELECT 1 FROM changed) RETURNING key
      ), clarifications AS (
        DELETE FROM kv WHERE key LIKE 'assistant.clarification:%' AND EXISTS(SELECT 1 FROM changed) RETURNING key
      ), scrubbed_jobs AS (
        UPDATE jobs SET data=jsonb_set(data,'{payload,chatRequest,message}','"[Removed from chat history]"'::jsonb)
        WHERE data->>'kind'='assistant' AND EXISTS(SELECT 1 FROM changed) AND ($2::text='delete' OR 'chat:web:'||(data#>>'{payload,chatRequest,id}') IN(SELECT regexp_replace(request_key,':(user|assistant)$','') FROM removed)) RETURNING id
      ) SELECT value FROM changed`,
      [input.expectedVersion, input.mode, input.messageId ?? null, randomUUID()],
    );
    if (!result.rows[0])
      throw new AppError(
        409,
        'Conversation changed or messages are pending. Refresh and wait for them to finish.',
      );
    return result.rows[0].value;
  }
  constructor(public pool: pg.Pool) {}
  async conversation(limit = 50, before?: string, after = '0') {
    const rows = (
      await this.pool.query(
        'SELECT id::text,role,text,created_at,request_key FROM conversation_messages WHERE ($1::bigint IS NULL OR id < $1::bigint) AND id>$3::bigint ORDER BY id DESC LIMIT $2',
        [before ?? null, Math.min(500, Math.max(1, limit)), after],
      )
    ).rows.reverse();
    return rows.map((r) => ({
      id: String(r.id),
      role: r.role,
      text: r.text,
      createdAt: new Date(r.created_at).toISOString(),
      channel: r.request_key.includes('telegram:')
        ? 'telegram'
        : r.request_key.includes('web:')
          ? 'web'
          : 'legacy',
    })) as ConversationMessage[];
  }
  async appendConversation(key: string, user: string, assistant: string) {
    await this.pool.query(
      "INSERT INTO conversation_messages(request_key,role,text) VALUES($1,'user',$2),($3,'assistant',$4) ON CONFLICT(request_key) DO NOTHING",
      [key + ':user', user, key + ':assistant', assistant],
    );
  }
  async get<T>(key: string) {
    return (await this.pool.query('SELECT value FROM kv WHERE key=$1', [key])).rows[0]?.value as
      T | undefined;
  }
  async set(key: string, value: unknown) {
    await this.pool.query('INSERT INTO kv(key,value) VALUES($1,$2) ON CONFLICT(key) DO UPDATE SET value=$2', [
      key,
      JSON.stringify(value),
    ]);
  }
  async putTransient(key: string, value: unknown, expires: string) {
    await this.pool.query('DELETE FROM oauth_states WHERE expires_at < now()');
    await this.pool.query(
      'INSERT INTO oauth_states VALUES($1,$2,$3) ON CONFLICT(key) DO UPDATE SET value=$2,expires_at=$3',
      [key, JSON.stringify(value), expires],
    );
  }
  async takeTransient<T>(key: string) {
    return (
      await this.pool.query('DELETE FROM oauth_states WHERE key=$1 AND expires_at>now() RETURNING value', [
        key,
      ])
    ).rows[0]?.value as T | undefined;
  }
  async routines() {
    return (await this.pool.query('SELECT data FROM routines ORDER BY next_run')).rows.map(
      (x) => x.data as Routine,
    );
  }
  async saveRoutine(r: Routine, expected?: number) {
    if (expected === undefined) {
      await this.pool.query('INSERT INTO routines VALUES($1,$2,$3,$4,$5)', [
        r.id,
        r.version,
        r.enabled,
        r.nextRun,
        JSON.stringify(r),
      ]);
    } else {
      const x = await this.pool.query(
        'UPDATE routines SET version=$2,enabled=$3,next_run=$4,data=$5 WHERE id=$1 AND version=$6',
        [r.id, r.version, r.enabled, r.nextRun, JSON.stringify(r), expected],
      );
      if (!x.rowCount) throw new AppError(409, 'Rutin sürümü değişti.');
    }
  }
  async deleteRoutine(id: string, version: number) {
    const x = await this.pool.query('DELETE FROM routines WHERE id=$1 AND version=$2', [id, version]);
    if (!x.rowCount) throw new AppError(409, 'Rutin sürümü değişti.');
  }
  async operations() {
    return (await this.pool.query('SELECT data FROM operations ORDER BY updated_at DESC LIMIT 100')).rows.map(
      (x) => x.data as Operation,
    );
  }
  async operation(id: string) {
    return (await this.pool.query('SELECT data FROM operations WHERE id=$1', [id])).rows[0]?.data as
      Operation | undefined;
  }
  async operationForKey(key: string) {
    return (await this.pool.query('SELECT data FROM operations WHERE request_key=$1', [key])).rows[0]
      ?.data as Operation | undefined;
  }
  async queuedOperations() {
    return (await this.pool.query("SELECT data FROM operations WHERE status='queued'")).rows.map(
      (row) => row.data as Operation,
    );
  }
  async insertOperation(op: Operation) {
    const x = await this.pool.query(
      'INSERT INTO operations(id,request_key,hash,status,data) VALUES($1,$2,$3,$4,$5) ON CONFLICT(request_key) DO NOTHING RETURNING data',
      [op.id, op.key, op.hash, op.status, JSON.stringify(op)],
    );
    return (
      x.rows[0]?.data ??
      ((await this.pool.query('SELECT data FROM operations WHERE request_key=$1', [op.key])).rows[0]
        .data as Operation)
    );
  }
  async transition(op: Operation, previous: Operation['status']) {
    return Boolean(
      (
        await this.pool.query(
          'UPDATE operations SET status=$2,data=$3,updated_at=now() WHERE id=$1 AND status=$4',
          [op.id, op.status, JSON.stringify(op), previous],
        )
      ).rowCount,
    );
  }
  async enqueue(j: Job) {
    await this.pool.query(
      'INSERT INTO jobs(id,job_key,status,scheduled_at,data) VALUES($1,$2,$3,$4,$5) ON CONFLICT(job_key) DO NOTHING',
      [j.id, j.key, j.status, j.scheduledAt, JSON.stringify(j)],
    );
  }
  async claim(kinds: Job['kind'][] = ['routine', 'operation']) {
    const x = await this.pool.query(
      `WITH candidate AS (SELECT id FROM jobs WHERE status='queued' AND data->>'kind'=ANY($1::text[]) AND scheduled_at<=now() ORDER BY scheduled_at FOR UPDATE SKIP LOCKED LIMIT 1) UPDATE jobs SET status='running',started_at=now(),data=data||jsonb_build_object('status','running','startedAt',now()) FROM candidate WHERE jobs.id=candidate.id RETURNING jobs.data`,
      [kinds],
    );
    return x.rows[0]?.data as Job | undefined;
  }
  async finish(j: Job) {
    await this.pool.query(
      "UPDATE jobs SET status=$2,data=$3,scheduled_at=$4,started_at=CASE WHEN $2='queued' THEN NULL ELSE started_at END WHERE id=$1",
      [j.id, j.status, JSON.stringify(j), j.scheduledAt],
    );
  }
  async jobs() {
    return (await this.pool.query('SELECT data FROM jobs ORDER BY scheduled_at DESC LIMIT 100')).rows.map(
      (x) => x.data as Job,
    );
  }
  async pendingNotifications(since: string) {
    const jobs = (
      await this.pool.query(
        `SELECT j.data FROM jobs j WHERE j.data->>'kind' IN ('routine','ai_report') AND j.status IN ('succeeded','failed','unknown') AND (COALESCE(j.data->>'finishedAt',j.data->>'startedAt',j.data->>'scheduledAt')::timestamptz >= $1::timestamptz OR j.data->'payload'->'reminder' IS NOT NULL) AND NOT EXISTS(SELECT 1 FROM jobs sent WHERE sent.job_key='tg:job:'||j.id::text) ORDER BY j.scheduled_at LIMIT 100`,
        [since],
      )
    ).rows.map((r) => r.data as Job);
    const operations = (
      await this.pool.query(
        `SELECT o.data FROM operations o WHERE o.request_key LIKE 'chat:telegram:%' AND o.status IN ('succeeded','failed','unknown') AND o.updated_at >= $1::timestamptz AND NOT EXISTS(SELECT 1 FROM jobs sent WHERE sent.job_key='tg:op:'||o.id::text) ORDER BY o.updated_at LIMIT 100`,
        [since],
      )
    ).rows.map((r) => r.data as Operation);
    return { jobs, operations };
  }
  async recover() {
    await this.pool.query(
      `UPDATE jobs SET status='queued',started_at=NULL,data=(data-'startedAt'-'finishedAt'-'error')||'{"status":"queued"}'::jsonb WHERE status='running' AND data->>'kind'='assistant' AND started_at<now()-interval '10 minutes'`,
    );
    await this.pool.query(
      `UPDATE jobs SET status='unknown',data=data||'{"status":"unknown","error":"Worker lease expired; manual reconciliation required"}'::jsonb WHERE status='running' AND started_at<now()-interval '10 minutes'`,
    );
    // Reminder preparation performs only reads; actual Telegram sends have a
    // separate outbox lease and retain the conservative unknown-send policy.
    await this.pool.query(
      `UPDATE jobs SET status='queued',started_at=NULL,data=(data-'startedAt'-'finishedAt'-'error')||'{"status":"queued"}'::jsonb WHERE status='unknown' AND data->'payload'->'reminder' IS NOT NULL AND data->>'kind'='routine' AND data->>'error'='Worker lease expired; manual reconciliation required'`,
    );
    await this.pool.query(
      `UPDATE operations SET status='unknown',data=data||'{"status":"unknown","error":"Execution interrupted; verify Google before retrying"}'::jsonb WHERE status='running' AND updated_at<now()-interval '10 minutes'`,
    );
    await this.pool.query(
      `UPDATE operations o SET status='unknown', data=o.data||'{"status":"unknown","error":"Worker interrupted before journal completion; reconcile before retrying"}'::jsonb WHERE o.status='queued' AND EXISTS (SELECT 1 FROM jobs j WHERE j.job_key='operation:'||o.id::text AND j.status='unknown')`,
    );
  }
  async cache(id: string) {
    const x = (await this.pool.query('SELECT * FROM calendar_cache WHERE calendar_id=$1', [id])).rows[0];
    return x
      ? {
          token: x.sync_token,
          events: x.events as CalendarEvent[],
          syncedAt: new Date(x.synced_at).toISOString(),
        }
      : undefined;
  }
  async saveCache(id: string, token: string, events: CalendarEvent[]) {
    await this.pool.query(
      'INSERT INTO calendar_cache VALUES($1,$2,now(),$3) ON CONFLICT(calendar_id) DO UPDATE SET sync_token=$2,synced_at=now(),events=$3',
      [id, token, JSON.stringify(events)],
    );
  }
  async close() {
    await this.pool.end();
  }
}
