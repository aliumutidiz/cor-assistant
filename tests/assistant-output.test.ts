import { describe, it, expect } from 'vitest';
import { parseAssistantOutput } from '../server/assistant-output.js';

const read = {
  message: 'Yarınki planlarınızı kontrol ediyorum.',
  action: null,
  read: {
    kind: 'events',
    calendarId: 'primary',
    timeMin: '2026-10-21T00:00:00+03:00',
    timeMax: '2026-10-21T23:59:59+03:00',
  },
};
describe('assistant output boundary', () => {
  it('recovers complete fenced calendar envelopes including nested messages', () => {
    for (const output of [
      read,
      JSON.stringify(read),
      '```json\n' + JSON.stringify(read) + '\n```',
      { message: '```json\n' + JSON.stringify(read) + '\n```', action: null, read: null },
    ]) {
      expect(parseAssistantOutput(output).read).toEqual({
        kind: 'events',
        calendarId: 'primary',
        from: read.read.timeMin,
        to: read.read.timeMax,
      });
    }
  });
  it('rejects conflicting aliases, unknown fields and invalid dates', () => {
    for (const fields of [{ from: '2026-10-22T00:00:00+03:00' }, { secret: true }, { timeMin: 'tomorrow' }])
      expect(() => parseAssistantOutput({ ...read, read: { ...read.read, ...fields } })).toThrow();
  });
  it('never promotes hidden write proposals or discards unknown envelope fields', () => {
    expect(() =>
      parseAssistantOutput({
        message: JSON.stringify({ ...read, action: { kind: 'event.delete' } }),
        action: null,
        read: null,
      }),
    ).toThrow();
    expect(() =>
      parseAssistantOutput({ message: JSON.stringify(read), action: null, read: null, extra: true }),
    ).toThrow();
  });
  it('preserves ordinary prose and does not extract JSON fragments', () => {
    const message = 'Örnek: ' + JSON.stringify(read);
    expect(parseAssistantOutput({ message, action: null, read: null }).message).toBe(message);
  });
});
