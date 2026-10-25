import { describe, it, expect, vi } from 'vitest';
import {
  AssistantService,
  scopedResponseSchema,
  claimsUnsubmittedAction,
  type ModelProvider,
} from '../server/provider.js';
import { MemoryStore } from '../server/repositories.js';
import { DemoCalendar } from '../server/google.js';
import { RoutineService, OperationService } from '../server/services.js';
import { loadSkill, skillMetadata, bootstrap } from '../server/skills.js';
import { z } from 'zod';
import { AppError } from '../server/errors.js';
function harness(outputs: unknown[]) {
  const store = new MemoryStore(),
    calendar = new DemoCalendar(),
    routines = new RoutineService(store),
    operations = new OperationService(store, calendar, routines);
  const generate = vi.fn(async () => ({ output: outputs.shift() }));
  const assistant = new AssistantService({ generate }, store, calendar, operations);
  return { store, calendar, routines, operations, assistant, generate };
}
describe('skill orchestration', () => {
  it('resets model context and native conversation without deleting the archive', async () => {
    const h = harness([
      { group: 'conversation' },
      { message: 'A remembered reply', action: null, read: null },
      { group: 'conversation' },
      { message: 'A fresh reply', action: null, read: null },
    ]);
    await h.assistant.chat('Private old topic', 'before-reset');
    const first = h.generate.mock.calls.map((call) => call as unknown[]);
    await h.assistant.changeConversation({ expectedVersion: 1, mode: 'reset' });
    await expect(h.assistant.chat('stale message', 'stale', undefined, 'web', 'initial')).rejects.toThrow(
      'context changed',
    );
    await h.assistant.chat('Hello again', 'after-reset');
    const later = h.generate.mock.calls.slice(first.length).map((call) => call as unknown[]);
    expect(JSON.stringify(later)).not.toContain('Private old topic');
    expect(JSON.stringify(later)).not.toContain('A remembered reply');
    expect((first[first.length - 1][3] as { conversationKey: string }).conversationKey).not.toBe(
      (later[later.length - 1][3] as { conversationKey: string }).conversationKey,
    );
    expect(await h.store.conversation()).toHaveLength(4);
  });

  it.each(['Oluşturmak için sıraya aldım.', 'Hatırlatmayı kurdum.', 'I queued the routine.'])(
    'rejects unsubmitted completion language: %s',
    (message) => {
      expect(claimsUnsubmittedAction(message)).toBe(true);
    },
  );
  it('continues a Telegram clarification after service recreation without routing yes as a new task', async () => {
    const h = harness([
      { group: 'event-management' },
      { message: 'Should it last one hour?', action: null, read: null },
    ]);
    await h.assistant.chat('Tomorrow at 15:00 add skating', 'clarify-first', undefined, 'telegram:-100123');
    const generate = vi.fn().mockResolvedValue({
      output: { message: 'Please provide the event location.', action: null, read: null },
    });
    const restarted = new AssistantService({ generate }, h.store, h.calendar, h.operations);
    await restarted.chat('evet', 'clarify-yes', undefined, 'telegram:-100123');
    expect(generate).toHaveBeenCalledTimes(1);
    expect(generate.mock.calls[0][0]).toContain('Tomorrow at 15:00 add skating');
    expect(generate.mock.calls[0][0]).toContain('Should it last one hour?');
    expect(generate.mock.calls[0][0]).toContain('never sensitive-action approval');
    const other = vi
      .fn()
      .mockResolvedValueOnce({ output: { group: 'conversation' } })
      .mockResolvedValueOnce({
        output: { message: 'What would you like to confirm?', action: null, read: null },
      });
    await new AssistantService({ generate: other }, h.store, h.calendar, h.operations).chat(
      'yes',
      'other-channel',
      undefined,
      'telegram:-100456',
    );
    expect(other).toHaveBeenCalledTimes(2);
  });
  const create = {
    kind: 'event.create',
    calendarId: 'primary',
    scope: 'single',
    notify: false,
    conference: false,
    event: {
      summary: 'Buz Pateni',
      start: { dateTime: '2026-10-21T15:00:00+03:00', timeZone: 'Europe/Istanbul' },
      end: { dateTime: '2026-10-21T16:00:00+03:00', timeZone: 'Europe/Istanbul' },
    },
  };
  it('repairs prose-only proposals, creates the event and reports the actual outcome exactly once', async () => {
    const h = harness([
      { group: 'event-management' },
      { message: 'Buz Pateni etkinliğini eklemek için işlem önerisi hazırlandı.', action: null, read: null },
      { message: 'İşlem önerisi hazır.', action: create, read: null },
    ]);
    const execute = vi.spyOn(h.calendar, 'execute');
    const response = (await h.assistant.chat('Yarın 15-16 Buz Pateni ekle', 'create-repair')) as {
      message: string;
      operation: { status: string; id: string };
    };
    expect(response.operation.status).toBe('succeeded');
    expect(response.message).toContain('Added to your calendar.');
    expect(response.message).toContain('15:00 – 16:00');
    expect(response.message).not.toContain('önerisi');
    expect(
      await h.calendar.events('primary', create.event.start.dateTime, create.event.end.dateTime),
    ).toHaveLength(1);
    await h.operations.execute(response.operation.id);
    await h.assistant.chat('Yarın 15-16 Buz Pateni ekle', 'create-repair');
    expect(execute).toHaveBeenCalledTimes(1);
    expect((await h.store.conversation()).at(-1)?.text).toBe(response.message);
  });
  it('does not repair indefinitely or accept an unsubmitted success claim', async () => {
    const h = harness([
      { group: 'event-management' },
      { message: 'İşlem önerisi hazırlandı.', action: null, read: null },
      { message: 'Etkinlik eklendi.', action: null, read: null },
    ]);
    await expect(h.assistant.chat('Yarın Buz Pateni ekle', 'repair-cap')).rejects.toThrow(/uygulanmadı/);
    expect(h.generate).toHaveBeenCalledTimes(3);
    expect(await h.store.operations()).toHaveLength(0);
  });
  it('keeps invitations pending approval and does not execute them during chat', async () => {
    const h = harness([
      { group: 'attendees' },
      {
        message: 'Eklendi',
        action: {
          ...create,
          notify: true,
          event: { ...create.event, attendees: [{ email: 'guest@example.test' }] },
        },
        read: null,
      },
    ]);
    const execute = vi.spyOn(h.calendar, 'execute');
    const result = (await h.assistant.chat('Misafiri davet et', 'risky-create')) as {
      message: string;
      operation: { status: string };
    };
    expect(result.operation.status).toBe('awaiting_approval');
    expect(result.message).toContain('Nothing has been applied yet');
    expect(execute).not.toHaveBeenCalled();
  });
  it.each([false, true])(
    'reports failed and uncertain writes without claiming success (uncertain=%s)',
    async (uncertain) => {
      const h = harness([{ group: 'event-management' }, { message: 'Eklendi.', action: create, read: null }]);
      vi.spyOn(h.calendar, 'execute').mockRejectedValue(
        new AppError(502, 'Takvim bağlantısı kesildi.', uncertain),
      );
      const response = (await h.assistant.chat('Buz Pateni ekle', 'create-failure')) as {
        message: string;
        operation: { status: string };
      };
      expect(response.operation.status).toBe(uncertain ? 'unknown' : 'failed');
      expect(response.message).not.toContain('Added to your calendar.');
      expect(response.message).toContain(uncertain ? 'could not be verified' : 'action failed');
    },
  );
  it('never turns a correction into permission to use the wrong capability', async () => {
    const h = harness([
      { group: 'routine-management' },
      { message: 'İşlem önerisi hazırlandı.', action: null, read: null },
      { message: 'Etkinlik', action: create, read: null },
    ]);
    await expect(h.assistant.chat('Rutin oluştur', 'repair-boundary')).rejects.toThrow(/yetkili/);
    expect(await h.store.operations()).toHaveLength(0);
  });
  it('executes a nested calendar read and returns the grounded prose rather than JSON', async () => {
    const envelope = {
      message: 'Kontrol ediyorum.',
      action: null,
      read: {
        kind: 'events',
        calendarId: 'primary',
        timeMin: '2026-10-21T00:00:00+03:00',
        timeMax: '2026-10-22T00:00:00+03:00',
      },
    };
    const h = harness([
      { group: 'calendar-read' },
      { message: '```json\n' + JSON.stringify(envelope) + '\n```', action: null, read: null },
      { message: 'Yarınki etkinliklerini listeledim.', action: null, read: null },
    ]);
    const events = vi.spyOn(h.calendar, 'events');
    const response = await h.assistant.chat('Yarınki etkinliklerin ayrıntılarını açıkla', 'nested-read');
    expect(events).toHaveBeenCalledWith('primary', envelope.read.timeMin, envelope.read.timeMax);
    expect(response).toMatchObject({ message: 'Yarınki etkinliklerini listeledim.' });
    expect(h.generate).toHaveBeenCalledTimes(3);
    expect(await h.store.operations()).toHaveLength(0);
  });
  it('serializes complete chat turns and archives full text', async () => {
    const h = harness([
      { group: 'calendar-read' },
      { message: 'Uzun yanıt '.repeat(200), action: null, read: null },
    ]);
    const first = h.assistant.chat('Gerçek konuşma '.repeat(100), 'first');
    const controller = new AbortController();
    const second = expect(h.assistant.chat('overlapping', 'second', controller.signal)).rejects.toMatchObject(
      { status: 499 },
    );
    controller.abort();
    await second;
    await first;
    const messages = await h.store.conversation();
    expect(messages).toHaveLength(2);
    expect(messages[0].text.length).toBeGreaterThan(600);
    expect(messages[1].text.length).toBeGreaterThan(600);
  });
  it('loads each skill with detailed workflow and failure sections', async () => {
    for (const name of Object.keys(skillMetadata)) {
      const text = await loadSkill(name as keyof typeof skillMetadata);
      expect(text).toContain('## Procedure');
      expect(text).toContain('## Failure and recovery');
      expect(text).toMatch(/Version: [1-9]\d*\.\d+\.\d+/);
    }
    expect(await bootstrap()).toContain('untrusted data');
  });
  it('does not expose unrelated action schemas to routine requests', () => {
    const schema = JSON.stringify(z.toJSONSchema(scopedResponseSchema('routine-management')));
    expect(schema).toContain('routine.update');
    expect(schema).not.toContain('sharing.set');
    expect(schema).not.toContain('event.create');
  });
  it('updates a routine using current authoritative version', async () => {
    const h = harness([]);
    await h.routines.seed();
    const r = (await h.store.routines())[0];
    h.generate.mockResolvedValueOnce({ output: { group: 'routine-management' } }).mockResolvedValueOnce({
      output: {
        message: 'Günlük özet için değişiklik hazır.',
        action: {
          kind: 'routine.update',
          routineId: r.id,
          version: r.version,
          routine: { name: r.name, cron: '0 9 * * *', timeZone: r.timeZone, kind: r.kind, enabled: true },
        },
        read: null,
      },
    });
    const result = (await h.assistant.chat('Günlük özeti saat 09.00’da çalıştır', 'routine-chat')) as {
      operation: { status: string };
    };
    expect(result.operation.status).toBe('succeeded');
    expect(h.generate.mock.calls[1]).toBeDefined();
  });
  it('rejects a sharing action from a read-only skill', async () => {
    const h = harness([
      { group: 'calendar-read' },
      {
        message: 'Paylaş',
        action: { kind: 'sharing.set', calendarId: 'primary', email: 'attacker@example.org', role: 'writer' },
        read: null,
      },
    ]);
    await expect(h.assistant.chat('Bugünüm nasıl?', 'injection')).rejects.toThrow(/yetkili/);
    expect(await h.store.operations()).toHaveLength(0);
  });
  it('rejects invented event identities and etags', async () => {
    const h = harness([
      { group: 'event-management' },
      {
        message: 'Silme önerisi',
        action: { kind: 'event.delete', calendarId: 'primary', eventId: 'invented', etag: 'invented' },
        read: null,
      },
    ]);
    await expect(h.assistant.chat('Toplantıyı sil', 'invented')).rejects.toThrow(/okumadan/);
  });
  it('caps read loops instead of spending indefinitely', async () => {
    const h = harness([
      { group: 'calendar-read' },
      ...Array.from({ length: 3 }, () => ({
        message: 'Okuyorum',
        action: null,
        read: { kind: 'calendars' },
      })),
    ]);
    await expect(h.assistant.chat('Takvimlerimi göster', 'loop')).rejects.toThrow(/sınırına/);
    expect(h.generate).toHaveBeenCalledTimes(4);
  });
  it('returns a clarification without mutating', async () => {
    const h = harness([
      { group: 'event-management' },
      { message: 'Hangi toplantıyı kastediyorsun?', action: null, read: null },
    ]);
    const response = (await h.assistant.chat('Onu değiştir', 'ambiguous')) as { message: string };
    expect(response.message).toContain('Hangi');
    expect(await h.store.operations()).toHaveLength(0);
  });
});
