import { readFile } from 'node:fs/promises';
import { z } from 'zod';
import type { CalendarEvent, Routine } from '../shared/contracts.js';
import type { ModelProvider } from './provider.js';
import { generateValidated } from './model-generation.js';
import { containsCredential } from './sensitive.js';
import { AppError } from './errors.js';

export type ReportInput = {
  routine: Routine;
  from: string;
  to: string;
  events: CalendarEvent[];
  communication?: { language: string; displayName?: string; communicationStyle?: string };
  personal?: {
    tasks: unknown[];
    reminders: unknown[];
    programs: unknown[];
    profile: unknown;
    partial: boolean;
  };
};
const report = z.object({ message: z.string().trim().min(1).max(6000) }).strict();
const reportEnvelope = report.extend({ action: z.null().optional(), read: z.null().optional() });
// Whole records are included or omitted. Large personal archives must not crowd
// the report prompt or exceed the provider's transport envelope.
function boundedRecords(records: unknown[], budget: number) {
  const included: unknown[] = [];
  let bytes = 2;
  for (const record of records) {
    const serialized = JSON.stringify(record);
    if (containsCredential(serialized)) continue;
    const size = Buffer.byteLength(serialized, 'utf8') + 1;
    if (bytes + size > budget) continue;
    included.push(record);
    bytes += size;
  }
  return { included, partial: included.length !== records.length };
}
function parseReport(output: unknown) {
  for (let depth = 0; depth < 3; depth++) {
    if (typeof output === 'string') {
      try {
        output = JSON.parse(output.trim().replace(/^```(?:json)?\s*\n([\s\S]*?)\n```$/i, '$1'));
      } catch {
        throw new AppError(502, 'Rapor biçimi doğrulanamadı.');
      }
    }
    const value = reportEnvelope.parse(output);
    if (value.message.startsWith('{') || value.message.startsWith('```')) {
      output = value.message;
      continue;
    }
    if (value.message.includes('```json')) throw new AppError(502, 'Rapor düz metin olarak tamamlanamadı.');
    return { message: value.message };
  }
  throw new AppError(502, 'Rapor yanıtı iç içe JSON içeriyor.');
}
export async function routineReport(provider: ModelProvider, input: ReportInput, signal: AbortSignal) {
  const eventData = input.events.slice(0, 200).map((e) => ({
    title: containsCredential(e.summary) ? '[Sensitive content omitted]' : e.summary.slice(0, 300),
    start: e.start,
    end: e.end,
    transparent: e.transparency === 'transparent',
  }));
  const boundedEvents = boundedRecords(eventData, 24000);
  const events = boundedEvents.included;
  const tasks = boundedRecords(input.personal?.tasks ?? [], 4000);
  const reminders = boundedRecords(input.personal?.reminders ?? [], 4000);
  const programs = boundedRecords(input.personal?.programs ?? [], 6000);
  const profileText = JSON.stringify(input.personal?.profile ?? null);
  const profile =
    Buffer.byteLength(profileText) <= 4000 && !containsCredential(profileText)
      ? input.personal?.profile
      : undefined;
  const partial =
    !!input.personal?.partial ||
    tasks.partial ||
    reminders.partial ||
    programs.partial ||
    (!profile && !!input.personal?.profile);
  const prompt = await readFile(new URL('../skills/routine-reports/SKILL.md', import.meta.url), 'utf8');
  const response = await generateValidated(
    provider,
    prompt +
      '\nREPORT_DATA: ' +
      JSON.stringify({
        now: new Date().toISOString(),
        timeZone: input.routine.timeZone,
        from: input.from,
        to: input.to,
        totalEvents: input.events.length,
        includedEvents: events.length,
        truncated: input.events.length > events.length,
        ownerFocus: containsCredential(input.routine.message ?? '')
          ? '[Sensitive content omitted]'
          : (input.routine.message ?? ''),
        events,
        communication: input.communication ?? { language: 'en' },
        personal: input.personal
          ? {
              tasks: tasks.included,
              reminders: reminders.included,
              programs: programs.included,
              profile,
              partial,
            }
          : undefined,
      }),
    z.toJSONSchema(report),
    (output) => {
      const value = parseReport(output);
      if (containsCredential(value.message)) throw new AppError(502, 'Rapor güvenli biçimde üretilemedi.');
      return value;
    },
    { used: false },
    signal,
  );
  return {
    message: response.output.message,
    execution: 'ai',
    llmUsed: true,
    from: input.from,
    to: input.to,
    eventCount: input.events.length,
    truncated: input.events.length > events.length || partial,
  };
}
